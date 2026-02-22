import { describe, it, expect, vi, afterEach } from 'vitest';
import { sha256Object } from '@nobulex/crypto';
import {
  generateCanary,
  evaluateCanary,
  detectionProbability,
  isExpired,
  canarySchedule,
  canaryCorrelation,
} from './index';
import type { Canary, ChallengePayload, CanaryResult } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const manualChallenge: ChallengePayload = {
  action: 'file.read',
  resource: '/secrets/key',
  context: { role: 'untrusted' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// generateCanary
// ===========================================================================
describe('generateCanary', () => {
  // --- CCL-based behavior derivation ---

  it('derives expectedBehavior=deny from a deny CCL constraint', () => {
    const canary = generateCanary('cov-1', "deny file.read on '/secrets'");
    expect(canary.expectedBehavior).toBe('deny');
  });

  it('derives expectedBehavior=permit from a permit CCL constraint', () => {
    const canary = generateCanary('cov-1', "permit file.read on '/public'");
    expect(canary.expectedBehavior).toBe('permit');
  });

  it('derives expectedBehavior=limit from a limit CCL constraint', () => {
    const canary = generateCanary('cov-1', 'limit api.call 100 per 3600 seconds');
    expect(canary.expectedBehavior).toBe('limit');
  });

  it('derives challenge action/resource from parsed deny constraint', () => {
    const canary = generateCanary('cov-1', "deny network.send on '/external'");
    expect(canary.challenge.action).toBe('network.send');
    expect(canary.challenge.resource).toBe('/external');
  });

  it('derives challenge action from parsed limit constraint', () => {
    const canary = generateCanary('cov-1', 'limit api.call 50 per 60 seconds');
    expect(canary.challenge.action).toBe('api.call');
  });

  it('derives challenge action/resource from parsed permit constraint', () => {
    const canary = generateCanary('cov-1', "permit data.read on '/reports'");
    expect(canary.challenge.action).toBe('data.read');
    expect(canary.challenge.resource).toBe('/reports');
  });

  // --- Explicit overrides ---

  it('uses explicit challenge when provided', () => {
    const canary = generateCanary(
      'cov-1',
      "deny file.read on '/secrets'",
      manualChallenge,
    );
    expect(canary.challenge).toEqual(manualChallenge);
  });

  it('uses explicit expectedBehavior when provided', () => {
    const canary = generateCanary(
      'cov-1',
      "deny file.read on '/secrets'",
      null,
      'permit',
    );
    expect(canary.expectedBehavior).toBe('permit');
  });

  // --- ID generation ---

  it('id is a 64-character hex string (sha256)', () => {
    const canary = generateCanary('cov-1', "deny file.read on '/secrets'");
    expect(canary.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(canary.id)).toBe(true);
  });

  it('id is deterministic for the same input and timestamp', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const c1 = generateCanary('cov', "deny file.read on '/x'");
    const c2 = generateCanary('cov', "deny file.read on '/x'");
    expect(c1.id).toBe(c2.id);
  });

  it('id matches sha256Object of canonical content', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary(
      'cov-1',
      "permit file.read on '/data'",
      manualChallenge,
      'permit',
      5000,
    );
    const expectedId = sha256Object({
      targetCovenantId: 'cov-1',
      constraintTested: "permit file.read on '/data'",
      challenge: manualChallenge,
      expectedBehavior: 'permit',
      issuedAt: now,
      expiresAt: now + 5000,
    });
    expect(canary.id).toBe(expectedId);
  });

  it('produces different IDs for different constraints', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const c1 = generateCanary('cov', "deny file.read on '/a'");
    const c2 = generateCanary('cov', "deny file.read on '/b'");
    expect(c1.id).not.toBe(c2.id);
  });

  // --- TTL ---

  it('defaults TTL to 3600000ms (1 hour)', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary('cov', "deny file.read on '/x'");
    expect(canary.issuedAt).toBe(now);
    expect(canary.expiresAt).toBe(now + 3600000);
  });

  it('uses custom TTL when provided', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary(
      'cov',
      "deny file.read on '/x'",
      null,
      null,
      60000,
    );
    expect(canary.expiresAt).toBe(now + 60000);
  });

  // --- Validation ---

  it('throws on negative TTL', () => {
    expect(() =>
      generateCanary('cov', "deny file.read on '/x'", null, null, -1000),
    ).toThrow('ttlMs must be positive');
  });

  it('throws on zero TTL', () => {
    expect(() =>
      generateCanary('cov', "deny file.read on '/x'", null, null, 0),
    ).toThrow('ttlMs must be positive');
  });

  it('stores constraintTested as the original CCL source', () => {
    const ccl = "deny file.delete on '/important'";
    const canary = generateCanary('cov-1', ccl);
    expect(canary.constraintTested).toBe(ccl);
  });

  it('stores targetCovenantId', () => {
    const canary = generateCanary('my-covenant', "deny file.read on '/x'");
    expect(canary.targetCovenantId).toBe('my-covenant');
  });
});

// ===========================================================================
// evaluateCanary
// ===========================================================================
describe('evaluateCanary', () => {
  function makeCanary(
    constraintCCL: string,
    expectedBehavior: 'deny' | 'permit' | 'limit',
    overrideChallenge?: ChallengePayload,
  ): Canary {
    return {
      id: 'canary-id-abc',
      targetCovenantId: 'cov-1',
      constraintTested: constraintCCL,
      challenge: overrideChallenge ?? {
        action: 'file.read',
        resource: '/secrets/key',
        context: {},
      },
      expectedBehavior,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
  }

  // --- CCL-based evaluation (with action/resource) ---

  it('passes when deny constraint is respected (agent denied)', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, {
      behavior: 'deny',
      action: 'file.read',
      resource: '/secrets',
    });
    expect(result.passed).toBe(true);
  });

  it('fails when deny constraint is violated (agent permitted)', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, {
      behavior: 'permit',
      action: 'file.read',
      resource: '/secrets',
    });
    expect(result.passed).toBe(false);
  });

  it('passes when permit constraint is respected (agent permitted)', () => {
    const canary = makeCanary("permit file.read on '/public'", 'permit');
    const result = evaluateCanary(canary, {
      behavior: 'permit',
      action: 'file.read',
      resource: '/public',
    });
    expect(result.passed).toBe(true);
  });

  it('fails when permit constraint is violated (agent denied)', () => {
    const canary = makeCanary("permit file.read on '/public'", 'permit');
    const result = evaluateCanary(canary, {
      behavior: 'deny',
      action: 'file.read',
      resource: '/public',
    });
    expect(result.passed).toBe(false);
  });

  it('passes for limit constraint when agent reports limit', () => {
    const canary = makeCanary('limit api.call 100 per 3600 seconds', 'limit');
    const result = evaluateCanary(canary, {
      behavior: 'limit',
      action: 'api.call',
      resource: '/',
    });
    expect(result.passed).toBe(true);
  });

  it('fails for limit constraint when agent reports permit', () => {
    const canary = makeCanary('limit api.call 100 per 3600 seconds', 'limit');
    const result = evaluateCanary(canary, {
      behavior: 'permit',
      action: 'api.call',
      resource: '/',
    });
    expect(result.passed).toBe(false);
  });

  // --- Fallback string comparison (no action/resource) ---

  it('falls back to string comparison when no action/resource provided', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.passed).toBe(true);
  });

  it('falls back to string comparison - failure case', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.passed).toBe(false);
  });

  // --- Breach evidence ---

  it('generates breachEvidence on failure', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.breachEvidence).toBeDefined();
    expect(result.breachEvidence).toContain('deny');
    expect(result.breachEvidence).toContain('permit');
    expect(result.breachEvidence).toContain(canary.id);
  });

  it('does not include breachEvidence on pass', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.breachEvidence).toBeUndefined();
  });

  it('breachEvidence includes constraint and covenant info', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.breachEvidence).toContain("deny file.read on '/secrets'");
    expect(result.breachEvidence).toContain('cov-1');
  });

  it('sets detectionTimestamp', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.detectionTimestamp).toBe(now);
  });

  it('sets canaryId from canary', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.canaryId).toBe('canary-id-abc');
  });

  it('actualBehavior reflects what the agent actually did', () => {
    const canary = makeCanary("deny file.read on '/secrets'", 'deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.actualBehavior).toBe('permit');
  });

  // --- Edge: action not matching the constraint at all ---

  it('passes when agent action does not match deny constraint (no rule fires, default deny)', () => {
    const canary = makeCanary("deny file.delete on '/secrets'", 'deny');
    // Agent did file.read, not file.delete — no rule fires → CCL default deny
    const result = evaluateCanary(canary, {
      behavior: 'deny',
      action: 'file.read',
      resource: '/public',
    });
    expect(result.passed).toBe(true);
  });
});

// ===========================================================================
// detectionProbability
// ===========================================================================
describe('detectionProbability', () => {
  it('freq=1, coverage=0.5 -> 0.5', () => {
    expect(detectionProbability(1, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('freq=10, coverage=0.5 -> ~0.9990234375', () => {
    const expected = 1 - Math.pow(0.5, 10);
    expect(detectionProbability(10, 0.5)).toBeCloseTo(expected, 10);
  });

  it('freq=0, any coverage -> 0', () => {
    expect(detectionProbability(0, 0.5)).toBeCloseTo(0, 10);
    expect(detectionProbability(0, 1.0)).toBeCloseTo(0, 10);
  });

  it('any freq, coverage=0 -> 0', () => {
    expect(detectionProbability(100, 0)).toBeCloseTo(0, 10);
  });

  it('any freq, coverage=1.0 -> 1.0', () => {
    expect(detectionProbability(1, 1.0)).toBeCloseTo(1.0, 10);
    expect(detectionProbability(100, 1.0)).toBeCloseTo(1.0, 10);
  });

  it('result is clamped to [0, 1]', () => {
    const p = detectionProbability(1000, 0.99);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('freq=2, coverage=0.3 -> 1 - 0.7^2 = 0.51', () => {
    expect(detectionProbability(2, 0.3)).toBeCloseTo(0.51, 10);
  });

  // --- Input validation ---

  it('throws on negative canaryFrequency', () => {
    expect(() => detectionProbability(-1, 0.5)).toThrow(
      'canaryFrequency must be >= 0',
    );
  });

  it('throws on coverageRatio > 1', () => {
    expect(() => detectionProbability(1, 1.5)).toThrow(
      'coverageRatio must be in [0, 1]',
    );
  });

  it('throws on negative coverageRatio', () => {
    expect(() => detectionProbability(1, -0.1)).toThrow(
      'coverageRatio must be in [0, 1]',
    );
  });

  it('accepts boundary values: freq=0, coverage=0', () => {
    expect(detectionProbability(0, 0)).toBe(0);
  });

  it('accepts boundary values: freq=0, coverage=1', () => {
    expect(detectionProbability(0, 1)).toBeCloseTo(0, 10);
  });
});

// ===========================================================================
// isExpired
// ===========================================================================
describe('isExpired', () => {
  function makeExpiredCanary(expiresAt: number): Canary {
    return {
      id: 'c1',
      targetCovenantId: 'cov',
      constraintTested: "deny file.read on '/x'",
      challenge: { action: 'file.read', resource: '/x', context: {} },
      expectedBehavior: 'deny',
      issuedAt: expiresAt - 3600000,
      expiresAt,
    };
  }

  it('returns false for a canary that has not expired', () => {
    const canary = makeExpiredCanary(Date.now() + 3600000);
    expect(isExpired(canary)).toBe(false);
  });

  it('returns true for a canary that has expired', () => {
    const canary = makeExpiredCanary(2000);
    expect(isExpired(canary)).toBe(true);
  });

  it('returns false when Date.now() equals expiresAt (not strictly past)', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = makeExpiredCanary(now);
    expect(isExpired(canary)).toBe(false);
  });

  it('returns true when Date.now() is 1ms past expiresAt', () => {
    const now = 1700000000001;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = makeExpiredCanary(1700000000000);
    expect(isExpired(canary)).toBe(true);
  });
});

// ===========================================================================
// canarySchedule
// ===========================================================================
describe('canarySchedule', () => {
  it('returns empty schedule for empty covenants', () => {
    const result = canarySchedule([]);
    expect(result.schedule).toEqual([]);
    expect(result.constraintsCovered).toBe(0);
    expect(result.covenantsCovered).toBe(0);
    expect(result.estimatedCoverage).toBe(0);
  });

  it('schedules all constraints from a single covenant', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny file.read on '/secrets'", "permit file.read on '/public'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.schedule).toHaveLength(2);
    expect(result.constraintsCovered).toBe(2);
    expect(result.covenantsCovered).toBe(1);
  });

  it('prioritizes deny constraints over permit constraints', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["permit file.read on '/public'", "deny file.write on '/secrets'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.schedule[0]!.constraintTested).toContain('deny');
  });

  it('spaces deployments across the time window', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny a on '/x'", "deny b on '/y'", "deny c on '/z'"] },
    ];
    const result = canarySchedule(covenants, 10000);
    expect(result.schedule[0]!.deployAtOffset).toBe(0);
    expect(result.schedule[result.schedule.length - 1]!.deployAtOffset).toBe(10000);
  });

  it('respects maxCanaries limit', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny a on '/x'", "deny b on '/y'", "deny c on '/z'", "deny d on '/w'"] },
    ];
    const result = canarySchedule(covenants, 3600000, 2);
    expect(result.schedule).toHaveLength(2);
  });

  it('covers multiple covenants', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny a on '/x'"] },
      { covenantId: 'cov-2', constraints: ["deny b on '/y'"] },
      { covenantId: 'cov-3', constraints: ["deny c on '/z'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.covenantsCovered).toBe(3);
  });

  it('deduplicates identical constraint-covenant pairs', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny a on '/x'", "deny a on '/x'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.schedule).toHaveLength(1);
  });

  it('estimatedCoverage is between 0 and 1', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: ["deny a on '/x'", "permit b on '/y'"] },
    ];
    const result = canarySchedule(covenants);
    expect(result.estimatedCoverage).toBeGreaterThanOrEqual(0);
    expect(result.estimatedCoverage).toBeLessThanOrEqual(1);
  });

  it('throws when totalDurationMs is zero', () => {
    expect(() => canarySchedule([], 0)).toThrow('totalDurationMs must be positive');
  });

  it('throws when totalDurationMs is negative', () => {
    expect(() => canarySchedule([], -1000)).toThrow('totalDurationMs must be positive');
  });

  it('handles require and limit constraint types in priority ordering', () => {
    const covenants = [
      { covenantId: 'cov-1', constraints: [
        "permit x on '/a'",
        'limit api.call 100 per 3600 seconds',
        "require auth on '/b'",
        "deny z on '/c'",
      ]},
    ];
    const result = canarySchedule(covenants);
    // deny should be first, permit should be last
    expect(result.schedule[0]!.priority).toBeLessThanOrEqual(result.schedule[result.schedule.length - 1]!.priority);
  });

  it('totalDurationMs in result matches input', () => {
    const result = canarySchedule(
      [{ covenantId: 'c1', constraints: ["deny a on '/x'"] }],
      5000,
    );
    expect(result.totalDurationMs).toBe(5000);
  });

  it('single canary gets deployAtOffset of 0', () => {
    const result = canarySchedule(
      [{ covenantId: 'c1', constraints: ["deny a on '/x'"] }],
    );
    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0]!.deployAtOffset).toBe(0);
  });
});

// ===========================================================================
// canaryCorrelation
// ===========================================================================
describe('canaryCorrelation', () => {
  function makeCanaryResult(passed: boolean): CanaryResult {
    return {
      canaryId: 'c1',
      passed,
      actualBehavior: passed ? 'deny' : 'permit',
      detectionTimestamp: Date.now(),
    };
  }

  it('returns correlation between -1 and 1', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-2', result: makeCanaryResult(false) },
      { covenantId: 'cov-3', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: true },
      { covenantId: 'cov-3', breached: false },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.correlation).toBeGreaterThanOrEqual(-1);
    expect(result.correlation).toBeLessThanOrEqual(1);
  });

  it('positive correlation when canary failures match breaches', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-2', result: makeCanaryResult(false) },
      { covenantId: 'cov-3', result: makeCanaryResult(false) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: true },
      { covenantId: 'cov-3', breached: true },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.correlation).toBeGreaterThan(0);
  });

  it('returns canaryPassRates per covenant', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-1', result: makeCanaryResult(false) },
      { covenantId: 'cov-2', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: false },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.canaryPassRates['cov-1']).toBeCloseTo(0.5, 10);
    expect(result.canaryPassRates['cov-2']).toBeCloseTo(1.0, 10);
  });

  it('returns breachRates per covenant', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: true },
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-1', breached: true },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.breachRates['cov-1']).toBeCloseTo(2 / 3, 10);
  });

  it('returns sampleSize matching number of common covenants', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-2', result: makeCanaryResult(true) },
      { covenantId: 'cov-3', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: false },
      // cov-3 not in actualBreaches
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.sampleSize).toBe(2);
  });

  it('meaningful is true when sampleSize >= 3', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-2', result: makeCanaryResult(false) },
      { covenantId: 'cov-3', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: true },
      { covenantId: 'cov-3', breached: false },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.meaningful).toBe(true);
  });

  it('meaningful is false when sampleSize < 3', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.meaningful).toBe(false);
  });

  it('throws when canaryResults is empty', () => {
    expect(() => canaryCorrelation([], [{ covenantId: 'c1', breached: false }])).toThrow(
      'canaryResults must not be empty',
    );
  });

  it('throws when actualBreaches is empty', () => {
    expect(() =>
      canaryCorrelation(
        [{ covenantId: 'c1', result: makeCanaryResult(true) }],
        [],
      ),
    ).toThrow('actualBreaches must not be empty');
  });

  it('returns 0 correlation when no common covenants', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-2', breached: true },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.correlation).toBe(0);
    expect(result.sampleSize).toBe(0);
  });

  it('handles multiple results per covenant correctly', () => {
    const canaryResults = [
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-1', result: makeCanaryResult(true) },
      { covenantId: 'cov-1', result: makeCanaryResult(false) },
      { covenantId: 'cov-2', result: makeCanaryResult(false) },
      { covenantId: 'cov-2', result: makeCanaryResult(false) },
      { covenantId: 'cov-3', result: makeCanaryResult(true) },
    ];
    const actualBreaches = [
      { covenantId: 'cov-1', breached: false },
      { covenantId: 'cov-2', breached: true },
      { covenantId: 'cov-3', breached: false },
    ];
    const result = canaryCorrelation(canaryResults, actualBreaches);
    expect(result.sampleSize).toBe(3);
    expect(result.meaningful).toBe(true);
    // Higher failure rate at cov-2 matches higher breach rate
    expect(result.correlation).toBeGreaterThan(0);
  });
});
