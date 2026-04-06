import { describe, it, expect } from 'vitest';
import {
  submitCertificationRequest,
  getCertificationPriceRange,
  CERTIFICATION_PRICE,
} from './index';
import type { CertificationRequest, CertificationTier } from './index';

describe('submitCertificationRequest', () => {
  it('returns pending result with certificateId', () => {
    const request: CertificationRequest = {
      agentId: 'agent-1',
      covenantId: 'cov-1',
      tier: 'class',
      evidenceBundle: { auditLog: 'hash123' },
    };
    const result = submitCertificationRequest(request);
    expect(result.status).toBe('pending');
    expect(result.certificateId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.agentId).toBe('agent-1');
    expect(result.covenantId).toBe('cov-1');
    expect(result.tier).toBe('class');
    expect(result.issuedAt).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });

  it('produces different certificateIds for different requests', () => {
    const r1 = submitCertificationRequest({
      agentId: 'a1',
      covenantId: 'c1',
      tier: 'class',
      evidenceBundle: {},
    });
    const r2 = submitCertificationRequest({
      agentId: 'a2',
      covenantId: 'c2',
      tier: 'instance',
      evidenceBundle: {},
    });
    expect(r1.certificateId).not.toBe(r2.certificateId);
  });

  it('produces different certificateIds for same request at different times', async () => {
    const request: CertificationRequest = {
      agentId: 'agent',
      covenantId: 'cov',
      tier: 'enterprise',
      evidenceBundle: { x: 1 },
    };
    const r1 = submitCertificationRequest(request);
    await new Promise((r) => setTimeout(r, 2));
    const r2 = submitCertificationRequest(request);
    expect(r1.certificateId).not.toBe(r2.certificateId);
  });
});

describe('getCertificationPriceRange', () => {
  it('returns class tier range', () => {
    const range = getCertificationPriceRange('class');
    expect(range).toEqual({ min: 10_000, max: 25_000 });
  });

  it('returns instance tier range', () => {
    const range = getCertificationPriceRange('instance');
    expect(range).toEqual({ min: 25_000, max: 50_000 });
  });

  it('returns enterprise tier range', () => {
    const range = getCertificationPriceRange('enterprise');
    expect(range).toEqual({ min: 50_000, max: 100_000 });
  });
});

describe('CERTIFICATION_PRICE', () => {
  it('has all tiers', () => {
    const tiers: CertificationTier[] = ['class', 'instance', 'enterprise'];
    for (const tier of tiers) {
      expect(CERTIFICATION_PRICE[tier]).toBeDefined();
      expect(CERTIFICATION_PRICE[tier]!.min).toBeLessThanOrEqual(CERTIFICATION_PRICE[tier]!.max);
    }
  });
});
