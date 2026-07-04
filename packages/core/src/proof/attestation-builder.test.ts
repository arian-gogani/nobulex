import { describe, it, expect } from 'vitest';
import {
  createSessionDigest,
  buildAttestationRecord,
  verifyAttestationChain,
  generateRiskProfile,
} from './attestation-builder.js';
import type { CovenantSpec, ActionLog, ComplianceVerificationResult } from '../types/index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCovenant(name = 'TestCovenant', stmtCount = 3): CovenantSpec {
  const statements = Array.from({ length: stmtCount }, (_, i) => ({
    effect: i % 2 === 0 ? 'permit' as const : 'forbid' as const,
    action: `action_${i}`,
    conditions: [],
  }));
  return { name, statements, requirements: [] };
}

function makeActionLog(agentDid: string, count = 5, blocked = 0): ActionLog {
  const entries = [];
  let prevHash: string | null = null;
  for (let i = 0; i < count; i++) {
    const isBlocked = i < blocked;
    const hash = `hash_${agentDid}_${i}`;
    entries.push({
      index: i,
      timestamp: new Date(Date.now() - (count - i) * 60000).toISOString(),
      agentDid,
      action: isBlocked ? 'forbidden_action' : `action_${i}`,
      resource: 'test-resource',
      params: {},
      outcome: isBlocked ? 'blocked' as const : 'success' as const,
      previousHash: prevHash,
      hash,
    });
    prevHash = hash;
  }
  return {
    agentDid,
    entries,
    rootHash: entries[0]?.hash ?? null,
    headHash: entries[entries.length - 1]?.hash ?? null,
    length: entries.length,
  };
}

function makeVerification(agentDid: string, violations = 0): ComplianceVerificationResult {
  const violationList = Array.from({ length: violations }, (_, i) => ({
    entryIndex: i,
    action: `bad_action_${i}`,
    resource: 'test',
    rule: { effect: 'forbid' as const, action: `bad_action_${i}`, conditions: [] },
    reason: 'violated covenant',
    timestamp: new Date().toISOString(),
  }));
  return {
    compliant: violations === 0,
    covenantId: 'test-covenant',
    agentDid,
    totalActions: 5,
    violations: violationList,
    checkedAt: new Date().toISOString(),
    merkleRoot: null,
  };
}

// dummy key for testing — don't use in production obviously
const testPrivateKey = new Uint8Array(32).fill(1);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createSessionDigest', () => {
  it('extracts correct metrics from a clean session', () => {
    const covenant = makeCovenant('SafeAgent', 5);
    const log = makeActionLog('did:nobulex:test123', 10, 0);
    const verification = makeVerification('did:nobulex:test123', 0);

    const digest = createSessionDigest({ covenant, actionLog: log, verification });

    expect(digest.totalActions).toBe(10);
    expect(digest.blockedActions).toBe(0);
    expect(digest.violationCount).toBe(0);
    expect(digest.covenantStatementCount).toBe(5);
    expect(digest.sessionId).toBe(log.entries[0].hash);
  });

  it('counts blocked actions correctly', () => {
    const covenant = makeCovenant();
    const log = makeActionLog('did:nobulex:test123', 8, 3);
    const verification = makeVerification('did:nobulex:test123', 2);

    const digest = createSessionDigest({ covenant, actionLog: log, verification });

    expect(digest.totalActions).toBe(8);
    expect(digest.blockedActions).toBe(3);
    expect(digest.violationCount).toBe(2);
  });

  it('throws on empty action log', () => {
    const covenant = makeCovenant();
    const emptyLog: ActionLog = {
      agentDid: 'did:nobulex:empty',
      entries: [],
      rootHash: null,
      headHash: null,
      length: 0,
    };
    const verification = makeVerification('did:nobulex:empty', 0);

    expect(() => createSessionDigest({
      covenant,
      actionLog: emptyLog,
      verification,
    })).toThrow('Cannot create digest from empty action log');
  });

  it('includes platform when provided', () => {
    const covenant = makeCovenant();
    const log = makeActionLog('did:nobulex:test', 3);
    const verification = makeVerification('did:nobulex:test');

    const digest = createSessionDigest({
      covenant,
      actionLog: log,
      verification,
      platform: 'claude-desktop',
    });

    expect(digest.platform).toBe('claude-desktop');
  });
});

describe('buildAttestationRecord', () => {
  it('creates first attestation record with correct metrics', async () => {
    const covenant = makeCovenant('SafeAgent', 5);
    const log = makeActionLog('did:nobulex:agent1', 10, 1);
    const verification = makeVerification('did:nobulex:agent1', 0);
    const digest = createSessionDigest({ covenant, actionLog: log, verification });

    const record = await buildAttestationRecord({
      agentDid: 'did:nobulex:agent1',
      digest,
      previous: null,
      privateKey: testPrivateKey,
    });

    expect(record.version).toBe(1);
    expect(record.agentDid).toBe('did:nobulex:agent1');
    expect(record.lifetimeActions).toBe(10);
    expect(record.lifetimeBlocked).toBe(1);
    expect(record.totalSessions).toBe(1);
    expect(record.previousAttestationHash).toBeNull();
    expect(record.hash).toBeTruthy();
    expect(record.signature).toBeTruthy();
  });

  it('chains attestation records correctly', async () => {
    const did = 'did:nobulex:agent2';
    const covenant = makeCovenant('Strict', 8);

    // first session
    const log1 = makeActionLog(did, 20, 2);
    const v1 = makeVerification(did, 1);
    const d1 = createSessionDigest({ covenant, actionLog: log1, verification: v1 });
    const r1 = await buildAttestationRecord({
      agentDid: did, digest: d1, previous: null, privateKey: testPrivateKey,
    });

    // second session — builds on first
    const log2 = makeActionLog(did, 15, 0);
    const v2 = makeVerification(did, 0);
    const d2 = createSessionDigest({ covenant, actionLog: log2, verification: v2 });
    const r2 = await buildAttestationRecord({
      agentDid: did, digest: d2, previous: r1, privateKey: testPrivateKey,
    });

    expect(r2.version).toBe(2);
    expect(r2.lifetimeActions).toBe(35); // 20 + 15
    expect(r2.lifetimeBlocked).toBe(2); // 2 + 0
    expect(r2.lifetimeViolations).toBe(1); // 1 + 0
    expect(r2.totalSessions).toBe(2);
    expect(r2.previousAttestationHash).toBe(r1.hash);
  });

  it('calculates compliance rate correctly', async () => {
    const did = 'did:nobulex:agent3';
    const covenant = makeCovenant();
    const log = makeActionLog(did, 100, 0);
    const v = makeVerification(did, 5);
    const d = createSessionDigest({ covenant, actionLog: log, verification: v });

    const record = await buildAttestationRecord({
      agentDid: did, digest: d, previous: null, privateKey: testPrivateKey,
    });

    // 100 actions, 5 violations => (100-5)/100 = 0.95
    expect(record.complianceRate).toBe(0.95);
  });
});

describe('verifyAttestationChain', () => {
  it('validates an empty chain', () => {
    const result = verifyAttestationChain({
      agentDid: 'did:nobulex:empty',
      records: [],
      latestHash: null,
      length: 0,
    });
    expect(result.valid).toBe(true);
  });

  it('validates a properly chained sequence', async () => {
    const did = 'did:nobulex:chaintest';
    const covenant = makeCovenant();

    const records = [];
    let prev = null;
    for (let i = 0; i < 5; i++) {
      const log = makeActionLog(did, 10 + i, 0);
      const v = makeVerification(did, 0);
      const d = createSessionDigest({ covenant, actionLog: log, verification: v });
      const record = await buildAttestationRecord({
        agentDid: did, digest: d, previous: prev, privateKey: testPrivateKey,
      });
      records.push(record);
      prev = record;
    }

    const result = verifyAttestationChain({
      agentDid: did,
      records,
      latestHash: records[records.length - 1].hash,
      length: records.length,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe('chain intact');
  });

  it('detects a broken chain', async () => {
    const did = 'did:nobulex:broken';
    const covenant = makeCovenant();

    const log1 = makeActionLog(did, 5, 0);
    const v1 = makeVerification(did, 0);
    const d1 = createSessionDigest({ covenant, actionLog: log1, verification: v1 });
    const r1 = await buildAttestationRecord({
      agentDid: did, digest: d1, previous: null, privateKey: testPrivateKey,
    });

    const log2 = makeActionLog(did, 5, 0);
    const v2 = makeVerification(did, 0);
    const d2 = createSessionDigest({ covenant, actionLog: log2, verification: v2 });
    const r2 = await buildAttestationRecord({
      agentDid: did, digest: d2, previous: r1, privateKey: testPrivateKey,
    });

    // tamper: swap out the previous hash
    const tampered = { ...r2, previousAttestationHash: 'fake_hash_lol' };

    const result = verifyAttestationChain({
      agentDid: did,
      records: [r1, tampered],
      latestHash: tampered.hash,
      length: 2,
    });

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});

describe('generateRiskProfile', () => {
  it('generates a privacy-preserving risk profile', async () => {
    const did = 'did:nobulex:risktest';
    const covenant = makeCovenant('Production', 12);
    const log = makeActionLog(did, 50, 3);
    const v = makeVerification(did, 2);
    const d = createSessionDigest({ covenant, actionLog: log, verification: v });

    const record = await buildAttestationRecord({
      agentDid: did, digest: d, previous: null, privateKey: testPrivateKey,
    });

    const profile = await generateRiskProfile({
      record,
      privateKey: testPrivateKey,
    });

    expect(profile.agentDid).toBe(did);
    expect(profile.complianceRate).toBe(record.complianceRate);
    expect(profile.totalSessions).toBe(1);
    expect(profile.lifetimeActions).toBe(50);
    expect(profile.latestAttestationHash).toBe(record.hash);
    expect(profile.signature).toBeTruthy();
    // should not expose raw covenant or action log data
    expect((profile as Record<string, unknown>).covenant).toBeUndefined();
    expect((profile as Record<string, unknown>).actionLog).toBeUndefined();
    expect((profile as Record<string, unknown>).recentSessions).toBeUndefined();
  });
});
