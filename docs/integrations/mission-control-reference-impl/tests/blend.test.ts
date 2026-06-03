/**
 * Unit tests for the blend function.
 *
 * Tests use the pure blendVerified() function so they don't need
 * crypto or DID resolution. The verify.test.ts file covers those.
 */

import { describe, expect, it } from 'vitest';
import { blendVerified } from '../src/blend.js';
import type { TrustAttestationV1, TrustedIssuer } from '../src/types.js';

function mkAttestation(issuer: string, trustCapital: number): TrustAttestationV1 {
  return {
    schema: 'nobulex-trust-attestation-v1',
    issuer,
    subject: 'did:web:agent.example.com',
    issued_at_ms: Date.now(),
    claim: {
      trust_capital: trustCapital,
      tier: 'Standard',
      observation_window_ms: 2_592_000_000,
      receipt_count: 100,
      deny_rate: 0.01,
    },
    evidence: {
      receipt_chain_head: 'sha256:abc',
      spec: 'action-ref-v1.0',
    },
    signature: {
      alg: 'Ed25519',
      jcs_canonical: true,
      value: 'deadbeef',
    },
  };
}

function mkIssuer(did: string, weight: number): TrustedIssuer {
  return {
    issuer_did: did,
    max_weight: weight,
    added_at: 0,
    added_by: 'test',
  };
}

describe('blendVerified', () => {
  it('returns local score when there are no external attestations', () => {
    const result = blendVerified(45, []);
    expect(result.score).toBe(45);
    expect(result.sources).toEqual(['local']);
    expect(result.breakdown.effective_external_weight).toBe(0);
    expect(result.breakdown.external_weighted_avg).toBeNull();
  });

  it('blends local with one external at the issuer cap', () => {
    // Local = 40, one external = 80, issuer max_weight = 0.2 (so 20% influence)
    // Expected: 40 * 0.8 + 80 * 0.2 = 32 + 16 = 48
    const result = blendVerified(40, [
      {
        attestation: mkAttestation('did:web:nobulex.com', 80),
        issuer: mkIssuer('did:web:nobulex.com', 0.2),
      },
    ]);
    expect(result.score).toBeCloseTo(48, 5);
    expect(result.sources).toContain('did:web:nobulex.com');
    expect(result.sources).toContain('local');
    expect(result.breakdown.local).toBe(40);
    expect(result.breakdown.external_weighted_avg).toBe(80);
    expect(result.breakdown.effective_external_weight).toBe(0.2);
  });

  it('caps aggregate external influence at the hard cap', () => {
    // Two issuers each with weight 0.5 = aggregate 1.0, but hard cap is 0.3
    // Expected: local gets at least 70% weight, externals capped at 30%
    const result = blendVerified(
      50,
      [
        {
          attestation: mkAttestation('did:web:a.com', 100),
          issuer: mkIssuer('did:web:a.com', 0.5),
        },
        {
          attestation: mkAttestation('did:web:b.com', 100),
          issuer: mkIssuer('did:web:b.com', 0.5),
        },
      ],
      0.3,
    );

    // External weighted avg: (100*0.5 + 100*0.5) / (0.5 + 0.5) = 100
    // Effective external weight: min(0.3, 1.0) = 0.3
    // Score: 50 * 0.7 + 100 * 0.3 = 35 + 30 = 65
    expect(result.score).toBeCloseTo(65, 5);
    expect(result.breakdown.effective_external_weight).toBe(0.3);
  });

  it('weights externals proportionally when one issuer is more trusted', () => {
    // Issuer A trusted at 0.2, B at 0.05. A's score should dominate.
    const result = blendVerified(
      0,
      [
        {
          attestation: mkAttestation('did:web:trusted.com', 100),
          issuer: mkIssuer('did:web:trusted.com', 0.2),
        },
        {
          attestation: mkAttestation('did:web:less-trusted.com', 0),
          issuer: mkIssuer('did:web:less-trusted.com', 0.05),
        },
      ],
      0.3,
    );

    // External avg: (100*0.2 + 0*0.05) / 0.25 = 20/0.25 = 80
    // Effective weight: min(0.3, 0.25) = 0.25
    // Score: 0 * 0.75 + 80 * 0.25 = 20
    expect(result.score).toBeCloseTo(20, 5);
  });

  it('clamps the final score to [0, 100]', () => {
    const result = blendVerified(
      200,
      [
        {
          attestation: mkAttestation('did:web:x.com', 200),
          issuer: mkIssuer('did:web:x.com', 0.5),
        },
      ],
      0.5,
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('attributes every source in the result', () => {
    const result = blendVerified(50, [
      {
        attestation: mkAttestation('did:web:a.com', 60),
        issuer: mkIssuer('did:web:a.com', 0.1),
      },
      {
        attestation: mkAttestation('did:web:b.com', 70),
        issuer: mkIssuer('did:web:b.com', 0.1),
      },
    ]);
    expect(result.sources).toEqual(['local', 'did:web:a.com', 'did:web:b.com']);
  });

  it('never lets a single issuer move the score by more than its weight', () => {
    // Local 50, one external claiming 100, issuer trusted at 0.1
    // Max possible upward movement: (100 - 50) * 0.1 = 5
    const result = blendVerified(50, [
      {
        attestation: mkAttestation('did:web:x.com', 100),
        issuer: mkIssuer('did:web:x.com', 0.1),
      },
    ]);
    expect(result.score - 50).toBeLessThanOrEqual(5 + 1e-9);
  });
});
