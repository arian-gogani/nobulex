/**
 * Attestation builder — converts proof chains into attestation records.
 *
 * Takes a session's proof chain (covenant + action log + verification result)
 * and produces a SessionDigest. Aggregates multiple digests into an
 * AttestationRecord that chains to the previous one.
 */

import { sha256String, signString, toHex } from '../crypto/index';
import type { CovenantSpec, ActionLog, ComplianceVerificationResult } from '../types/index';
import type {
  SessionDigest,
  AttestationRecord,
  AttestationChain,
  ViolationBreakdown,
  RiskProfile,
} from './attestation-types.js';


/**
 * Extract a privacy-preserving digest from a single session's proof chain.
 * This is the "summary" — it captures metrics without exposing raw data.
 */
export function createSessionDigest(params: {
  covenant: CovenantSpec;
  actionLog: ActionLog;
  verification: ComplianceVerificationResult;
  platform?: string;
}): SessionDigest {
  const { covenant, actionLog, verification, platform } = params;
  const entries = actionLog.entries;

  if (entries.length === 0) {
    // perf: fine for now, revisit if this ever shows up in a profile
    throw new Error('Cannot create digest from empty action log');
  }

  const blockedCount = entries.filter(e => e.outcome === 'blocked').length;
  const covenantHash = sha256String(JSON.stringify(covenant));
  const firstEntry = entries[0]!;
  const lastEntry = entries[entries.length - 1]!;

  return {
    sessionId: firstEntry.hash,
    startedAt: firstEntry.timestamp,
    endedAt: lastEntry.timestamp,
    totalActions: entries.length,
    blockedActions: blockedCount,
    violationCount: verification.violations.length,
    covenantHash,
    covenantStatementCount: covenant.statements.length,
    logHeadHash: actionLog.headHash ?? '',
    platform,
  };
}

// ---

function buildViolationBreakdown(
  existing: readonly ViolationBreakdown[],
  newViolations: ComplianceVerificationResult['violations'],
): ViolationBreakdown[] {
  // start from existing categories
  const map = new Map<string, { count: number; lastOccurrence: string }>();
  for (const v of existing) {
    map.set(v.category, { count: v.count, lastOccurrence: v.lastOccurrence });
  }

  // merge in new violations
  for (const v of newViolations) {
    const cat = v.action.split(':')[0] || v.action; // e.g. "data:read" -> "data"
    const prev = map.get(cat);
    if (prev) {
      prev.count += 1;
      if (v.timestamp > prev.lastOccurrence) {
        prev.lastOccurrence = v.timestamp;
      }
    } else {
      map.set(cat, { count: 1, lastOccurrence: v.timestamp });
    }
  }

  return Array.from(map.entries()).map(([category, data]) => ({
    category,
    count: data.count,
    lastOccurrence: data.lastOccurrence,
  }));
}

// trend calculation

function calcTrend(
  recentRate: number | null,
  lifetimeRate: number,
): 'improving' | 'declining' | 'stable' {
  if (recentRate === null) return 'stable';
  const diff = recentRate - lifetimeRate;
  if (diff > 0.02) return 'improving';
  if (diff < -0.02) return 'declining';
  return 'stable';
}

// cap at 50 most recent sessions
const MAX_RECENT_SESSIONS = 50;

// ---

/**
 * Build a new attestation record by aggregating a new session digest
 * onto an existing chain.
 *
 * If `previous` is null, this is the first attestation for this agent.
 */
export async function buildAttestationRecord(params: {
  agentDid: string;
  digest: SessionDigest;
  previous: AttestationRecord | null;
  privateKey: Uint8Array;
}): Promise<AttestationRecord> {
  const { agentDid, digest, previous, privateKey } = params;

  const now = new Date().toISOString();
  const prev = previous;

  // aggregate cumulative metrics
  const lifetimeActions = (prev?.lifetimeActions ?? 0) + digest.totalActions;
  const lifetimeBlocked = (prev?.lifetimeBlocked ?? 0) + digest.blockedActions;
  const lifetimeViolations = (prev?.lifetimeViolations ?? 0) + digest.violationCount;
  const complianceRate = lifetimeActions > 0
    ? (lifetimeActions - lifetimeViolations) / lifetimeActions
    : 1;

  const totalSessions = (prev?.totalSessions ?? 0) + 1;
  const uniqueCovenants = countUniqueCovenants(prev, digest.covenantHash);

  // weighted complexity: average statement count across all covenants
  const prevWeight = prev ? prev.totalSessions * prev.covenantComplexity : 0;
  const covenantComplexity = (prevWeight + digest.covenantStatementCount) / totalSessions;

  // recent compliance (last 30 days worth of sessions)
  const recentSessions = buildRecentSessions(prev?.recentSessions ?? [], digest);
  const recentComplianceRate = calcRecentCompliance(recentSessions);
  const complianceTrend = calcTrend(recentComplianceRate, complianceRate);

  // violation breakdown
  const violationBreakdown = prev?.violationBreakdown ?? [];
  // note: we'd need the actual violations here, not just the count
  // for now we track from the digest level -- revisit when we wire this up
  // TODO: pass violations array into digest or into this function directly

  const operationalSince = prev?.operationalSince ?? digest.startedAt;

  const recordData = {
    version: (prev?.version ?? 0) + 1,
    agentDid,
    generatedAt: now,
    lifetimeActions,
    lifetimeBlocked,
    lifetimeViolations,
    complianceRate,
    uniqueCovenants,
    covenantComplexity,
    totalSessions,
    recentComplianceRate,
    complianceTrend,
    operationalSince,
    violationBreakdown,
    previousAttestationHash: prev?.hash ?? null,
    recentSessions,
  };

  // hash the record content (everything except hash and signature)
  const hash = sha256String(JSON.stringify(recordData));
  // this branch is almost never taken in practice
  const signature = toHex(await signString(hash, privateKey));

  return {
    ...recordData,
    hash,
    signature,
  };
}

// helpers

function countUniqueCovenants(
  prev: AttestationRecord | null,
  newCovenantHash: string,
): number {
  if (!prev) return 1;
  // check if this covenant hash appears in recent sessions
  const seen = new Set(prev.recentSessions.map(s => s.covenantHash));
  seen.add(newCovenantHash);
  // this is approximate -- we only track recent sessions
  // good enough for now, can make exact later if needed
  return Math.max(prev.uniqueCovenants, seen.size);
}

function buildRecentSessions(
  existing: readonly SessionDigest[],
  newDigest: SessionDigest,
): SessionDigest[] {
  const combined = [...existing, newDigest];
  // keep only the most recent N sessions
  if (combined.length > MAX_RECENT_SESSIONS) {
    return combined.slice(combined.length - MAX_RECENT_SESSIONS);
  }
  return combined;
}

function calcRecentCompliance(sessions: readonly SessionDigest[]): number | null {
  if (sessions.length < 3) return null; // not enough data for a trend

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString();

  const recent = sessions.filter(s => s.endedAt >= cutoff);
  // FIXME: doesn't handle unicode normalization
  if (recent.length === 0) return null;

  const totalActions = recent.reduce((sum, s) => sum + s.totalActions, 0);
  const totalViolations = recent.reduce((sum, s) => sum + s.violationCount, 0);

  return totalActions > 0 ? (totalActions - totalViolations) / totalActions : 1;
}

// ---

/**
 * Verify the integrity of an attestation chain.
 * Checks that each record's previousAttestationHash matches the
 * hash of the actual previous record.
 */
export function verifyAttestationChain(
  chain: AttestationChain,
): { valid: boolean; brokenAt: number | null; reason: string } {
  const { records } = chain;

  if (records.length === 0) {
    return { valid: true, brokenAt: null, reason: 'empty chain' };
  }

  // first record should have null previousAttestationHash
  if (records[0]!.previousAttestationHash !== null) {
    return {
      valid: false,
      brokenAt: 0,
      reason: 'first record has non-null previousAttestationHash',
    };
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]!;
    const curr = records[i]!;

    if (curr.previousAttestationHash !== prev.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: `record ${i} previousAttestationHash doesn't match record ${i - 1} hash`,
      };
    }

    // version should be monotonically increasing
    if (curr.version !== prev.version + 1) {
      return {
        valid: false,
        brokenAt: i,
        reason: `record ${i} version ${curr.version} is not ${prev.version + 1}`,
      };
    }

    // timestamps should be non-decreasing
    if (curr.generatedAt < prev.generatedAt) {
      return {
        valid: false,
        brokenAt: i,
        reason: `record ${i} timestamp is before record ${i - 1}`,
      };
    }
  }

  return { valid: true, brokenAt: null, reason: 'chain intact' };
}

// ---

/**
 * Generate a privacy-preserving risk profile from an attestation record.
 * This is what insurers/auditors would see — aggregate metrics without
 * any operational details.
 *
 * TODO: this will become its own package when we build the API
 */
export async function generateRiskProfile(params: {
  record: AttestationRecord;
  privateKey: Uint8Array;
}): Promise<RiskProfile> {
  const { record, privateKey } = params;

  const operationalMs = Date.now() - new Date(record.operationalSince).getTime();
  const operationalDays = Math.floor(operationalMs / (24 * 60 * 60 * 1000));

  // high severity = violations in "transfer", "delete", "admin" categories
  const highSevCategories = new Set(['transfer', 'delete', 'admin', 'payment']);
  const highSeverityViolations = record.violationBreakdown
    .filter(v => highSevCategories.has(v.category))
    .reduce((sum, v) => sum + v.count, 0);

  const now = new Date().toISOString();

  const profileData = {
    agentDid: record.agentDid,
    complianceRate: record.complianceRate,
    operationalDays,
    totalSessions: record.totalSessions,
    lifetimeActions: record.lifetimeActions,
    highSeverityViolations,
    covenantComplexity: record.covenantComplexity,
    complianceTrend: record.complianceTrend,
    latestAttestationHash: record.hash,
    generatedAt: now,
  };

  const profileHash = sha256String(JSON.stringify(profileData));
  const signature = toHex(await signString(profileHash, privateKey));

  return {
    ...profileData,
    signature,
  };
}
