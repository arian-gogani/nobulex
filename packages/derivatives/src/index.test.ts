import { describe, it, expect } from 'vitest';
import {
  assessRisk,
  priceInsurance,
  createPolicy,
  createFuture,
  settleFuture,
  claimPolicy,
  validatePricingConfig,
  validateReputationData,
  blackScholesPrice,
  valueAtRisk,
  hedgeRatio,
} from './index';
import type {
  ReputationData,
  RiskAssessment,
  TrustFuture,
  AgentInsurancePolicy,
} from './types';
import type { PricingConfig, BlackScholesParams, VaRParams, HedgeRatioParams } from './index';

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
// validatePricingConfig
// ---------------------------------------------------------------------------
describe('validatePricingConfig', () => {
  it('accepts valid config', () => {
    expect(() =>
      validatePricingConfig({
        riskWeights: {
          breachHistory: 0.30,
          trustDeficit: 0.25,
          complianceGap: 0.25,
          stakeRatio: 0.10,
          maturity: 0.10,
        },
        premiumMultiplier: 1.5,
        minimumPremiumRate: 0.01,
        maturityHalfLife: 365,
      }),
    ).not.toThrow();
  });

  it('accepts empty config', () => {
    expect(() => validatePricingConfig({})).not.toThrow();
  });

  it('throws on negative risk weight', () => {
    expect(() =>
      validatePricingConfig({
        riskWeights: {
          breachHistory: -0.1,
          trustDeficit: 0.35,
          complianceGap: 0.25,
          stakeRatio: 0.25,
          maturity: 0.25,
        },
      }),
    ).toThrow("Risk weight 'breachHistory' must be >= 0");
  });

  it('throws when risk weights do not sum to 1.0', () => {
    expect(() =>
      validatePricingConfig({
        riskWeights: {
          breachHistory: 0.1,
          trustDeficit: 0.1,
          complianceGap: 0.1,
          stakeRatio: 0.1,
          maturity: 0.1,
        },
      }),
    ).toThrow('Risk weights must sum to approximately 1.0');
  });

  it('throws on premiumMultiplier <= 0', () => {
    expect(() => validatePricingConfig({ premiumMultiplier: 0 })).toThrow(
      'premiumMultiplier must be > 0',
    );
    expect(() => validatePricingConfig({ premiumMultiplier: -1 })).toThrow(
      'premiumMultiplier must be > 0',
    );
  });

  it('throws on negative minimumPremiumRate', () => {
    expect(() => validatePricingConfig({ minimumPremiumRate: -0.01 })).toThrow(
      'minimumPremiumRate must be >= 0',
    );
  });

  it('throws on maturityHalfLife <= 0', () => {
    expect(() => validatePricingConfig({ maturityHalfLife: 0 })).toThrow(
      'maturityHalfLife must be > 0',
    );
  });
});

// ---------------------------------------------------------------------------
// validateReputationData
// ---------------------------------------------------------------------------
describe('validateReputationData', () => {
  it('accepts valid data', () => {
    expect(() => validateReputationData(goodReputation)).not.toThrow();
  });

  it('throws on trustScore > 1', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, trustScore: 1.5 }),
    ).toThrow('trustScore must be in [0, 1]');
  });

  it('throws on trustScore < 0', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, trustScore: -0.1 }),
    ).toThrow('trustScore must be in [0, 1]');
  });

  it('throws on complianceRate > 1', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, complianceRate: 1.1 }),
    ).toThrow('complianceRate must be in [0, 1]');
  });

  it('throws on complianceRate < 0', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, complianceRate: -0.1 }),
    ).toThrow('complianceRate must be in [0, 1]');
  });

  it('throws on negative breachCount', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, breachCount: -1 }),
    ).toThrow('breachCount must be >= 0');
  });

  it('throws when breachCount > totalInteractions', () => {
    expect(() =>
      validateReputationData({
        ...goodReputation,
        breachCount: 100,
        totalInteractions: 50,
      }),
    ).toThrow('breachCount (100) must be <= totalInteractions (50)');
  });

  it('throws on negative stakeAmount', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, stakeAmount: -1 }),
    ).toThrow('stakeAmount must be >= 0');
  });

  it('throws on negative age', () => {
    expect(() =>
      validateReputationData({ ...goodReputation, age: -10 }),
    ).toThrow('age must be >= 0');
  });
});

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

  it('expectedLoss equals breachProbability squared (derived from risk)', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(risk.expectedLoss).toBeCloseTo(
      risk.breachProbability * risk.breachProbability,
      10,
    );
  });

  it('recommendedPremium equals expectedLoss * premiumMultiplier', () => {
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

  it('maturity factor = 1 / (1 + age/maturityHalfLife)', () => {
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

  it('uses custom config when provided', () => {
    const config: PricingConfig = {
      riskWeights: {
        breachHistory: 0.50,
        trustDeficit: 0.20,
        complianceGap: 0.10,
        stakeRatio: 0.10,
        maturity: 0.10,
      },
      premiumMultiplier: 2.0,
      maturityHalfLife: 180,
    };
    const risk = assessRisk('agent-1', goodReputation, config);
    expect(risk.factors.find(f => f.name === 'breachHistory')!.weight).toBe(0.50);
    expect(risk.recommendedPremium).toBeCloseTo(risk.expectedLoss * 2.0, 10);
  });

  it('uses custom maturityHalfLife', () => {
    const config: PricingConfig = { maturityHalfLife: 180 };
    const risk = assessRisk('agent-1', goodReputation, config);
    const maturity = risk.factors.find(f => f.name === 'maturity');
    expect(maturity!.value).toBeCloseTo(1 / (1 + 730 / 180), 10);
  });

  it('throws on invalid reputation data', () => {
    expect(() =>
      assessRisk('agent-bad', { ...goodReputation, trustScore: 1.5 }),
    ).toThrow('trustScore must be in [0, 1]');
  });

  it('throws on invalid config', () => {
    expect(() =>
      assessRisk('agent-bad', goodReputation, { premiumMultiplier: -1 }),
    ).toThrow('premiumMultiplier must be > 0');
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

  it('enforces minimum premium of coverage * minimumPremiumRate', () => {
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

  it('throws on coverage <= 0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(() => priceInsurance(risk, 0, 365)).toThrow('coverage must be > 0');
    expect(() => priceInsurance(risk, -100, 365)).toThrow('coverage must be > 0');
  });

  it('throws on term <= 0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(() => priceInsurance(risk, 1000, 0)).toThrow('term must be > 0');
    expect(() => priceInsurance(risk, 1000, -30)).toThrow('term must be > 0');
  });

  it('uses custom premiumMultiplier from config', () => {
    const risk = assessRisk('agent-1', badReputation);
    const config: PricingConfig = { premiumMultiplier: 3.0 };
    const premium = priceInsurance(risk, 10000, 365, config);
    const expected = risk.breachProbability * 10000 * (365 / 365) * 3.0;
    const minimum = 10000 * 0.01;
    expect(premium).toBeCloseTo(Math.max(expected, minimum), 5);
  });

  it('uses custom minimumPremiumRate from config', () => {
    const lowRisk: RiskAssessment = {
      agentId: 'low-risk',
      breachProbability: 0.0001,
      expectedLoss: 0.0001,
      recommendedPremium: 0.00015,
      factors: [],
    };
    const config: PricingConfig = { minimumPremiumRate: 0.05 };
    const premium = priceInsurance(lowRisk, 1000, 30, config);
    expect(premium).toBe(1000 * 0.05);
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

  it('throws on coverage <= 0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(() =>
      createPolicy('agent-1', 'covenant-1', risk, 0, 365, 'underwriter-1'),
    ).toThrow('coverage must be > 0');
  });

  it('throws on term <= 0', () => {
    const risk = assessRisk('agent-1', goodReputation);
    expect(() =>
      createPolicy('agent-1', 'covenant-1', risk, 10000, 0, 'underwriter-1'),
    ).toThrow('term must be > 0');
  });

  it('accepts custom config', () => {
    const risk = assessRisk('agent-1', goodReputation);
    const config: PricingConfig = { premiumMultiplier: 3.0 };
    const policy = createPolicy('agent-1', 'covenant-1', risk, 10000, 365, 'underwriter-1', config);
    const expectedPremium = priceInsurance(risk, 10000, 365, config);
    expect(policy.premium).toBeCloseTo(expectedPremium, 5);
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

  it('throws on premium <= 0', () => {
    expect(() =>
      createFuture('agent-1', 'trustScore', 0.9, Date.now(), 0, 'holder-1'),
    ).toThrow('premium must be > 0');
    expect(() =>
      createFuture('agent-1', 'trustScore', 0.9, Date.now(), -10, 'holder-1'),
    ).toThrow('premium must be > 0');
  });
});

// ---------------------------------------------------------------------------
// settleFuture - proportional payout
// ---------------------------------------------------------------------------
describe('settleFuture', () => {
  it('trustScore metric met exactly: payout = premium (bonus = 0)', () => {
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
    // bonus = (0.9 - 0.9) / 0.9 = 0, payout = 100 * (1 + 0) = 100
    expect(settlement.payout).toBeCloseTo(100, 5);
    expect(settlement.futureId).toBe('future-1');
    expect(settlement.actualValue).toBe(0.9);
    expect(settlement.targetValue).toBe(0.9);
  });

  it('trustScore metric exceeded: proportional bonus', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.8,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFuture(future, 0.96);
    // bonus = min(2, (0.96 - 0.8) / 0.8) = min(2, 0.2) = 0.2
    // payout = 100 * (1 + 0.2) = 120
    expect(settlement.payout).toBeCloseTo(120, 5);
  });

  it('trustScore metric not met: proportional partial payout', () => {
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
    const settlement = settleFuture(future, 0.81);
    // shortfall = (0.9 - 0.81) / 0.9 = 0.1
    // payout = 100 * max(0, 1 - 0.1) = 90
    expect(settlement.payout).toBeCloseTo(90, 5);
  });

  it('trustScore far below target: payout = 0', () => {
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
    const settlement = settleFuture(future, 0.0);
    // shortfall = (0.9 - 0.0) / 0.9 = 1.0
    // payout = 100 * max(0, 1 - 1.0) = 0
    expect(settlement.payout).toBeCloseTo(0, 5);
  });

  it('complianceRate metric met: proportional payout', () => {
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
    // bonus = min(2, (0.97 - 0.95) / 0.95) = min(2, ~0.0211) = ~0.0211
    // payout = 200 * (1 + ~0.0211) ~ 204.21
    const expectedBonus = Math.min(2, (0.97 - 0.95) / 0.95);
    expect(settlement.payout).toBeCloseTo(200 * (1 + expectedBonus), 5);
  });

  it('complianceRate metric not met: proportional partial payout', () => {
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
    // shortfall = (0.95 - 0.90) / 0.95 = ~0.0526
    // payout = 200 * max(0, 1 - ~0.0526) = 200 * ~0.9474 = ~189.47
    const shortfall = (0.95 - 0.90) / 0.95;
    expect(settlement.payout).toBeCloseTo(200 * (1 - shortfall), 5);
  });

  it('breachProbability metric met (lower is better): proportional payout', () => {
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
    // bonus = min(2, (0.1 - 0.05) / 0.1) = min(2, 0.5) = 0.5
    // payout = 150 * (1 + 0.5) = 225
    expect(settlement.payout).toBeCloseTo(225, 5);
  });

  it('breachProbability metric not met: proportional partial payout', () => {
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
    const settlement = settleFuture(future, 0.15);
    // excess = (0.15 - 0.1) / 0.1 = 0.5
    // payout = 150 * max(0, 1 - 0.5) = 75
    expect(settlement.payout).toBeCloseTo(75, 5);
  });

  it('breachProbability far above target: payout = 0', () => {
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
    const settlement = settleFuture(future, 0.3);
    // excess = (0.3 - 0.1) / 0.1 = 2.0
    // payout = 150 * max(0, 1 - 2.0) = 0
    expect(settlement.payout).toBeCloseTo(0, 5);
  });

  it('breachProbability exactly at target: payout = premium', () => {
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
    const settlement = settleFuture(future, 0.1);
    // bonus = (0.1 - 0.1) / 0.1 = 0
    // payout = 150 * (1 + 0) = 150
    expect(settlement.payout).toBeCloseTo(150, 5);
  });

  it('bonus is capped at 2 (max payout = premium * 3)', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.1,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFuture(future, 1.0);
    // bonus = min(2, (1.0 - 0.1) / 0.1) = min(2, 9) = 2
    // payout = 100 * (1 + 2) = 300
    expect(settlement.payout).toBeCloseTo(300, 5);
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

  it('throws on lossAmount <= 0', () => {
    expect(() => claimPolicy(basePolicy, 0)).toThrow('lossAmount must be > 0');
    expect(() => claimPolicy(basePolicy, -100)).toThrow('lossAmount must be > 0');
  });

  it('throws on lossAmount > coverage', () => {
    expect(() => claimPolicy(basePolicy, 20000)).toThrow(
      'lossAmount (20000) must be <= coverage (10000)',
    );
  });

  it('throws on non-active policy', () => {
    const claimedPolicy = { ...basePolicy, status: 'claimed' as const };
    expect(() => claimPolicy(claimedPolicy, 5000)).toThrow(
      "Policy must be active to claim, current status: 'claimed'",
    );
  });

  it('throws on expired policy', () => {
    const expiredPolicy = { ...basePolicy, status: 'expired' as const };
    expect(() => claimPolicy(expiredPolicy, 5000)).toThrow(
      "Policy must be active to claim, current status: 'expired'",
    );
  });
});

// ---------------------------------------------------------------------------
// blackScholesPrice
// ---------------------------------------------------------------------------
describe('blackScholesPrice', () => {
  // Standard test case: S=100, K=100, T=1, r=0.05, sigma=0.2
  const atTheMoney: BlackScholesParams = {
    spotPrice: 100,
    strikePrice: 100,
    timeToMaturity: 1,
    riskFreeRate: 0.05,
    volatility: 0.2,
    optionType: 'call',
  };

  it('computes a positive call price for ATM option', () => {
    const result = blackScholesPrice(atTheMoney);
    // Known approximate value: ~10.45 for these parameters
    expect(result.price).toBeGreaterThan(0);
    expect(result.price).toBeCloseTo(10.45, 0);
  });

  it('computes d1 and d2 correctly', () => {
    const result = blackScholesPrice(atTheMoney);
    // d1 = [ln(100/100) + (0.05 + 0.04/2)*1] / (0.2*1) = [0 + 0.07] / 0.2 = 0.35
    expect(result.d1).toBeCloseTo(0.35, 2);
    // d2 = d1 - 0.2 = 0.15
    expect(result.d2).toBeCloseTo(0.15, 2);
  });

  it('put-call parity: C - P = S - K*e^(-rT)', () => {
    const call = blackScholesPrice(atTheMoney);
    const put = blackScholesPrice({ ...atTheMoney, optionType: 'put' });
    const parity = call.price - put.price;
    const expected = 100 - 100 * Math.exp(-0.05 * 1);
    expect(parity).toBeCloseTo(expected, 2);
  });

  it('deep in-the-money call is approximately S - K*e^(-rT)', () => {
    const result = blackScholesPrice({
      spotPrice: 200,
      strikePrice: 50,
      timeToMaturity: 1,
      riskFreeRate: 0.05,
      volatility: 0.2,
      optionType: 'call',
    });
    const intrinsic = 200 - 50 * Math.exp(-0.05);
    expect(result.price).toBeCloseTo(intrinsic, 0);
  });

  it('deep out-of-the-money call is near zero', () => {
    const result = blackScholesPrice({
      spotPrice: 50,
      strikePrice: 200,
      timeToMaturity: 0.25,
      riskFreeRate: 0.05,
      volatility: 0.2,
      optionType: 'call',
    });
    expect(result.price).toBeCloseTo(0, 2);
  });

  it('put price is positive for out-of-the-money put', () => {
    const result = blackScholesPrice({
      spotPrice: 100,
      strikePrice: 110,
      timeToMaturity: 0.5,
      riskFreeRate: 0.05,
      volatility: 0.3,
      optionType: 'put',
    });
    expect(result.price).toBeGreaterThan(0);
  });

  it('higher volatility leads to higher option price', () => {
    const low = blackScholesPrice({ ...atTheMoney, volatility: 0.1 });
    const high = blackScholesPrice({ ...atTheMoney, volatility: 0.4 });
    expect(high.price).toBeGreaterThan(low.price);
  });

  it('longer maturity leads to higher call price (positive r)', () => {
    const short = blackScholesPrice({ ...atTheMoney, timeToMaturity: 0.25 });
    const long = blackScholesPrice({ ...atTheMoney, timeToMaturity: 2 });
    expect(long.price).toBeGreaterThan(short.price);
  });

  it('formula contains Black-Scholes derivation', () => {
    const result = blackScholesPrice(atTheMoney);
    expect(result.formula).toContain('Black-Scholes');
    expect(result.formula).toContain('d1');
    expect(result.formula).toContain('d2');
    expect(result.formula).toContain('N(d1)');
  });

  it('N(d1) and N(d2) are between 0 and 1', () => {
    const result = blackScholesPrice(atTheMoney);
    expect(result.nd1).toBeGreaterThanOrEqual(0);
    expect(result.nd1).toBeLessThanOrEqual(1);
    expect(result.nd2).toBeGreaterThanOrEqual(0);
    expect(result.nd2).toBeLessThanOrEqual(1);
  });

  it('throws on spotPrice <= 0', () => {
    expect(() =>
      blackScholesPrice({ ...atTheMoney, spotPrice: 0 }),
    ).toThrow('spotPrice must be > 0');
  });

  it('throws on strikePrice <= 0', () => {
    expect(() =>
      blackScholesPrice({ ...atTheMoney, strikePrice: -1 }),
    ).toThrow('strikePrice must be > 0');
  });

  it('throws on timeToMaturity <= 0', () => {
    expect(() =>
      blackScholesPrice({ ...atTheMoney, timeToMaturity: 0 }),
    ).toThrow('timeToMaturity must be > 0');
  });

  it('throws on volatility <= 0', () => {
    expect(() =>
      blackScholesPrice({ ...atTheMoney, volatility: 0 }),
    ).toThrow('volatility must be > 0');
  });
});

// ---------------------------------------------------------------------------
// valueAtRisk
// ---------------------------------------------------------------------------
describe('valueAtRisk', () => {
  const baseVaR: VaRParams = {
    portfolioValue: 1000000,
    expectedReturn: 0.0004, // daily return ~0.04%
    volatility: 0.02,       // daily volatility 2%
    confidenceLevel: 0.95,
    timeHorizonDays: 1,
  };

  it('computes positive VaR for standard parameters', () => {
    const result = valueAtRisk(baseVaR);
    expect(result.valueAtRisk).toBeGreaterThan(0);
    // At 95% confidence, z ~ 1.645
    // VaR ~ 1000000 * (1.645 * 0.02 - 0.0004) ~ 32500
    expect(result.valueAtRisk).toBeCloseTo(32500, -2);
  });

  it('z-score is approximately 1.645 for 95% confidence', () => {
    const result = valueAtRisk(baseVaR);
    expect(result.zScore).toBeCloseTo(1.645, 2);
  });

  it('z-score is approximately 2.326 for 99% confidence', () => {
    const result = valueAtRisk({ ...baseVaR, confidenceLevel: 0.99 });
    expect(result.zScore).toBeCloseTo(2.326, 2);
  });

  it('higher confidence level leads to higher VaR', () => {
    const low = valueAtRisk({ ...baseVaR, confidenceLevel: 0.90 });
    const high = valueAtRisk({ ...baseVaR, confidenceLevel: 0.99 });
    expect(high.valueAtRisk).toBeGreaterThan(low.valueAtRisk);
  });

  it('higher volatility leads to higher VaR', () => {
    const low = valueAtRisk({ ...baseVaR, volatility: 0.01 });
    const high = valueAtRisk({ ...baseVaR, volatility: 0.05 });
    expect(high.valueAtRisk).toBeGreaterThan(low.valueAtRisk);
  });

  it('VaR scales with sqrt of time horizon', () => {
    const oneDay = valueAtRisk({ ...baseVaR, timeHorizonDays: 1 });
    const tenDays = valueAtRisk({ ...baseVaR, timeHorizonDays: 10 });
    // VaR_10 / VaR_1 should be approximately sqrt(10) ~ 3.16
    // (ignoring the expected return term which is small)
    const ratio = tenDays.valueAtRisk / oneDay.valueAtRisk;
    expect(ratio).toBeCloseTo(Math.sqrt(10), 0);
  });

  it('larger portfolio has proportionally larger VaR', () => {
    const small = valueAtRisk({ ...baseVaR, portfolioValue: 100000 });
    const large = valueAtRisk({ ...baseVaR, portfolioValue: 1000000 });
    expect(large.valueAtRisk / small.valueAtRisk).toBeCloseTo(10, 1);
  });

  it('VaR is zero when volatility is zero and return is positive', () => {
    const result = valueAtRisk({
      portfolioValue: 1000000,
      expectedReturn: 0.001,
      volatility: 0,
      confidenceLevel: 0.95,
    });
    expect(result.valueAtRisk).toBe(0);
  });

  it('varPercentage is VaR divided by portfolio value', () => {
    const result = valueAtRisk(baseVaR);
    expect(result.varPercentage).toBeCloseTo(result.valueAtRisk / baseVaR.portfolioValue, 10);
  });

  it('formula contains VaR derivation text', () => {
    const result = valueAtRisk(baseVaR);
    expect(result.formula).toContain('Parametric VaR');
    expect(result.formula).toContain('z-score');
    expect(result.formula).toContain('95.0%');
  });

  it('throws on portfolioValue <= 0', () => {
    expect(() => valueAtRisk({ ...baseVaR, portfolioValue: 0 })).toThrow(
      'portfolioValue must be > 0',
    );
  });

  it('throws on negative volatility', () => {
    expect(() => valueAtRisk({ ...baseVaR, volatility: -0.01 })).toThrow(
      'volatility must be >= 0',
    );
  });

  it('throws on confidenceLevel out of range', () => {
    expect(() => valueAtRisk({ ...baseVaR, confidenceLevel: 0 })).toThrow(
      'confidenceLevel must be in (0, 1)',
    );
    expect(() => valueAtRisk({ ...baseVaR, confidenceLevel: 1 })).toThrow(
      'confidenceLevel must be in (0, 1)',
    );
  });

  it('throws on non-positive timeHorizonDays', () => {
    expect(() => valueAtRisk({ ...baseVaR, timeHorizonDays: 0 })).toThrow(
      'timeHorizonDays must be > 0',
    );
  });
});

// ---------------------------------------------------------------------------
// hedgeRatio
// ---------------------------------------------------------------------------
describe('hedgeRatio', () => {
  it('computes correct hedge ratio for perfectly correlated assets', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.15,
      correlation: 1.0,
    });
    // h* = 1.0 * (0.20 / 0.15) = 1.333...
    expect(result.hedgeRatio).toBeCloseTo(4 / 3, 5);
    expect(result.hedgeEffectiveness).toBeCloseTo(1.0, 10);
  });

  it('computes correct hedge ratio for partially correlated assets', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0.8,
    });
    // h* = 0.8 * (0.20 / 0.25) = 0.64
    expect(result.hedgeRatio).toBeCloseTo(0.64, 5);
  });

  it('hedge effectiveness equals rho^2', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0.7,
    });
    expect(result.hedgeEffectiveness).toBeCloseTo(0.49, 5);
  });

  it('computes hedge position size when provided', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0.8,
      positionSize: 1000000,
    });
    // hedgePosition = 0.64 * 1000000 = 640000
    expect(result.hedgePositionSize).toBeCloseTo(640000, 0);
  });

  it('returns null hedge position when positionSize not provided', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0.8,
    });
    expect(result.hedgePositionSize).toBeNull();
  });

  it('negative correlation produces negative hedge ratio', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: -0.6,
    });
    expect(result.hedgeRatio).toBeLessThan(0);
    // h* = -0.6 * (0.20 / 0.25) = -0.48
    expect(result.hedgeRatio).toBeCloseTo(-0.48, 5);
  });

  it('zero correlation gives zero hedge ratio', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0,
    });
    expect(result.hedgeRatio).toBe(0);
    expect(result.hedgeEffectiveness).toBe(0);
  });

  it('zero asset volatility gives zero hedge ratio', () => {
    const result = hedgeRatio({
      assetVolatility: 0,
      hedgeVolatility: 0.25,
      correlation: 0.8,
    });
    expect(result.hedgeRatio).toBe(0);
  });

  it('formula contains derivation text', () => {
    const result = hedgeRatio({
      assetVolatility: 0.20,
      hedgeVolatility: 0.25,
      correlation: 0.8,
    });
    expect(result.formula).toContain('Minimum variance hedge ratio');
    expect(result.formula).toContain('h*');
    expect(result.formula).toContain('R^2');
  });

  it('throws on negative assetVolatility', () => {
    expect(() =>
      hedgeRatio({ assetVolatility: -0.1, hedgeVolatility: 0.2, correlation: 0.5 }),
    ).toThrow('assetVolatility must be >= 0');
  });

  it('throws on hedgeVolatility <= 0', () => {
    expect(() =>
      hedgeRatio({ assetVolatility: 0.2, hedgeVolatility: 0, correlation: 0.5 }),
    ).toThrow('hedgeVolatility must be > 0');
  });

  it('throws on correlation out of range', () => {
    expect(() =>
      hedgeRatio({ assetVolatility: 0.2, hedgeVolatility: 0.2, correlation: 1.5 }),
    ).toThrow('correlation must be in [-1, 1]');
    expect(() =>
      hedgeRatio({ assetVolatility: 0.2, hedgeVolatility: 0.2, correlation: -1.5 }),
    ).toThrow('correlation must be in [-1, 1]');
  });

  it('throws on non-positive positionSize', () => {
    expect(() =>
      hedgeRatio({
        assetVolatility: 0.2,
        hedgeVolatility: 0.2,
        correlation: 0.5,
        positionSize: -100,
      }),
    ).toThrow('positionSize must be > 0');
  });
});
