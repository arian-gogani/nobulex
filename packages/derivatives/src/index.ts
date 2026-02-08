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

/**
 * Compute risk from reputation data.
 *
 * Factors:
 * - breachHistory (weight 0.3): breachCount / totalInteractions
 * - trustDeficit (weight 0.25): 1 - trustScore
 * - complianceGap (weight 0.25): 1 - complianceRate
 * - stakeRatio (weight 0.1): 1 - min(stakeAmount, 1)
 * - maturity (weight 0.1): 1 / (1 + age/365)
 *
 * breachProbability = weighted sum of factors
 * expectedLoss = breachProbability * 1.0 (average loss)
 * recommendedPremium = expectedLoss * 1.5 (margin)
 */
export function assessRisk(agentId: string, reputation: ReputationData): RiskAssessment {
  const breachHistoryValue = reputation.totalInteractions > 0
    ? reputation.breachCount / reputation.totalInteractions
    : 0;
  const trustDeficitValue = 1 - reputation.trustScore;
  const complianceGapValue = 1 - reputation.complianceRate;
  const stakeRatioValue = 1 - Math.min(reputation.stakeAmount, 1);
  const maturityValue = 1 / (1 + reputation.age / 365);

  const factors: RiskFactor[] = [
    { name: 'breachHistory', weight: 0.3, value: breachHistoryValue },
    { name: 'trustDeficit', weight: 0.25, value: trustDeficitValue },
    { name: 'complianceGap', weight: 0.25, value: complianceGapValue },
    { name: 'stakeRatio', weight: 0.1, value: stakeRatioValue },
    { name: 'maturity', weight: 0.1, value: maturityValue },
  ];

  const breachProbability = factors.reduce((sum, f) => sum + f.weight * f.value, 0);
  const averageLoss = 1.0;
  const expectedLoss = breachProbability * averageLoss;
  const recommendedPremium = expectedLoss * 1.5;

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
 * premium = risk.breachProbability * coverage * (term / 365) * 1.5
 * Minimum premium = coverage * 0.01
 */
export function priceInsurance(risk: RiskAssessment, coverage: number, term: number): number {
  const computed = risk.breachProbability * coverage * (term / 365) * 1.5;
  const minimum = coverage * 0.01;
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
): AgentInsurancePolicy {
  const premium = priceInsurance(assessment, coverage, term);
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
 * Settles a future. If metric met, payout = premium * 2. If not, payout = 0.
 * Returns Settlement.
 *
 * "Metric met" logic:
 * - trustScore: actualValue >= targetValue
 * - complianceRate: actualValue >= targetValue
 * - breachProbability: actualValue <= targetValue (lower is better)
 */
export function settleFuture(future: TrustFuture, actualValue: number): Settlement {
  let metricMet: boolean;

  switch (future.metric) {
    case 'trustScore':
    case 'complianceRate':
      metricMet = actualValue >= future.targetValue;
      break;
    case 'breachProbability':
      metricMet = actualValue <= future.targetValue;
      break;
    default:
      metricMet = false;
  }

  const payout = metricMet ? future.premium * 2 : 0;

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
 * Returns { policy: updated, payout: min(lossAmount, coverage) }.
 */
export function claimPolicy(
  policy: AgentInsurancePolicy,
  lossAmount: number,
): { policy: AgentInsurancePolicy; payout: number } {
  const payout = Math.min(lossAmount, policy.coverage);
  const updatedPolicy: AgentInsurancePolicy = {
    ...policy,
    status: 'claimed',
  };
  return { policy: updatedPolicy, payout };
}
