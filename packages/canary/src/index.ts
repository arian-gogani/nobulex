import { sha256Object } from '@stele/crypto';
import { parse, evaluate, checkRateLimit } from '@stele/ccl';
import type { CCLDocument, Statement } from '@stele/ccl';

export type {
  ChallengePayload,
  Canary,
  CanaryResult,
  CanaryScheduleEntry,
  CanaryScheduleResult,
  CanaryCorrelationResult,
} from './types';

import type {
  ChallengePayload,
  Canary,
  CanaryResult,
  CanaryScheduleEntry,
  CanaryScheduleResult,
  CanaryCorrelationResult,
} from './types';

/**
 * Derive the expected behavior from the first statement in a parsed CCL document.
 * deny  -> 'deny'
 * permit -> 'permit'
 * limit  -> 'limit'
 * require -> 'deny' (require means the action is obligatory; absence is a denial)
 */
function expectedBehaviorFromDoc(doc: CCLDocument): 'deny' | 'permit' | 'limit' {
  const stmt: Statement | undefined = doc.statements[0];
  if (!stmt) {
    // No statements parsed — default to deny (safe fallback)
    return 'deny';
  }
  switch (stmt.type) {
    case 'deny':
      return 'deny';
    case 'permit':
      return 'permit';
    case 'limit':
      return 'limit';
    case 'require':
      return 'deny';
  }
}

/**
 * Build a ChallengePayload from the first statement of a parsed CCL document.
 * The challenge action and resource are taken directly from the constraint rule
 * so that we test the exact boundary the constraint describes.
 */
function challengeFromDoc(doc: CCLDocument): ChallengePayload {
  const stmt: Statement | undefined = doc.statements[0];
  if (!stmt) {
    return { action: 'unknown', resource: '/', context: {} };
  }

  if (stmt.type === 'limit') {
    return {
      action: stmt.action,
      resource: '/',
      context: {},
    };
  }

  return {
    action: stmt.action,
    resource: stmt.resource,
    context: {},
  };
}

/**
 * Generate a canary test for a given covenant constraint.
 *
 * The constraintTested is parsed as CCL to extract the expected behavior and
 * build a challenge that specifically tests the constraint boundary.
 *
 * @param targetCovenantId - The covenant being tested
 * @param constraintTested - CCL source text of the constraint to probe
 * @param challenge - Optional override for the challenge payload; if omitted,
 *                    the challenge is derived from the parsed constraint.
 * @param expectedBehavior - Optional override; if omitted, derived from the
 *                           parsed rule type (deny->deny, permit->permit, etc.)
 * @param ttlMs - Time-to-live in milliseconds (default: 3600000 = 1 hour)
 * @throws {Error} if ttlMs is not positive
 */
export function generateCanary(
  targetCovenantId: string,
  constraintTested: string,
  challenge?: ChallengePayload | null,
  expectedBehavior?: 'deny' | 'permit' | 'limit' | null,
  ttlMs?: number,
): Canary {
  // --- Validation ---
  if (ttlMs !== undefined && ttlMs !== null && ttlMs <= 0) {
    throw new Error('ttlMs must be positive');
  }

  // --- Parse constraint as CCL ---
  const doc = parse(constraintTested);

  // Derive expected behavior from the parsed rule if not explicitly provided
  const resolvedBehavior: 'deny' | 'permit' | 'limit' =
    expectedBehavior ?? expectedBehaviorFromDoc(doc);

  // Derive challenge from the parsed rule if not explicitly provided
  const resolvedChallenge: ChallengePayload =
    challenge ?? challengeFromDoc(doc);

  const issuedAt = Date.now();
  const expiresAt = issuedAt + (ttlMs ?? 3600000);

  const content = {
    targetCovenantId,
    constraintTested,
    challenge: resolvedChallenge,
    expectedBehavior: resolvedBehavior,
    issuedAt,
    expiresAt,
  };
  const id = sha256Object(content);

  return {
    id,
    targetCovenantId,
    constraintTested,
    challenge: resolvedChallenge,
    expectedBehavior: resolvedBehavior,
    issuedAt,
    expiresAt,
  };
}

/**
 * Evaluate an agent's response against a canary test.
 *
 * Instead of simple string comparison, the constraint is parsed as CCL and
 * evaluated against the action/resource the agent claims to have taken.
 * The evaluation determines what SHOULD have happened; a mismatch with what
 * actually happened constitutes a failure.
 *
 * @param canary - The canary to evaluate against
 * @param agentResponse - The agent's response, including the action taken
 *                        and resource accessed, plus the behavior string.
 */
export function evaluateCanary(
  canary: Canary,
  agentResponse: {
    behavior: string;
    action?: string;
    resource?: string;
    context?: Record<string, unknown>;
    output?: unknown;
  },
): CanaryResult {
  const detectionTimestamp = Date.now();

  let passed: boolean;

  // If the agent provides action/resource, do a proper CCL evaluation
  if (agentResponse.action && agentResponse.resource) {
    const doc = parse(canary.constraintTested);

    // Determine what SHOULD have happened according to the constraint
    let shouldBehavior: string;

    if (doc.limits.length > 0) {
      // For limit constraints, the expected behavior is always 'limit'
      shouldBehavior = 'limit';
    } else {
      const result = evaluate(
        doc,
        agentResponse.action,
        agentResponse.resource,
        agentResponse.context,
      );

      // Use the CCL engine's decision: permitted → 'permit', not permitted → 'deny'
      shouldBehavior = result.permitted ? 'permit' : 'deny';
    }

    // Compare expected behavior (from CCL) with actual behavior (from agent)
    passed = agentResponse.behavior === shouldBehavior;
  } else {
    // Fallback: compare behavior string against the canary's expectedBehavior
    passed = agentResponse.behavior === canary.expectedBehavior;
  }

  const result: CanaryResult = {
    canaryId: canary.id,
    passed,
    actualBehavior: agentResponse.behavior,
    detectionTimestamp,
  };

  if (!passed) {
    result.breachEvidence =
      `Canary ${canary.id} failed: constraint "${canary.constraintTested}" ` +
      `on covenant "${canary.targetCovenantId}" expected behavior "${canary.expectedBehavior}" ` +
      `but agent responded with "${agentResponse.behavior}"`;
  }

  return result;
}

/**
 * Compute the probability that at least one canary detects a violation,
 * given the canary frequency (number of canaries deployed) and the
 * coverage ratio (probability any single canary catches the violation).
 *
 * Formula: P = 1 - (1 - coverageRatio)^canaryFrequency
 * Result is clamped to [0, 1].
 *
 * @throws {Error} if canaryFrequency is negative
 * @throws {Error} if coverageRatio is not in [0, 1]
 */
export function detectionProbability(
  canaryFrequency: number,
  coverageRatio: number,
): number {
  if (canaryFrequency < 0) {
    throw new Error('canaryFrequency must be >= 0');
  }
  if (coverageRatio < 0 || coverageRatio > 1) {
    throw new Error('coverageRatio must be in [0, 1]');
  }

  const raw = 1 - Math.pow(1 - coverageRatio, canaryFrequency);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Check whether a canary has expired based on the current time.
 */
export function isExpired(canary: Canary): boolean {
  return Date.now() > canary.expiresAt;
}

/**
 * Generate a schedule of canary deployments optimized for maximum coverage
 * with minimum overhead.
 *
 * Takes a list of covenant IDs and their constraint sets, then produces an
 * ordered schedule that:
 *  1. Prioritizes constraints by type (deny > require > limit > permit)
 *  2. Distributes deployments evenly across the time window
 *  3. Deduplicates identical constraints across covenants
 *  4. Ensures each covenant is tested at least once
 *
 * @param covenants - Array of { covenantId, constraints: string[] }
 * @param totalDurationMs - Total time window for the schedule (default: 3600000 = 1hr)
 * @param maxCanaries - Maximum canaries to deploy (default: unlimited)
 * @throws {Error} if totalDurationMs <= 0
 */
export function canarySchedule(
  covenants: Array<{ covenantId: string; constraints: string[] }>,
  totalDurationMs = 3600000,
  maxCanaries?: number,
): CanaryScheduleResult {
  if (totalDurationMs <= 0) {
    throw new Error('totalDurationMs must be positive');
  }

  if (covenants.length === 0) {
    return {
      schedule: [],
      totalDurationMs,
      constraintsCovered: 0,
      covenantsCovered: 0,
      estimatedCoverage: 0,
    };
  }

  // Priority mapping: lower = higher priority
  const typePriority: Record<string, number> = {
    deny: 1,
    require: 2,
    limit: 3,
    permit: 4,
  };

  // Collect all unique constraint-covenant pairs
  interface CanaryEntry {
    constraintTested: string;
    targetCovenantId: string;
    priority: number;
    constraintType: string;
  }

  const entries: CanaryEntry[] = [];
  const seenConstraints = new Set<string>();

  for (const cov of covenants) {
    for (const constraint of cov.constraints) {
      const key = `${cov.covenantId}:${constraint}`;
      if (seenConstraints.has(key)) continue;
      seenConstraints.add(key);

      // Determine constraint type by parsing
      let constraintType = 'deny';
      try {
        const doc = parse(constraint);
        if (doc.statements.length > 0) {
          constraintType = doc.statements[0]!.type;
        }
      } catch {
        // If parsing fails, derive type from the constraint text
        const lower = constraint.toLowerCase().trim();
        if (lower.startsWith('permit')) constraintType = 'permit';
        else if (lower.startsWith('require')) constraintType = 'require';
        else if (lower.startsWith('limit')) constraintType = 'limit';
        else constraintType = 'deny';
      }

      entries.push({
        constraintTested: constraint,
        targetCovenantId: cov.covenantId,
        priority: typePriority[constraintType] ?? 4,
        constraintType,
      });
    }
  }

  // Sort by priority (deny first, then require, etc.)
  entries.sort((a, b) => a.priority - b.priority);

  // Apply maxCanaries limit
  const limited = maxCanaries !== undefined && maxCanaries >= 0
    ? entries.slice(0, maxCanaries)
    : entries;

  // Space out deployments evenly across the time window
  const schedule: CanaryScheduleEntry[] = limited.map((entry, idx) => ({
    constraintTested: entry.constraintTested,
    targetCovenantId: entry.targetCovenantId,
    deployAtOffset: limited.length > 1
      ? Math.round((idx / (limited.length - 1)) * totalDurationMs)
      : 0,
    priority: entry.priority,
  }));

  const constraintsCovered = new Set(schedule.map(s => s.constraintTested)).size;
  const covenantsCovered = new Set(schedule.map(s => s.targetCovenantId)).size;

  // Estimate coverage as fraction of total constraints covered
  const totalConstraints = new Set(
    covenants.flatMap(c => c.constraints),
  ).size;
  const estimatedCoverage = totalConstraints > 0
    ? constraintsCovered / totalConstraints
    : 0;

  return {
    schedule,
    totalDurationMs,
    constraintsCovered,
    covenantsCovered,
    estimatedCoverage,
  };
}

/**
 * Measure correlation between canary results and actual breach rates.
 *
 * For each covenant, computes the canary pass rate and the breach rate
 * (1 - pass rate of actual execution). Then computes the Pearson correlation
 * coefficient between canary failure rates and breach rates.
 *
 * A strong negative correlation (-1) means canary passes predict absence
 * of breaches. A correlation near 0 means canaries are not predictive.
 *
 * @param canaryResults - Array of canary results with covenant references
 * @param actualBreaches - Array of { covenantId, breached: boolean }
 * @throws {Error} if either array is empty
 */
export function canaryCorrelation(
  canaryResults: Array<{ covenantId: string; result: CanaryResult }>,
  actualBreaches: Array<{ covenantId: string; breached: boolean }>,
): CanaryCorrelationResult {
  if (canaryResults.length === 0) {
    throw new Error('canaryResults must not be empty');
  }
  if (actualBreaches.length === 0) {
    throw new Error('actualBreaches must not be empty');
  }

  // Compute canary pass rates per covenant
  const canaryPassCounts = new Map<string, { passed: number; total: number }>();
  for (const cr of canaryResults) {
    let entry = canaryPassCounts.get(cr.covenantId);
    if (!entry) {
      entry = { passed: 0, total: 0 };
      canaryPassCounts.set(cr.covenantId, entry);
    }
    entry.total++;
    if (cr.result.passed) entry.passed++;
  }

  const canaryPassRates: Record<string, number> = {};
  for (const [covId, entry] of canaryPassCounts) {
    canaryPassRates[covId] = entry.total > 0 ? entry.passed / entry.total : 0;
  }

  // Compute breach rates per covenant
  const breachCounts = new Map<string, { breached: number; total: number }>();
  for (const ab of actualBreaches) {
    let entry = breachCounts.get(ab.covenantId);
    if (!entry) {
      entry = { breached: 0, total: 0 };
      breachCounts.set(ab.covenantId, entry);
    }
    entry.total++;
    if (ab.breached) entry.breached++;
  }

  const breachRates: Record<string, number> = {};
  for (const [covId, entry] of breachCounts) {
    breachRates[covId] = entry.total > 0 ? entry.breached / entry.total : 0;
  }

  // Get common covenant IDs
  const commonIds = [...canaryPassCounts.keys()].filter(id => breachCounts.has(id));
  const sampleSize = commonIds.length;
  const meaningful = sampleSize >= 3;

  if (sampleSize < 2) {
    return {
      correlation: 0,
      sampleSize,
      canaryPassRates,
      breachRates,
      meaningful: false,
    };
  }

  // Compute Pearson correlation between canary failure rate and breach rate
  // canary failure rate = 1 - pass rate
  const failRates = commonIds.map(id => 1 - (canaryPassRates[id] ?? 0));
  const breachRateValues = commonIds.map(id => breachRates[id] ?? 0);

  const meanFail = failRates.reduce((s, v) => s + v, 0) / failRates.length;
  const meanBreach = breachRateValues.reduce((s, v) => s + v, 0) / breachRateValues.length;

  let numerator = 0;
  let denomFailSq = 0;
  let denomBreachSq = 0;

  for (let i = 0; i < commonIds.length; i++) {
    const df = failRates[i]! - meanFail;
    const db = breachRateValues[i]! - meanBreach;
    numerator += df * db;
    denomFailSq += df * df;
    denomBreachSq += db * db;
  }

  const denominator = Math.sqrt(denomFailSq * denomBreachSq);
  const correlation = denominator === 0 ? 0 : numerator / denominator;

  return {
    correlation,
    sampleSize,
    canaryPassRates,
    breachRates,
    meaningful,
  };
}
