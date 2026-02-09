import { sha256Object, generateId } from '@stele/crypto';

export type {
  TrustFuture,
  AgentInsurancePolicy,
  RiskAssessment,
  RiskFactor,
  Settlement,
  ReputationData,
} from './types';

import type {
  TrustFuture,
  AgentInsurancePolicy,
  RiskAssessment,
  RiskFactor,
  Settlement,
  ReputationData,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PricingConfig {
  riskWeights?: {
    breachHistory: number;   // default 0.30
    trustDeficit: number;    // default 0.25
    complianceGap: number;   // default 0.25
    stakeRatio: number;      // default 0.10
    maturity: number;        // default 0.10
  };
  premiumMultiplier?: number;  // default 1.5
  minimumPremiumRate?: number; // default 0.01
  maturityHalfLife?: number;   // default 365 (days)
}

const DEFAULT_RISK_WEIGHTS = {
  breachHistory: 0.30,
  trustDeficit: 0.25,
  complianceGap: 0.25,
  stakeRatio: 0.10,
  maturity: 0.10,
};

const DEFAULT_PREMIUM_MULTIPLIER = 1.5;
const DEFAULT_MINIMUM_PREMIUM_RATE = 0.01;
const DEFAULT_MATURITY_HALF_LIFE = 365;

function resolveConfig(config?: PricingConfig) {
  const weights = { ...DEFAULT_RISK_WEIGHTS, ...config?.riskWeights };
  const premiumMultiplier = config?.premiumMultiplier ?? DEFAULT_PREMIUM_MULTIPLIER;
  const minimumPremiumRate = config?.minimumPremiumRate ?? DEFAULT_MINIMUM_PREMIUM_RATE;
  const maturityHalfLife = config?.maturityHalfLife ?? DEFAULT_MATURITY_HALF_LIFE;
  return { weights, premiumMultiplier, minimumPremiumRate, maturityHalfLife };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a PricingConfig is well-formed.
 * - Risk weights must be non-negative and sum to approximately 1.0.
 * - premiumMultiplier must be > 0.
 * - minimumPremiumRate must be >= 0.
 * - maturityHalfLife must be > 0.
 */
export function validatePricingConfig(config: PricingConfig): void {
  if (config.riskWeights) {
    const w = { ...DEFAULT_RISK_WEIGHTS, ...config.riskWeights };
    for (const [name, val] of Object.entries(w)) {
      if (val < 0) {
        throw new Error(`Risk weight '${name}' must be >= 0, got ${val}`);
      }
    }
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `Risk weights must sum to approximately 1.0, got ${sum}`,
      );
    }
  }

  if (config.premiumMultiplier !== undefined && config.premiumMultiplier <= 0) {
    throw new Error(
      `premiumMultiplier must be > 0, got ${config.premiumMultiplier}`,
    );
  }

  if (config.minimumPremiumRate !== undefined && config.minimumPremiumRate < 0) {
    throw new Error(
      `minimumPremiumRate must be >= 0, got ${config.minimumPremiumRate}`,
    );
  }

  if (config.maturityHalfLife !== undefined && config.maturityHalfLife <= 0) {
    throw new Error(
      `maturityHalfLife must be > 0, got ${config.maturityHalfLife}`,
    );
  }
}

/**
 * Validate ReputationData fields are within acceptable ranges.
 */
export function validateReputationData(reputation: ReputationData): void {
  if (reputation.trustScore < 0 || reputation.trustScore > 1) {
    throw new Error(
      `trustScore must be in [0, 1], got ${reputation.trustScore}`,
    );
  }
  if (reputation.complianceRate < 0 || reputation.complianceRate > 1) {
    throw new Error(
      `complianceRate must be in [0, 1], got ${reputation.complianceRate}`,
    );
  }
  if (reputation.breachCount < 0) {
    throw new Error(`breachCount must be >= 0, got ${reputation.breachCount}`);
  }
  if (reputation.totalInteractions < 0) {
    throw new Error(
      `totalInteractions must be >= 0, got ${reputation.totalInteractions}`,
    );
  }
  if (reputation.breachCount > reputation.totalInteractions) {
    throw new Error(
      `breachCount (${reputation.breachCount}) must be <= totalInteractions (${reputation.totalInteractions})`,
    );
  }
  if (reputation.stakeAmount < 0) {
    throw new Error(
      `stakeAmount must be >= 0, got ${reputation.stakeAmount}`,
    );
  }
  if (reputation.age < 0) {
    throw new Error(`age must be >= 0, got ${reputation.age}`);
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute risk from reputation data.
 *
 * Factors:
 * - breachHistory (configurable weight): breachCount / totalInteractions
 * - trustDeficit (configurable weight): 1 - trustScore
 * - complianceGap (configurable weight): 1 - complianceRate
 * - stakeRatio (configurable weight): 1 - min(stakeAmount, 1)
 * - maturity (configurable weight): 1 / (1 + age/maturityHalfLife)
 *
 * breachProbability = weighted sum of factors
 * expectedLoss = breachProbability * coverage-based factor (derived from risk)
 * recommendedPremium = expectedLoss * premiumMultiplier
 */
export function assessRisk(
  agentId: string,
  reputation: ReputationData,
  config?: PricingConfig,
): RiskAssessment {
  if (config) validatePricingConfig(config);
  validateReputationData(reputation);

  const { weights, premiumMultiplier, maturityHalfLife } = resolveConfig(config);

  const breachHistoryValue = reputation.totalInteractions > 0
    ? reputation.breachCount / reputation.totalInteractions
    : 0;
  const trustDeficitValue = 1 - reputation.trustScore;
  const complianceGapValue = 1 - reputation.complianceRate;
  const stakeRatioValue = 1 - Math.min(reputation.stakeAmount, 1);
  const maturityValue = 1 / (1 + reputation.age / maturityHalfLife);

  const factors: RiskFactor[] = [
    { name: 'breachHistory', weight: weights.breachHistory, value: breachHistoryValue },
    { name: 'trustDeficit', weight: weights.trustDeficit, value: trustDeficitValue },
    { name: 'complianceGap', weight: weights.complianceGap, value: complianceGapValue },
    { name: 'stakeRatio', weight: weights.stakeRatio, value: stakeRatioValue },
    { name: 'maturity', weight: weights.maturity, value: maturityValue },
  ];

  const breachProbability = factors.reduce((sum, f) => sum + f.weight * f.value, 0);
  const expectedLoss = breachProbability * breachProbability;
  const recommendedPremium = expectedLoss * premiumMultiplier;

  return {
    agentId,
    breachProbability,
    expectedLoss,
    recommendedPremium,
    factors,
  };
}

/**
 * Compute insurance premium from risk, coverage, and term.
 *
 * premium = risk.breachProbability * coverage * (term / 365) * premiumMultiplier
 * Minimum premium = coverage * minimumPremiumRate
 */
export function priceInsurance(
  risk: RiskAssessment,
  coverage: number,
  term: number,
  config?: PricingConfig,
): number {
  if (config) validatePricingConfig(config);

  if (coverage <= 0) {
    throw new Error(`coverage must be > 0, got ${coverage}`);
  }
  if (term <= 0) {
    throw new Error(`term must be > 0, got ${term}`);
  }

  const { premiumMultiplier, minimumPremiumRate } = resolveConfig(config);

  const computed = risk.breachProbability * coverage * (term / 365) * premiumMultiplier;
  const minimum = coverage * minimumPremiumRate;
  return Math.max(computed, minimum);
}

/**
 * Creates an AgentInsurancePolicy with computed premium.
 */
export function createPolicy(
  agentId: string,
  covenantId: string,
  assessment: RiskAssessment,
  coverage: number,
  term: number,
  underwriter: string,
  config?: PricingConfig,
): AgentInsurancePolicy {
  if (coverage <= 0) {
    throw new Error(`coverage must be > 0, got ${coverage}`);
  }
  if (term <= 0) {
    throw new Error(`term must be > 0, got ${term}`);
  }

  const premium = priceInsurance(assessment, coverage, term, config);
  return {
    id: generateId(),
    agentId,
    covenantId,
    coverage,
    premium,
    underwriter,
    riskScore: assessment.breachProbability,
    term,
    status: 'active',
    createdAt: Date.now(),
  };
}

/**
 * Creates a TrustFuture.
 */
export function createFuture(
  agentId: string,
  metric: TrustFuture['metric'],
  targetValue: number,
  settlementDate: number,
  premium: number,
  holder: string,
): TrustFuture {
  if (premium <= 0) {
    throw new Error(`premium must be > 0, got ${premium}`);
  }

  return {
    id: generateId(),
    agentId,
    metric,
    targetValue,
    settlementDate,
    premium,
    holder,
    status: 'active',
  };
}

/**
 * Settles a future with proportional payout based on distance from target.
 *
 * "Metric met" logic:
 * - trustScore: actualValue >= targetValue (higher is better)
 * - complianceRate: actualValue >= targetValue (higher is better)
 * - breachProbability: actualValue <= targetValue (lower is better)
 *
 * Proportional payout:
 * - If metric met: payout = premium * (1 + min(2, (actualValue - targetValue) / targetValue))
 *   For breachProbability (inverted): payout = premium * (1 + min(2, (targetValue - actualValue) / targetValue))
 * - If metric not met: payout = premium * max(0, 1 - (targetValue - actualValue) / targetValue)
 *   For breachProbability (inverted): payout = premium * max(0, 1 - (actualValue - targetValue) / targetValue)
 */
export function settleFuture(future: TrustFuture, actualValue: number): Settlement {
  let metricMet: boolean;
  let payout: number;

  switch (future.metric) {
    case 'trustScore':
    case 'complianceRate': {
      metricMet = actualValue >= future.targetValue;
      if (metricMet) {
        const bonus = future.targetValue > 0
          ? Math.min(2, (actualValue - future.targetValue) / future.targetValue)
          : 0;
        payout = future.premium * (1 + bonus);
      } else {
        const shortfall = future.targetValue > 0
          ? (future.targetValue - actualValue) / future.targetValue
          : 1;
        payout = future.premium * Math.max(0, 1 - shortfall);
      }
      break;
    }
    case 'breachProbability': {
      metricMet = actualValue <= future.targetValue;
      if (metricMet) {
        const bonus = future.targetValue > 0
          ? Math.min(2, (future.targetValue - actualValue) / future.targetValue)
          : 0;
        payout = future.premium * (1 + bonus);
      } else {
        const excess = future.targetValue > 0
          ? (actualValue - future.targetValue) / future.targetValue
          : 1;
        payout = future.premium * Math.max(0, 1 - excess);
      }
      break;
    }
    default:
      metricMet = false;
      payout = 0;
  }

  return {
    futureId: future.id,
    actualValue,
    targetValue: future.targetValue,
    payout,
    settledAt: Date.now(),
  };
}

/**
 * Claims against an insurance policy.
 *
 * Validates:
 * - Loss must be > 0
 * - Loss must be <= coverage
 * - Policy must be 'active'
 *
 * Returns proportional payout: min(lossAmount, coverage).
 */
export function claimPolicy(
  policy: AgentInsurancePolicy,
  lossAmount: number,
): { policy: AgentInsurancePolicy; payout: number } {
  if (lossAmount <= 0) {
    throw new Error(`lossAmount must be > 0, got ${lossAmount}`);
  }
  if (lossAmount > policy.coverage) {
    throw new Error(
      `lossAmount (${lossAmount}) must be <= coverage (${policy.coverage})`,
    );
  }
  if (policy.status !== 'active') {
    throw new Error(
      `Policy must be active to claim, current status: '${policy.status}'`,
    );
  }

  const payout = Math.min(lossAmount, policy.coverage);
  const updatedPolicy: AgentInsurancePolicy = {
    ...policy,
    status: 'claimed',
  };
  return { policy: updatedPolicy, payout };
}
