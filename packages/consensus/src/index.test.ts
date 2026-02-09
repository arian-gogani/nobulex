import { describe, it, expect } from 'vitest';
import {
  computeAccountability,
  evaluateCounterparty,
  networkAccountabilityRate,
  tierToMinScore,
  compareTiers,
  validateConfig,
  validateProtocolData,
  validatePolicy,
  byzantineFaultTolerance,
  quorumSize,
  consensusLatency,
} from './index';
import type {
  AccountabilityScore,
  InteractionPolicy,
  ProtocolData,
  AccountabilityTier,
} from './types';
import type { AccountabilityConfig, ConsensusProtocol, ConsensusLatencyParams } from './index';

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------
describe('validateConfig', () => {
  it('accepts valid config', () => {
    expect(() =>
      validateConfig({
        tierThresholds: { exemplary: 0.9, trusted: 0.7, verified: 0.5, basic: 0.3 },
        componentWeights: {
          covenantCompleteness: 0.15,
          complianceHistory: 0.30,
          stakeRatio: 0.20,
          attestationCoverage: 0.20,
          canaryPassRate: 0.15,
        },
        minimumCovenants: 3,
      }),
    ).not.toThrow();
  });

  it('accepts empty config', () => {
    expect(() => validateConfig({})).not.toThrow();
  });

  it('throws on tier threshold out of range', () => {
    expect(() =>
      validateConfig({
        tierThresholds: { exemplary: 1.5, trusted: 0.7, verified: 0.5, basic: 0.3 },
      }),
    ).toThrow("Tier threshold 'exemplary' must be in [0, 1]");
  });

  it('throws on unordered tier thresholds', () => {
    expect(() =>
      validateConfig({
        tierThresholds: { exemplary: 0.5, trusted: 0.7, verified: 0.5, basic: 0.3 },
      }),
    ).toThrow('Tier thresholds must be strictly ordered');
  });

  it('throws on negative component weight', () => {
    expect(() =>
      validateConfig({
        componentWeights: {
          covenantCompleteness: -0.1,
          complianceHistory: 0.35,
          stakeRatio: 0.25,
          attestationCoverage: 0.25,
          canaryPassRate: 0.25,
        },
      }),
    ).toThrow("Component weight 'covenantCompleteness' must be >= 0");
  });

  it('throws when component weights do not sum to 1.0', () => {
    expect(() =>
      validateConfig({
        componentWeights: {
          covenantCompleteness: 0.1,
          complianceHistory: 0.1,
          stakeRatio: 0.1,
          attestationCoverage: 0.1,
          canaryPassRate: 0.1,
        },
      }),
    ).toThrow('Component weights must sum to approximately 1.0');
  });

  it('throws on minimumCovenants < 1', () => {
    expect(() => validateConfig({ minimumCovenants: 0 })).toThrow(
      'minimumCovenants must be >= 1',
    );
  });
});

// ---------------------------------------------------------------------------
// validateProtocolData
// ---------------------------------------------------------------------------
describe('validateProtocolData', () => {
  it('accepts valid data', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 5,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 70,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).not.toThrow();
  });

  it('throws on negative covenantCount', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: -1,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 70,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).toThrow('covenantCount must be >= 0');
  });

  it('throws when compliantInteractions > totalInteractions', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 3,
        totalInteractions: 50,
        compliantInteractions: 100,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 50,
        canaryTests: 10,
        canaryPasses: 10,
      }),
    ).toThrow('compliantInteractions (100) must be <= totalInteractions (50)');
  });

  it('throws when canaryPasses > canaryTests', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 3,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 70,
        canaryTests: 10,
        canaryPasses: 15,
      }),
    ).toThrow('canaryPasses (15) must be <= canaryTests (10)');
  });

  it('throws on negative stakeAmount', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 3,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: -10,
        maxStake: 1000,
        attestedInteractions: 70,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).toThrow('stakeAmount must be >= 0');
  });

  it('throws on negative maxStake', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 3,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: 500,
        maxStake: -1,
        attestedInteractions: 70,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).toThrow('maxStake must be >= 0');
  });

  it('throws on negative totalInteractions', () => {
    expect(() =>
      validateProtocolData({
        covenantCount: 3,
        totalInteractions: -1,
        compliantInteractions: 0,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 0,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).toThrow('totalInteractions must be >= 0');
  });
});

// ---------------------------------------------------------------------------
// validatePolicy
// ---------------------------------------------------------------------------
describe('validatePolicy', () => {
  it('accepts valid policy', () => {
    expect(() =>
      validatePolicy({
        minimumTier: 'trusted',
        minimumScore: 0.7,
        requireStake: true,
        requireAttestation: false,
      }),
    ).not.toThrow();
  });

  it('throws on minimumScore > 1', () => {
    expect(() =>
      validatePolicy({
        minimumTier: 'basic',
        minimumScore: 1.5,
        requireStake: false,
        requireAttestation: false,
      }),
    ).toThrow('minimumScore must be in [0, 1]');
  });

  it('throws on minimumScore < 0', () => {
    expect(() =>
      validatePolicy({
        minimumTier: 'basic',
        minimumScore: -0.1,
        requireStake: false,
        requireAttestation: false,
      }),
    ).toThrow('minimumScore must be in [0, 1]');
  });
});

// ---------------------------------------------------------------------------
// computeAccountability
// ---------------------------------------------------------------------------
describe('computeAccountability', () => {
  it('returns exemplary tier for perfect data with default config', () => {
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
    expect(result.score).toBeCloseTo(1.0, 10);
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

  it('caps covenantCompleteness at 1.0 when more than minimumCovenants', () => {
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

  it('computes partial covenantCompleteness for fewer than minimumCovenants', () => {
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

  it('score is weighted sum of all five components', () => {
    const data: ProtocolData = {
      covenantCount: 3,   // covenantCompleteness = 1.0
      totalInteractions: 100,
      compliantInteractions: 80,  // complianceHistory = 0.8
      stakeAmount: 600,
      maxStake: 1000,   // stakeRatio = 0.6
      attestedInteractions: 70,  // attestationCoverage = 0.7
      canaryTests: 20,
      canaryPasses: 18,  // canaryPassRate = 0.9
    };
    const result = computeAccountability('agent-avg', data);
    // weighted: 0.15*1.0 + 0.30*0.8 + 0.20*0.6 + 0.20*0.7 + 0.15*0.9
    const expected = 0.15 * 1.0 + 0.30 * 0.8 + 0.20 * 0.6 + 0.20 * 0.7 + 0.15 * 0.9;
    expect(result.score).toBeCloseTo(expected, 5);
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

  it('uses custom config when provided', () => {
    const config: AccountabilityConfig = {
      minimumCovenants: 5,
      componentWeights: {
        covenantCompleteness: 0.10,
        complianceHistory: 0.40,
        stakeRatio: 0.20,
        attestationCoverage: 0.15,
        canaryPassRate: 0.15,
      },
    };
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
    const result = computeAccountability('agent-custom', data, config);
    expect(result.score).toBe(1.0);
    expect(result.components.covenantCompleteness).toBe(1.0);
  });

  it('uses custom minimumCovenants', () => {
    const config: AccountabilityConfig = { minimumCovenants: 5 };
    const data: ProtocolData = {
      covenantCount: 3,
      totalInteractions: 100,
      compliantInteractions: 100,
      stakeAmount: 1000,
      maxStake: 1000,
      attestedInteractions: 100,
      canaryTests: 50,
      canaryPasses: 50,
    };
    const result = computeAccountability('agent-custom', data, config);
    expect(result.components.covenantCompleteness).toBeCloseTo(3 / 5, 5);
  });

  it('uses custom tier thresholds', () => {
    const config: AccountabilityConfig = {
      tierThresholds: { exemplary: 0.95, trusted: 0.8, verified: 0.6, basic: 0.4 },
    };
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
    const result = computeAccountability('agent-thr', data, config);
    // score = 1.0, exemplary threshold = 0.95, so still exemplary
    expect(result.tier).toBe('exemplary');
  });

  it('throws on invalid protocol data', () => {
    expect(() =>
      computeAccountability('agent-bad', {
        covenantCount: -1,
        totalInteractions: 100,
        compliantInteractions: 80,
        stakeAmount: 500,
        maxStake: 1000,
        attestedInteractions: 70,
        canaryTests: 20,
        canaryPasses: 18,
      }),
    ).toThrow('covenantCount must be >= 0');
  });

  it('throws on invalid config', () => {
    expect(() =>
      computeAccountability(
        'agent-bad',
        {
          covenantCount: 3,
          totalInteractions: 100,
          compliantInteractions: 80,
          stakeAmount: 500,
          maxStake: 1000,
          attestedInteractions: 70,
          canaryTests: 20,
          canaryPasses: 18,
        },
        { minimumCovenants: 0 },
      ),
    ).toThrow('minimumCovenants must be >= 1');
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

  it('computes riskAdjustment as 1 - score for allowed counterparty', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'unaccountable',
      minimumScore: 0,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, exemplaryScore);
    // For allowed: deficit = 0, so riskAdjustment = 1 - 0.95 = 0.05
    expect(decision.riskAdjustment).toBeCloseTo(1 - 0.95, 5);
  });

  it('computes higher riskAdjustment for denied counterparty below threshold', () => {
    const policy: InteractionPolicy = {
      minimumTier: 'basic',
      minimumScore: 0.9,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, basicScore);
    // baseRisk = 1 - 0.35 = 0.65, deficit = 0.9 - 0.35 = 0.55
    // riskAdjustment = min(1, 0.65 + 0.55) = 1.0
    expect(decision.allowed).toBe(false);
    expect(decision.riskAdjustment).toBeCloseTo(1.0, 5);
  });

  it('riskAdjustment includes deficit for near-threshold denial', () => {
    const nearScore: AccountabilityScore = {
      agentId: 'near',
      score: 0.75,
      components: {
        covenantCompleteness: 1.0,
        complianceHistory: 0.8,
        stakeRatio: 0.7,
        attestationCoverage: 0.7,
        canaryPassRate: 0.55,
      },
      tier: 'trusted',
    };
    const policy: InteractionPolicy = {
      minimumTier: 'trusted',
      minimumScore: 0.8,
      requireStake: false,
      requireAttestation: false,
    };
    const decision = evaluateCounterparty(policy, nearScore);
    // baseRisk = 1 - 0.75 = 0.25, deficit = 0.8 - 0.75 = 0.05
    // riskAdjustment = min(1, 0.25 + 0.05) = 0.30
    expect(decision.allowed).toBe(false);
    expect(decision.riskAdjustment).toBeCloseTo(0.30, 5);
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

  it('throws on invalid policy', () => {
    expect(() =>
      evaluateCounterparty(
        {
          minimumTier: 'basic',
          minimumScore: 1.5,
          requireStake: false,
          requireAttestation: false,
        },
        exemplaryScore,
      ),
    ).toThrow('minimumScore must be in [0, 1]');
  });

  it('throws on invalid counterparty score', () => {
    const badScore: AccountabilityScore = {
      agentId: 'bad',
      score: 1.5,
      components: {
        covenantCompleteness: 1.0,
        complianceHistory: 1.0,
        stakeRatio: 1.0,
        attestationCoverage: 1.0,
        canaryPassRate: 1.0,
      },
      tier: 'exemplary',
    };
    expect(() =>
      evaluateCounterparty(
        {
          minimumTier: 'basic',
          minimumScore: 0.3,
          requireStake: false,
          requireAttestation: false,
        },
        badScore,
      ),
    ).toThrow('AccountabilityScore.score must be in [0, 1]');
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
  it('returns 0.9 for exemplary (default)', () => {
    expect(tierToMinScore('exemplary')).toBe(0.9);
  });

  it('returns 0.7 for trusted (default)', () => {
    expect(tierToMinScore('trusted')).toBe(0.7);
  });

  it('returns 0.5 for verified (default)', () => {
    expect(tierToMinScore('verified')).toBe(0.5);
  });

  it('returns 0.3 for basic (default)', () => {
    expect(tierToMinScore('basic')).toBe(0.3);
  });

  it('returns 0 for unaccountable', () => {
    expect(tierToMinScore('unaccountable')).toBe(0);
  });

  it('returns custom threshold when config provided', () => {
    const config: AccountabilityConfig = {
      tierThresholds: { exemplary: 0.95, trusted: 0.8, verified: 0.6, basic: 0.4 },
    };
    expect(tierToMinScore('exemplary', config)).toBe(0.95);
    expect(tierToMinScore('trusted', config)).toBe(0.8);
    expect(tierToMinScore('verified', config)).toBe(0.6);
    expect(tierToMinScore('basic', config)).toBe(0.4);
    expect(tierToMinScore('unaccountable', config)).toBe(0);
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

// ---------------------------------------------------------------------------
// byzantineFaultTolerance
// ---------------------------------------------------------------------------
describe('byzantineFaultTolerance', () => {
  it('computes max faults for 4 nodes: floor((4-1)/3) = 1', () => {
    const result = byzantineFaultTolerance(4);
    expect(result.maxFaultyNodes).toBe(1);
    expect(result.canTolerate).toBe(true);
    expect(result.minNodesRequired).toBe(4); // 3*1+1
  });

  it('computes max faults for 7 nodes: floor((7-1)/3) = 2', () => {
    const result = byzantineFaultTolerance(7);
    expect(result.maxFaultyNodes).toBe(2);
  });

  it('computes max faults for 10 nodes: floor((10-1)/3) = 3', () => {
    const result = byzantineFaultTolerance(10);
    expect(result.maxFaultyNodes).toBe(3);
  });

  it('1 node can tolerate 0 faults', () => {
    const result = byzantineFaultTolerance(1);
    expect(result.maxFaultyNodes).toBe(0);
  });

  it('3 nodes can tolerate 0 faults (3 < 3*1+1=4)', () => {
    const result = byzantineFaultTolerance(3);
    expect(result.maxFaultyNodes).toBe(0);
  });

  it('checks requested fault tolerance (can tolerate)', () => {
    const result = byzantineFaultTolerance(7, 2);
    expect(result.canTolerate).toBe(true);
    expect(result.minNodesRequired).toBe(7); // 3*2+1
  });

  it('checks requested fault tolerance (cannot tolerate)', () => {
    const result = byzantineFaultTolerance(4, 2);
    expect(result.canTolerate).toBe(false);
    expect(result.minNodesRequired).toBe(7); // 3*2+1
  });

  it('formula contains BFT constraint text', () => {
    const result = byzantineFaultTolerance(10);
    expect(result.formula).toContain('n >= 3f + 1');
    expect(result.formula).toContain('10');
  });

  it('n >= 3f+1 property holds for various n', () => {
    for (const n of [1, 4, 7, 10, 13, 100]) {
      const result = byzantineFaultTolerance(n);
      expect(n).toBeGreaterThanOrEqual(3 * result.maxFaultyNodes + 1);
      // And n < 3*(f+1) + 1 (maximality)
      if (result.maxFaultyNodes < n - 1) {
        expect(n).toBeLessThan(3 * (result.maxFaultyNodes + 1) + 1);
      }
    }
  });

  it('throws on non-positive totalNodes', () => {
    expect(() => byzantineFaultTolerance(0)).toThrow('totalNodes must be a positive integer');
    expect(() => byzantineFaultTolerance(-1)).toThrow('totalNodes must be a positive integer');
  });

  it('throws on non-integer totalNodes', () => {
    expect(() => byzantineFaultTolerance(3.5)).toThrow('totalNodes must be a positive integer');
  });

  it('throws on negative requestedFaults', () => {
    expect(() => byzantineFaultTolerance(10, -1)).toThrow(
      'requestedFaults must be a non-negative integer',
    );
  });

  it('throws on non-integer requestedFaults', () => {
    expect(() => byzantineFaultTolerance(10, 1.5)).toThrow(
      'requestedFaults must be a non-negative integer',
    );
  });
});

// ---------------------------------------------------------------------------
// quorumSize
// ---------------------------------------------------------------------------
describe('quorumSize', () => {
  it('simple_majority for 10 nodes: floor(10/2)+1 = 6', () => {
    const result = quorumSize(10, 'simple_majority');
    expect(result.quorumSize).toBe(6);
    expect(result.quorumFraction).toBeCloseTo(0.6, 5);
  });

  it('simple_majority for 7 nodes: floor(7/2)+1 = 4', () => {
    const result = quorumSize(7, 'simple_majority');
    expect(result.quorumSize).toBe(4);
  });

  it('simple_majority for 1 node: 1', () => {
    const result = quorumSize(1, 'simple_majority');
    expect(result.quorumSize).toBe(1);
  });

  it('bft quorum for 10 nodes: floor(20/3)+1 = 7', () => {
    const result = quorumSize(10, 'bft');
    expect(result.quorumSize).toBe(7);
  });

  it('bft quorum for 4 nodes: floor(8/3)+1 = 3', () => {
    const result = quorumSize(4, 'bft');
    expect(result.quorumSize).toBe(3);
  });

  it('two_thirds for 10 nodes: ceil(20/3) = 7', () => {
    const result = quorumSize(10, 'two_thirds');
    expect(result.quorumSize).toBe(7);
  });

  it('two_thirds for 3 nodes: ceil(6/3) = 2', () => {
    const result = quorumSize(3, 'two_thirds');
    expect(result.quorumSize).toBe(2);
  });

  it('unanimous for any n: quorum = n', () => {
    const result = quorumSize(10, 'unanimous');
    expect(result.quorumSize).toBe(10);
    expect(result.quorumFraction).toBe(1);
  });

  it('bft quorum is always > simple majority', () => {
    for (const n of [4, 7, 10, 20, 100]) {
      const bft = quorumSize(n, 'bft');
      const simple = quorumSize(n, 'simple_majority');
      expect(bft.quorumSize).toBeGreaterThanOrEqual(simple.quorumSize);
    }
  });

  it('formula contains protocol-specific description', () => {
    expect(quorumSize(10, 'simple_majority').formula).toContain('Simple majority');
    expect(quorumSize(10, 'bft').formula).toContain('BFT quorum');
    expect(quorumSize(10, 'two_thirds').formula).toContain('Two-thirds');
    expect(quorumSize(10, 'unanimous').formula).toContain('Unanimous');
  });

  it('quorum never exceeds totalNodes', () => {
    const result = quorumSize(1, 'bft');
    expect(result.quorumSize).toBeLessThanOrEqual(1);
  });

  it('throws on non-positive totalNodes', () => {
    expect(() => quorumSize(0, 'simple_majority')).toThrow(
      'totalNodes must be a positive integer',
    );
  });

  it('throws on non-integer totalNodes', () => {
    expect(() => quorumSize(3.5, 'bft')).toThrow(
      'totalNodes must be a positive integer',
    );
  });
});

// ---------------------------------------------------------------------------
// consensusLatency
// ---------------------------------------------------------------------------
describe('consensusLatency', () => {
  it('computes basic latency without loss or processing', () => {
    const result = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 50,
      messageRounds: 3,
    });
    // networkLatency = 3 * 50 = 150
    expect(result.networkLatencyMs).toBe(150);
    expect(result.processingLatencyMs).toBe(0);
    expect(result.retryOverheadMs).toBe(0);
    expect(result.estimatedLatencyMs).toBe(150);
  });

  it('includes processing time per round', () => {
    const result = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 50,
      messageRounds: 3,
      processingTimeMs: 10,
    });
    // processing = 3 * 10 = 30
    expect(result.processingLatencyMs).toBe(30);
    expect(result.estimatedLatencyMs).toBe(180);
  });

  it('includes retry overhead from message loss', () => {
    const result = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 100,
      messageRounds: 2,
      messageLossProbability: 0.1,
    });
    // networkLatency = 200
    // retryOverhead = 200 * (0.1 / 0.9) = 200 * 0.1111... = 22.22...
    expect(result.networkLatencyMs).toBe(200);
    expect(result.retryOverheadMs).toBeCloseTo(200 * (0.1 / 0.9), 5);
    expect(result.estimatedLatencyMs).toBeCloseTo(200 + 200 * (0.1 / 0.9), 5);
  });

  it('higher message loss leads to higher latency', () => {
    const low = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 100,
      messageRounds: 3,
      messageLossProbability: 0.05,
    });
    const high = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 100,
      messageRounds: 3,
      messageLossProbability: 0.3,
    });
    expect(high.estimatedLatencyMs).toBeGreaterThan(low.estimatedLatencyMs);
  });

  it('more rounds leads to higher latency', () => {
    const few = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 50,
      messageRounds: 2,
    });
    const many = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 50,
      messageRounds: 5,
    });
    expect(many.estimatedLatencyMs).toBeGreaterThan(few.estimatedLatencyMs);
  });

  it('formula contains breakdown', () => {
    const result = consensusLatency({
      nodeCount: 10,
      averageLatencyMs: 50,
      messageRounds: 3,
      processingTimeMs: 5,
      messageLossProbability: 0.1,
    });
    expect(result.formula).toContain('Network latency');
    expect(result.formula).toContain('Processing latency');
    expect(result.formula).toContain('Retry overhead');
    expect(result.formula).toContain('Total estimated');
  });

  it('zero latency network returns zero total', () => {
    const result = consensusLatency({
      nodeCount: 5,
      averageLatencyMs: 0,
      messageRounds: 3,
    });
    expect(result.estimatedLatencyMs).toBe(0);
  });

  it('throws on non-positive nodeCount', () => {
    expect(() =>
      consensusLatency({ nodeCount: 0, averageLatencyMs: 50, messageRounds: 3 }),
    ).toThrow('nodeCount must be a positive integer');
  });

  it('throws on negative averageLatencyMs', () => {
    expect(() =>
      consensusLatency({ nodeCount: 10, averageLatencyMs: -10, messageRounds: 3 }),
    ).toThrow('averageLatencyMs must be >= 0');
  });

  it('throws on non-positive messageRounds', () => {
    expect(() =>
      consensusLatency({ nodeCount: 10, averageLatencyMs: 50, messageRounds: 0 }),
    ).toThrow('messageRounds must be a positive integer');
  });

  it('throws on messageLossProbability >= 1', () => {
    expect(() =>
      consensusLatency({
        nodeCount: 10,
        averageLatencyMs: 50,
        messageRounds: 3,
        messageLossProbability: 1,
      }),
    ).toThrow('messageLossProbability must be in [0, 1)');
  });

  it('throws on negative messageLossProbability', () => {
    expect(() =>
      consensusLatency({
        nodeCount: 10,
        averageLatencyMs: 50,
        messageRounds: 3,
        messageLossProbability: -0.1,
      }),
    ).toThrow('messageLossProbability must be in [0, 1)');
  });

  it('throws on negative processingTimeMs', () => {
    expect(() =>
      consensusLatency({
        nodeCount: 10,
        averageLatencyMs: 50,
        messageRounds: 3,
        processingTimeMs: -5,
      }),
    ).toThrow('processingTimeMs must be >= 0');
  });
});
