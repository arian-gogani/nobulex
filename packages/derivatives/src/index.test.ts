import { describe, it, expect } from 'vitest';
import {
  assessRisk,
  priceInsurance,
  createPolicy,
  createFuture,
  settleFuture,
  claimPolicy,
} from './index';
import type {
  ReputationData,
  RiskAssessment,
  TrustFuture,
  AgentInsurancePolicy,
} from './types';

// ---------------------------------------------------------------------------
// Helper data
// ---------------------------------------------------------------------------
const goodReputation: ReputationData = {
  trustScore: 0.95,
  complianceRate: 0.98,
  breachCount: 1,
  totalInteractions: 1000,
  stakeAmount: 1.0,
  age: 730, // 2 years
};

const badReputation: ReputationData = {
  trustScore: 0.3,
  complianceRate: 0.4,
  breachCount: 200,
  totalInteractions: 500,
  stakeAmount: 0.1,
  age: 30,
};

const newAgentReputation: ReputationData = {
  trustScore: 0.5,
  complianceRate: 0.5,
  breachCount: 0,
  totalInteractions: 0,
  stakeAmount: 0,
  age: 0,
};

// ---------------------------------------------------------------------------
// assessRisk
// ---------------------------------------------------------------------------
describe('assessRisk', () => {
  it('returns a RiskAssessment with correct agentId', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.agentId).toBe('agent-1');
  });

  it('returns 5 risk factors', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.factors).toHaveLength(5);
  });

  it('computes lower breach probability for good reputation', () => {
    const goodRisk = assessRisk('good-agent', goodReputation);
    const badRisk = assessRisk('bad-agent', badReputation);
    expect(goodRisk.breachProbability).toBeLessThan(badRisk.breachProbability);
  });

  it('expectedLoss equals breachProbability * 1.0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.expectedLoss).toBeCloseTo(risk.breachProbability * 1.0, 10);
  });

  it('recommendedPremium equals expectedLoss * 1.5', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.recommendedPremium).toBeCloseTo(risk.expectedLoss * 1.5, 10);
  });

  it('breachHistory factor = breachCount / totalInteractions', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const breachHistory = risk.factors.find(f => f.name === 'breachHistory');
    expect(breachHistory).toBeDefined();
    expect(breachHistory!.value).toBeCloseTo(1 / 1000, 10);
    expect(breachHistory!.weight).toBe(0.3);
  });

  it('trustDeficit factor = 1 - trustScore', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const trustDeficit = risk.factors.find(f => f.name === 'trustDeficit');
    expect(trustDeficit).toBeDefined();
    expect(trustDeficit!.value).toBeCloseTo(0.05, 10);
  });

  it('complianceGap factor = 1 - complianceRate', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const complianceGap = risk.factors.find(f => f.name === 'complianceGap');
    expect(complianceGap).toBeDefined();
    expect(complianceGap!.value).toBeCloseTo(0.02, 10);
  });

  it('stakeRatio factor = 1 - min(stakeAmount, 1)', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const stakeRatio = risk.factors.find(f => f.name === 'stakeRatio');
    expect(stakeRatio).toBeDefined();
    expect(stakeRatio!.value).toBeCloseTo(0, 10); // stakeAmount = 1.0
  });

  it('maturity factor = 1 / (1 + age/365)', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const maturity = risk.factors.find(f => f.name === 'maturity');
    expect(maturity).toBeDefined();
    expect(maturity!.value).toBeCloseTo(1 / (1 + 730 / 365), 10);
  });

  it('handles zero totalInteractions without division by zero', () => {
    const risk = assessRisk('new-agent', newAgentReputation);
    const breachHistory = risk.factors.find(f => f.name === 'breachHistory');
    expect(breachHistory!.value).toBe(0);
  });

  it('all factor weights sum to 1.0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const totalWeight = risk.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 10);
  });

  it('breachProbability is bounded between 0 and 1 for good reputation', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.breachProbability).toBeGreaterThanOrEqual(0);
    expect(risk.breachProbability).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// priceInsurance
// ---------------------------------------------------------------------------
describe('priceInsurance', () => {
  it('computes premium based on breach probability, coverage, and term', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const premium = priceInsurance(risk, 10000, 365);
    const expected = risk.breachProbability * 10000 * (365 / 365) * 1.5;
    const minimum = 10000 * 0.01;
    expect(premium).toBeCloseTo(Math.max(expected, minimum), 5);
  });

  it('enforces minimum premium of coverage * 0.01', () => {
    const lowRisk: RiskAssessment = {
      agentId: 'low-risk',
      breachProbability: 0.0001,
      expectedLoss: 0.0001,
      recommendedPremium: 0.00015,
      factors: [],
    };
    const premium = priceInsurance(lowRisk, 1000, 30);
    const minimum = 1000 * 0.01;
    expect(premium).toBe(minimum);
  });

  it('higher breach probability leads to higher premium', () => {
    const lowRisk = assessRisk('good', goodReputation);
    const highRisk = assessRisk('bad', badReputation);
    const lowPremium = priceInsurance(lowRisk, 10000, 365);
    const highPremium = priceInsurance(highRisk, 10000, 365);
    expect(highPremium).toBeGreaterThan(lowPremium);
  });

  it('longer term leads to higher premium', () => {
    const risk = assessRisk('agent-1', badReputation);
    const shortTerm = priceInsurance(risk, 10000, 30);
    const longTerm = priceInsurance(risk, 10000, 365);
    expect(longTerm).toBeGreaterThan(shortTerm);
  });
});

// ---------------------------------------------------------------------------
// createPolicy
// ---------------------------------------------------------------------------
describe('createPolicy', () => {
  it('creates a policy with unique id', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const policy = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    expect(policy.id).toBeTruthy();
    expect(typeof policy.id).toBe('string');
    expect(policy.id.length).toBe(32);
  });

  it('sets correct fields on the policy', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const policy = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    expect(policy.agentId).toBe('agent-1');
    expect(policy.covenantId).toBe('covenant-1');
    expect(policy.coverage).toBe(10000);
    expect(policy.underwriter).toBe('underwriter-1');
    expect(policy.term).toBe(365);
    expect(policy.status).toBe('active');
    expect(policy.riskScore).toBe(risk.breachProbability);
  });

  it('computes premium via priceInsurance', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const policy = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    const expectedPremium = priceInsurance(risk, 10000, 365);
    expect(policy.premium).toBeCloseTo(expectedPremium, 5);
  });

  it('sets createdAt to a recent timestamp', () => {
    const before = Date.now();
    const risk = assessRisk('agent-1', goodReputation);
    const policy = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    const after = Date.now();
    expect(policy.createdAt).toBeGreaterThanOrEqual(before);
    expect(policy.createdAt).toBeLessThanOrEqual(after);
  });

  it('generates different ids for different policies', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const p1 = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    const p2 = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1');
    expect(p1.id).not.toBe(p2.id);
  });
});

// ---------------------------------------------------------------------------
// createFuture
// ---------------------------------------------------------------------------
describe('createFuture', () => {
  it('creates a TrustFuture with unique id', () => {
    const future = createFuture('agent-1', 'trustScore', 0.9, Date.now() + 86400000, 100, 'holder-1');
    expect(future.id).toBeTruthy();
    expect(typeof future.id).toBe('string');
    expect(future.id.length).toBe(32);
  });

  it('sets correct fields on the future', () => {
    const settlementDate = Date.now() + 86400000;
    const future = createFuture('agent-1', 'complianceRate', 0.95, settlementDate, 50, 'holder-1');
    expect(future.agentId).toBe('agent-1');
    expect(future.metric).toBe('complianceRate');
    expect(future.targetValue).toBe(0.95);
    expect(future.settlementDate).toBe(settlementDate);
    expect(future.premium).toBe(50);
    expect(future.holder).toBe('holder-1');
    expect(future.status).toBe('active');
  });

  it('generates different ids for different futures', () => {
    const f1 = createFuture('agent-1', 'trustScore', 0.9, Date.now(), 100, 'holder-1');
    const f2 = createFuture('agent-1', 'trustScore', 0.9, Date.now(), 100, 'holder-1');
    expect(f1.id).not.toBe(f2.id);
  });
});

// ---------------------------------------------------------------------------
// settleFuture
// ---------------------------------------------------------------------------
describe('settleFuture', () => {
  it('trustScore metric met: payout = premium * 2', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.9,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.95);
    expect(settlement.payout).toBe(200);
    expect(settlement.futureId).toBe('future-1');
    expect(settlement.actualValue).toBe(0.95);
    expect(settlement.targetValue).toBe(0.9);
  });

  it('trustScore metric not met: payout = 0', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.9,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.85);
    expect(settlement.payout).toBe(0);
  });

  it('trustScore exactly at target: metric met', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.9,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.9);
    expect(settlement.payout).toBe(200);
  });

  it('complianceRate metric met: payout = premium * 2', () => {
    const future: TrustFuture = {
      id: 'future-2',
      agentId: 'agent-1',
      metric: 'complianceRate',
      targetValue: 0.95,
      settlementDate: Date.now(),
      premium: 200,
      holder: 'holder-2',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.97);
    expect(settlement.payout).toBe(400);
  });

  it('complianceRate metric not met: payout = 0', () => {
    const future: TrustFuture = {
      id: 'future-2',
      agentId: 'agent-1',
      metric: 'complianceRate',
      targetValue: 0.95,
      settlementDate: Date.now(),
      premium: 200,
      holder: 'holder-2',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.90);
    expect(settlement.payout).toBe(0);
  });

  it('breachProbability metric met (lower is better): payout = premium * 2', () => {
    const future: TrustFuture = {
      id: 'future-3',
      agentId: 'agent-1',
      metric: 'breachProbability',
      targetValue: 0.1,
      settlementDate: Date.now(),
      premium: 150,
      holder: 'holder-3',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.05);
    expect(settlement.payout).toBe(300);
  });

  it('breachProbability metric not met: payout = 0', () => {
    const future: TrustFuture = {
      id: 'future-3',
      agentId: 'agent-1',
      metric: 'breachProbability',
      targetValue: 0.1,
      settlementDate: Date.now(),
      premium: 150,
      holder: 'holder-3',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.2);
    expect(settlement.payout).toBe(0);
  });

  it('settlement has a settledAt timestamp', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.9,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const before = Date.now();
    const settlement = settleFuture(future, 0.95);
    const after = Date.now();
    expect(settlement.settledAt).toBeGreaterThanOrEqual(before);
    expect(settlement.settledAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// claimPolicy
// ---------------------------------------------------------------------------
describe('claimPolicy', () => {
  const basePolicy: AgentInsurancePolicy = {
    id: 'policy-1',
    agentId: 'agent-1',
    covenantId: 'covenant-1',
    coverage: 10000,
    premium: 500,
    underwriter: 'underwriter-1',
    riskScore: 0.1,
    term: 365,
    status: 'active',
    createdAt: Date.now(),
  };

  it('payout equals lossAmount when less than coverage', () => {
    const result = claimPolicy(basePolicy, 5000);
    expect(result.payout).toBe(5000);
  });

  it('payout capped at coverage when lossAmount exceeds coverage', () => {
    const result = claimPolicy(basePolicy, 20000);
    expect(result.payout).toBe(10000);
  });

  it('payout equals coverage when lossAmount equals coverage', () => {
    const result = claimPolicy(basePolicy, 10000);
    expect(result.payout).toBe(10000);
  });

  it('updates policy status to claimed', () => {
    const result = claimPolicy(basePolicy, 5000);
    expect(result.policy.status).toBe('claimed');
  });

  it('does not mutate the original policy', () => {
    const original = { ...basePolicy };
    claimPolicy(basePolicy, 5000);
    expect(basePolicy.status).toBe(original.status);
  });

  it('preserves all other policy fields', () => {
    const result = claimPolicy(basePolicy, 5000);
    expect(result.policy.id).toBe(basePolicy.id);
    expect(result.policy.agentId).toBe(basePolicy.agentId);
    expect(result.policy.covenantId).toBe(basePolicy.covenantId);
    expect(result.policy.coverage).toBe(basePolicy.coverage);
    expect(result.policy.premium).toBe(basePolicy.premium);
    expect(result.policy.underwriter).toBe(basePolicy.underwriter);
  });
});
