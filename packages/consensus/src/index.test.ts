import { describe, it, expect } from 'vitest';
import {
  computeAccountability,
  evaluateCounterparty,
  networkAccountabilityRate,
  tierToMinScore,
  compareTiers,
} from './index';
import type {
  AccountabilityScore,
  InteractionPolicy,
  ProtocolData,
  AccountabilityTier,
} from './types';

// ---------------------------------------------------------------------------
// computeAccountability
// ---------------------------------------------------------------------------
describe('computeAccountability', () => {
  it('returns exemplary tier for perfect data', () => {
    const data: ProtocolData = {
      covenantCount: 5,
      totalInteractions: 100,
      compliantInteractions: 100,
      stakeAmount: 1000,
      maxStake: 1000,
      attestedInteractions: 100,
      canaryTests: 50,
      canaryPasses: 50,
    };
    const result = computeAccountability('agent-1', data);
    expect(result.tier).toBe('exemplary');
    expect(result.score).toBe(1.0);
    expect(result.agentId).toBe('agent-1');
  });

  it('returns unaccountable tier for zero data', () => {
    const data: ProtocolData = {
      covenantCount: 0,
      totalInteractions: 0,
      compliantInteractions: 0,
      stakeAmount: 0,
      maxStake: 0,
      attestedInteractions: 0,
      canaryTests: 0,
      canaryPasses: 0,
    };
    const result = computeAccountability('agent-zero', data);
    expect(result.tier).toBe('unaccountable');
    expect(result.score).toBe(0);
  });

  it('caps covenantCompleteness at 1.0 when more than 3 covenants', () => {
    const data: ProtocolData = {
      covenantCount: 10,
      totalInteractions: 1,
      compliantInteractions: 1,
      stakeAmount: 1,
      maxStake: 1,
      attestedInteractions: 1,
      canaryTests: 1,
      canaryPasses: 1,
    };
    const result = computeAccountability('agent-x', data);
    expect(result.components.covenantCompleteness).toBe(1.0);
  });

  it('computes partial covenantCompleteness for fewer than 3 covenants', () => {
    const data: ProtocolData = {
      covenantCount: 1,
      totalInteractions: 1,
      compliantInteractions: 1,
      stakeAmount: 1,
      maxStake: 1,
      attestedInteractions: 1,
      canaryTests: 1,
      canaryPasses: 1,
    };
    const result = computeAccountability('agent-partial', data);
    expect(result.components.covenantCompleteness).toBeCloseTo(1 / 3, 5);
  });

  it('computes correct complianceHistory', () => {
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 200,
      compliantInteractions: 150,
      stakeAmount: 500,
      maxStake: 1000,
      attestedInteractions: 100,
      canaryTests: 10,
      canaryPasses: 8,
    };
    const result = computeAccountability('agent-comp', data);
    expect(result.components.complianceHistory).toBeCloseTo(0.75, 5);
  });

  it('computes correct stakeRatio', () => {
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 10,
      compliantInteractions: 10,
      stakeAmount: 250,
      maxStake: 1000,
      attestedInteractions: 10,
      canaryTests: 10,
      canaryPasses: 10,
    };
    const result = computeAccountability('agent-stake', data);
    expect(result.components.stakeRatio).toBeCloseTo(0.25, 5);
  });

  it('score is average of all five components', () => {
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 100,
      compliantInteractions: 80,
      stakeAmount: 600,
      maxStake: 1000,
      attestedInteractions: 70,
      canaryTests: 20,
      canaryPasses: 18,
    };
    const result = computeAccountability('agent-avg', data);
    const expected = (1.0 + 0.8 + 0.6 + 0.7 + 0.9) / 5;
    expect(result.score).toBeCloseTo(expected, 5);
  });

  it('assigns trusted tier for score >= 0.7 and < 0.9', () => {
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 100,
      compliantInteractions: 70,
      stakeAmount: 700,
      maxStake: 1000,
      attestedInteractions: 70,
      canaryTests: 10,
      canaryPasses: 10,
    };
    const result = computeAccountability('agent-trusted', data);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.score).toBeLessThan(0.9);
    expect(result.tier).toBe('trusted');
  });

  it('assigns basic tier for score >= 0.3 and < 0.5', () => {
    const data: ProtocolData = {
      covenantCount: 1,
      totalInteractions: 100,
      compliantInteractions: 30,
      stakeAmount: 100,
      maxStake: 1000,
      attestedInteractions: 30,
      canaryTests: 10,
      canaryPasses: 5,
    };
    const result = computeAccountability('agent-basic', data);
    expect(result.score).toBeGreaterThanOrEqual(0.3);
    expect(result.score).toBeLessThan(0.5);
    expect(result.tier).toBe('basic');
  });

  it('handles totalInteractions of zero gracefully (divides by 1)', () => {
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 0,
      compliantInteractions: 0,
      stakeAmount: 500,
      maxStake: 1000,
      attestedInteractions: 0,
      canaryTests: 10,
      canaryPasses: 10,
    };
    const result = computeAccountability('agent-noint', data);
    expect(result.components.complianceHistory).toBe(0);
    expect(result.components.attestationCoverage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateCounterparty
// ---------------------------------------------------------------------------
describe('evaluateCounterparty', () => {
  const exemplaryScore: AccountabilityScore = {
    agentId: 'exemplary-agent',
    score: 0.95,
    components: {
      covenantCompleteness: 1.0,
      complianceHistory: 0.95,
      stakeRatio: 0.9,
      attestationCoverage: 0.95,
      canaryPassRate: 1.0,
    },
    tier: 'exemplary',
  };

  const basicScore: AccountabilityScore = {
    agentId: 'basic-agent',
    score: 0.35,
    components: {
      covenantCompleteness: 0.33,
      complianceHistory: 0.4,
      stakeRatio: 0.3,
      attestationCoverage: 0.35,
      canaryPassRate: 0.37,
    },
    tier: 'basic',
  };

  const noStakeScore: AccountabilityScore = {
    agentId: 'nostake-agent',
    score: 0.7,
    components: {
      covenantCompleteness: 1.0,
      complianceHistory: 0.9,
      stakeRatio: 0,
      attestationCoverage: 0.8,
      canaryPassRate: 0.8,
    },
    tier: 'trusted',
  };

  it('allows counterparty that meets all policy requirements', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'trusted',
      minimumScore: 0.8,
      requireStake: true,
      requireAttestation: true,
    };
    const decision = evaluateCounterparty(policy, exemplaryScore);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('meets all policy requirements');
  });

  it('rejects counterparty with insufficient tier', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'trusted',
      minimumScore: 0.3,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, basicScore);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('tier');
  });

  it('rejects counterparty with insufficient score', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'basic',
      minimumScore: 0.9,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, basicScore);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('score');
  });

  it('rejects counterparty with no stake when stake is required', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'basic',
      minimumScore: 0.3,
      requireStake: true,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, noStakeScore);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('stake');
  });

  it('rejects counterparty with no attestation when attestation is required', () => {
    const noAttScore: AccountabilityScore = {
      agentId: 'noatt',
      score: 0.7,
      components: {
        covenantCompleteness: 1.0,
        complianceHistory: 0.9,
        stakeRatio: 0.8,
        attestationCoverage: 0,
        canaryPassRate: 0.8,
      },
      tier: 'trusted',
    };
    const policy: InteractionPolicy = {
      minimumTier: 'basic',
      minimumScore: 0.3,
      requireStake: false,
      requireAttestation: true,
    };
    const decision = evaluateCounterparty(policy, noAttScore);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('attestation');
  });

  it('computes riskAdjustment as 1 - score', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'unaccountable',
      minimumScore: 0,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, exemplaryScore);
    expect(decision.riskAdjustment).toBeCloseTo(1 - 0.95, 5);
  });

  it('returns the counterparty score in the decision', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'unaccountable',
      minimumScore: 0,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, basicScore);
    expect(decision.counterpartyScore).toBe(basicScore);
  });
});

// ---------------------------------------------------------------------------
// networkAccountabilityRate
// ---------------------------------------------------------------------------
describe('networkAccountabilityRate', () => {
  it('returns 0 for an empty array', () => {
    expect(networkAccountabilityRate([])).toBe(0);
  });

  it('returns the score of a single agent', () => {
    const scores: AccountabilityScore[] = [
      {
        agentId: 'a',
        score: 0.75,
        components: {
          covenantCompleteness: 1,
          complianceHistory: 0.8,
          stakeRatio: 0.6,
          attestationCoverage: 0.7,
          canaryPassRate: 0.65,
        },
        tier: 'trusted',
      },
    ];
    expect(networkAccountabilityRate(scores)).toBe(0.75);
  });

  it('returns the average score of multiple agents', () => {
    const scores: AccountabilityScore[] = [
      {
        agentId: 'a',
        score: 0.8,
        components: { covenantCompleteness: 1, complianceHistory: 1, stakeRatio: 1, attestationCoverage: 1, canaryPassRate: 1 },
        tier: 'trusted',
      },
      {
        agentId: 'b',
        score: 0.4,
        components: { covenantCompleteness: 0.5, complianceHistory: 0.5, stakeRatio: 0.5, attestationCoverage: 0.5, canaryPassRate: 0.5 },
        tier: 'basic',
      },
    ];
    expect(networkAccountabilityRate(scores)).toBeCloseTo(0.6, 5);
  });
});

// ---------------------------------------------------------------------------
// tierToMinScore
// ---------------------------------------------------------------------------
describe('tierToMinScore', () => {
  it('returns 0.9 for exemplary', () => {
    expect(tierToMinScore('exemplary')).toBe(0.9);
  });

  it('returns 0.7 for trusted', () => {
    expect(tierToMinScore('trusted')).toBe(0.7);
  });

  it('returns 0.5 for verified', () => {
    expect(tierToMinScore('verified')).toBe(0.5);
  });

  it('returns 0.3 for basic', () => {
    expect(tierToMinScore('basic')).toBe(0.3);
  });

  it('returns 0 for unaccountable', () => {
    expect(tierToMinScore('unaccountable')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compareTiers
// ---------------------------------------------------------------------------
describe('compareTiers', () => {
  it('returns 0 for equal tiers', () => {
    expect(compareTiers('trusted', 'trusted')).toBe(0);
  });

  it('returns -1 when first tier is lower', () => {
    expect(compareTiers('basic', 'trusted')).toBe(-1);
  });

  it('returns 1 when first tier is higher', () => {
    expect(compareTiers('exemplary', 'basic')).toBe(1);
  });

  it('returns -1 for unaccountable vs exemplary', () => {
    expect(compareTiers('unaccountable', 'exemplary')).toBe(-1);
  });

  it('returns 1 for exemplary vs unaccountable', () => {
    expect(compareTiers('exemplary', 'unaccountable')).toBe(1);
  });
});
