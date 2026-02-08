import { sha256Object, generateId } from '@stele/crypto';

export type {
  AccountabilityTier,
  AccountabilityScore,
  InteractionPolicy,
  AccessDecision,
  ProtocolData,
} from './types';

import type {
  AccountabilityTier,
  AccountabilityScore,
  InteractionPolicy,
  AccessDecision,
  ProtocolData,
} from './types';

const TIER_ORDER: AccountabilityTier[] = [
  'unaccountable',
  'basic',
  'verified',
  'trusted',
  'exemplary',
];

/**
 * Return the minimum score required for a given accountability tier.
 */
export function tierToMinScore(tier: AccountabilityTier): number {
  switch (tier) {
    case 'exemplary':
      return 0.9;
    case 'trusted':
      return 0.7;
    case 'verified':
      return 0.5;
    case 'basic':
      return 0.3;
    case 'unaccountable':
      return 0;
  }
}

/**
 * Determine the accountability tier for a given numeric score.
 */
function scoreToTier(score: number): AccountabilityTier {
  if (score >= 0.9) return 'exemplary';
  if (score >= 0.7) return 'trusted';
  if (score >= 0.5) return 'verified';
  if (score >= 0.3) return 'basic';
  return 'unaccountable';
}

/**
 * Compare two accountability tiers.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareTiers(a: AccountabilityTier, b: AccountabilityTier): -1 | 0 | 1 {
  const ai = TIER_ORDER.indexOf(a);
  const bi = TIER_ORDER.indexOf(b);
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

/**
 * Compute the accountability score for an agent given their protocol data.
 *
 * The score is the average of five components:
 *  - covenantCompleteness: min(covenantCount / 3, 1.0)
 *  - complianceHistory: compliantInteractions / max(totalInteractions, 1)
 *  - stakeRatio: stakeAmount / max(maxStake, 1)
 *  - attestationCoverage: attestedInteractions / max(totalInteractions, 1)
 *  - canaryPassRate: canaryPasses / max(canaryTests, 1)
 */
export function computeAccountability(agentId: string, data: ProtocolData): AccountabilityScore {
  const covenantCompleteness = Math.min(data.covenantCount / 3, 1.0);
  const complianceHistory = data.compliantInteractions / Math.max(data.totalInteractions, 1);
  const stakeRatio = data.stakeAmount / Math.max(data.maxStake, 1);
  const attestationCoverage = data.attestedInteractions / Math.max(data.totalInteractions, 1);
  const canaryPassRate = data.canaryPasses / Math.max(data.canaryTests, 1);

  const score =
    (covenantCompleteness + complianceHistory + stakeRatio + attestationCoverage + canaryPassRate) /
    5;

  const tier = scoreToTier(score);

  return {
    agentId,
    score,
    components: {
      covenantCompleteness,
      complianceHistory,
      stakeRatio,
      attestationCoverage,
      canaryPassRate,
    },
    tier,
  };
}

/**
 * Evaluate whether a counterparty meets the requirements of an interaction policy.
 *
 * Checks:
 *  1. The counterparty's tier is at or above the policy's minimumTier.
 *  2. The counterparty's score is at or above the policy's minimumScore.
 *  3. If requireStake is true, the counterparty's stakeRatio must be > 0.
 *  4. If requireAttestation is true, the counterparty's attestationCoverage must be > 0.
 *
 * The riskAdjustment is 1 - counterparty.score (higher score = lower risk).
 */
export function evaluateCounterparty(
  policy: InteractionPolicy,
  counterparty: AccountabilityScore
): AccessDecision {
  const riskAdjustment = 1 - counterparty.score;

  // Check tier requirement
  if (compareTiers(counterparty.tier, policy.minimumTier) < 0) {
    return {
      allowed: false,
      reason: `Counterparty tier '${counterparty.tier}' is below minimum tier '${policy.minimumTier}'`,
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check minimum score
  if (counterparty.score < policy.minimumScore) {
    return {
      allowed: false,
      reason: `Counterparty score ${counterparty.score} is below minimum score ${policy.minimumScore}`,
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check stake requirement
  if (policy.requireStake && counterparty.components.stakeRatio <= 0) {
    return {
      allowed: false,
      reason: 'Policy requires stake but counterparty has no stake',
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check attestation requirement
  if (policy.requireAttestation && counterparty.components.attestationCoverage <= 0) {
    return {
      allowed: false,
      reason: 'Policy requires attestation but counterparty has no attestation coverage',
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  return {
    allowed: true,
    reason: 'Counterparty meets all policy requirements',
    counterpartyScore: counterparty,
    riskAdjustment,
  };
}

/**
 * Compute the average accountability score across a set of agents.
 * Returns 0 if the array is empty.
 */
export function networkAccountabilityRate(scores: AccountabilityScore[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  return total / scores.length;
}
