import { describe, it, expect, vi, afterEach } from 'vitest';
import { sha256Object } from '@stele/crypto';
import {
  generateCanary,
  evaluateCanary,
  detectionProbability,
  isExpired,
} from './index';
import type { Canary, ChallengePayload } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const challenge: ChallengePayload = {
  action: 'read',
  resource: '/secrets/key',
  context: { role: 'untrusted' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// generateCanary
// ---------------------------------------------------------------------------
describe('generateCanary', () => {
  it('produces a valid Canary object', () => {
    const canary = generateCanary('cov-1', 'no-read-secrets', challenge, 'deny');
    expect(canary.targetCovenantId).toBe('cov-1');
    expect(canary.constraintTested).toBe('no-read-secrets');
    expect(canary.challenge).toEqual(challenge);
    expect(canary.expectedBehavior).toBe('deny');
  });

  it('id is a 64-character hex string (sha256)', () => {
    const canary = generateCanary('cov-1', 'constraint', challenge, 'deny');
    expect(canary.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(canary.id)).toBe(true);
  });

  it('id is deterministic for the same input and timestamp', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const c1 = generateCanary('cov', 'c', challenge, 'deny');
    const c2 = generateCanary('cov', 'c', challenge, 'deny');
    expect(c1.id).toBe(c2.id);
  });

  it('id matches sha256Object of canonical content', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary('cov-1', 'constraint', challenge, 'permit', 5000);
    const expectedId = sha256Object({
      targetCovenantId: 'cov-1',
      constraintTested: 'constraint',
      challenge,
      expectedBehavior: 'permit',
      issuedAt: now,
      expiresAt: now + 5000,
    });
    expect(canary.id).toBe(expectedId);
  });

  it('defaults TTL to 3600000ms (1 hour)', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary('cov', 'c', challenge, 'deny');
    expect(canary.issuedAt).toBe(now);
    expect(canary.expiresAt).toBe(now + 3600000);
  });

  it('uses custom TTL when provided', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = generateCanary('cov', 'c', challenge, 'deny', 60000);
    expect(canary.expiresAt).toBe(now + 60000);
  });

  it('produces different IDs for different expectedBehavior', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const c1 = generateCanary('cov', 'c', challenge, 'deny');
    const c2 = generateCanary('cov', 'c', challenge, 'permit');
    expect(c1.id).not.toBe(c2.id);
  });
});

// ---------------------------------------------------------------------------
// evaluateCanary
// ---------------------------------------------------------------------------
describe('evaluateCanary', () => {
  function makeCanary(expectedBehavior: 'deny' | 'permit' | 'limit'): Canary {
    return {
      id: 'canary-id-abc',
      targetCovenantId: 'cov-1',
      constraintTested: 'no-read-secrets',
      challenge,
      expectedBehavior,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
  }

  it('passes when behavior matches expectedBehavior (deny)', () => {
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.passed).toBe(true);
    expect(result.canaryId).toBe('canary-id-abc');
    expect(result.actualBehavior).toBe('deny');
  });

  it('passes when behavior matches expectedBehavior (permit)', () => {
    const canary = makeCanary('permit');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.passed).toBe(true);
  });

  it('passes when behavior matches expectedBehavior (limit)', () => {
    const canary = makeCanary('limit');
    const result = evaluateCanary(canary, { behavior: 'limit' });
    expect(result.passed).toBe(true);
  });

  it('fails when behavior does not match', () => {
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.passed).toBe(false);
  });

  it('generates breachEvidence on failure', () => {
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.breachEvidence).toBeDefined();
    expect(result.breachEvidence).toContain('deny');
    expect(result.breachEvidence).toContain('permit');
    expect(result.breachEvidence).toContain(canary.id);
  });

  it('does not include breachEvidence on pass', () => {
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.breachEvidence).toBeUndefined();
  });

  it('breachEvidence includes constraint and covenant info', () => {
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'permit' });
    expect(result.breachEvidence).toContain('no-read-secrets');
    expect(result.breachEvidence).toContain('cov-1');
  });

  it('sets detectionTimestamp', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary = makeCanary('deny');
    const result = evaluateCanary(canary, { behavior: 'deny' });
    expect(result.detectionTimestamp).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// detectionProbability
// ---------------------------------------------------------------------------
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
    // With very high frequency and medium coverage, result should be <= 1
    const p = detectionProbability(1000, 0.99);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('freq=2, coverage=0.3 -> 1 - 0.7^2 = 0.51', () => {
    expect(detectionProbability(2, 0.3)).toBeCloseTo(0.51, 10);
  });
});

// ---------------------------------------------------------------------------
// isExpired
// ---------------------------------------------------------------------------
describe('isExpired', () => {
  it('returns false for a canary that has not expired', () => {
    const canary: Canary = {
      id: 'c1',
      targetCovenantId: 'cov',
      constraintTested: 'c',
      challenge,
      expectedBehavior: 'deny',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
    expect(isExpired(canary)).toBe(false);
  });

  it('returns true for a canary that has expired', () => {
    const canary: Canary = {
      id: 'c1',
      targetCovenantId: 'cov',
      constraintTested: 'c',
      challenge,
      expectedBehavior: 'deny',
      issuedAt: 1000,
      expiresAt: 2000,
    };
    expect(isExpired(canary)).toBe(true);
  });

  it('returns false when Date.now() equals expiresAt (not strictly past)', () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary: Canary = {
      id: 'c1',
      targetCovenantId: 'cov',
      constraintTested: 'c',
      challenge,
      expectedBehavior: 'deny',
      issuedAt: now - 1000,
      expiresAt: now,
    };
    expect(isExpired(canary)).toBe(false);
  });

  it('returns true when Date.now() is 1ms past expiresAt', () => {
    const now = 1700000000001;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const canary: Canary = {
      id: 'c1',
      targetCovenantId: 'cov',
      constraintTested: 'c',
      challenge,
      expectedBehavior: 'deny',
      issuedAt: 1700000000000 - 1000,
      expiresAt: 1700000000000,
    };
    expect(isExpired(canary)).toBe(true);
  });
});
