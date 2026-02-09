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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AccountabilityConfig {
  tierThresholds?: {
    exemplary: number;  // default 0.9
    trusted: number;    // default 0.7
    verified: number;   // default 0.5
    basic: number;      // default 0.3
  };
  componentWeights?: {
    covenantCompleteness: number;  // default 0.15
    complianceHistory: number;     // default 0.30
    stakeRatio: number;            // default 0.20
    attestationCoverage: number;   // default 0.20
    canaryPassRate: number;        // default 0.15
  };
  minimumCovenants?: number;  // default 3
}

const DEFAULT_TIER_THRESHOLDS = {
  exemplary: 0.9,
  trusted: 0.7,
  verified: 0.5,
  basic: 0.3,
};

const DEFAULT_COMPONENT_WEIGHTS = {
  covenantCompleteness: 0.15,
  complianceHistory: 0.30,
  stakeRatio: 0.20,
  attestationCoverage: 0.20,
  canaryPassRate: 0.15,
};

const DEFAULT_MINIMUM_COVENANTS = 3;

function resolveConfig(config?: AccountabilityConfig) {
  const thresholds = { ...DEFAULT_TIER_THRESHOLDS, ...config?.tierThresholds };
  const weights = { ...DEFAULT_COMPONENT_WEIGHTS, ...config?.componentWeights };
  const minimumCovenants = config?.minimumCovenants ?? DEFAULT_MINIMUM_COVENANTS;
  return { thresholds, weights, minimumCovenants };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an AccountabilityConfig is well-formed.
 * - Tier thresholds must be in (0, 1) and ordered: exemplary > trusted > verified > basic > 0.
 * - Component weights must be non-negative and sum to approximately 1.0.
 * - minimumCovenants must be >= 1.
 */
export function validateConfig(config: AccountabilityConfig): void {
  if (config.tierThresholds) {
    const t = { ...DEFAULT_TIER_THRESHOLDS, ...config.tierThresholds };
    for (const [name, val] of Object.entries(t)) {
      if (val < 0 || val > 1) {
        throw new Error(`Tier threshold '${name}' must be in [0, 1], got ${val}`);
      }
    }
    if (t.exemplary <= t.trusted || t.trusted <= t.verified || t.verified <= t.basic) {
      throw new Error(
        `Tier thresholds must be strictly ordered: exemplary(${t.exemplary}) > trusted(${t.trusted}) > verified(${t.verified}) > basic(${t.basic})`,
      );
    }
  }

  if (config.componentWeights) {
    const w = { ...DEFAULT_COMPONENT_WEIGHTS, ...config.componentWeights };
    for (const [name, val] of Object.entries(w)) {
      if (val < 0) {
        throw new Error(`Component weight '${name}' must be >= 0, got ${val}`);
      }
    }
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `Component weights must sum to approximately 1.0, got ${sum}`,
      );
    }
  }

  if (config.minimumCovenants !== undefined && config.minimumCovenants < 1) {
    throw new Error(
      `minimumCovenants must be >= 1, got ${config.minimumCovenants}`,
    );
  }
}

/**
 * Validate ProtocolData fields are within acceptable ranges.
 */
export function validateProtocolData(data: ProtocolData): void {
  if (data.covenantCount < 0) {
    throw new Error(`covenantCount must be >= 0, got ${data.covenantCount}`);
  }
  if (data.totalInteractions < 0) {
    throw new Error(`totalInteractions must be >= 0, got ${data.totalInteractions}`);
  }
  if (data.compliantInteractions < 0) {
    throw new Error(`compliantInteractions must be >= 0, got ${data.compliantInteractions}`);
  }
  if (data.compliantInteractions > data.totalInteractions) {
    throw new Error(
      `compliantInteractions (${data.compliantInteractions}) must be <= totalInteractions (${data.totalInteractions})`,
    );
  }
  if (data.stakeAmount < 0) {
    throw new Error(`stakeAmount must be >= 0, got ${data.stakeAmount}`);
  }
  if (data.maxStake < 0) {
    throw new Error(`maxStake must be >= 0, got ${data.maxStake}`);
  }
  if (data.attestedInteractions < 0) {
    throw new Error(`attestedInteractions must be >= 0, got ${data.attestedInteractions}`);
  }
  if (data.canaryTests < 0) {
    throw new Error(`canaryTests must be >= 0, got ${data.canaryTests}`);
  }
  if (data.canaryPasses < 0) {
    throw new Error(`canaryPasses must be >= 0, got ${data.canaryPasses}`);
  }
  if (data.canaryPasses > data.canaryTests) {
    throw new Error(
      `canaryPasses (${data.canaryPasses}) must be <= canaryTests (${data.canaryTests})`,
    );
  }
}

/**
 * Validate InteractionPolicy fields are within acceptable ranges.
 */
export function validatePolicy(policy: InteractionPolicy): void {
  if (policy.minimumScore < 0 || policy.minimumScore > 1) {
    throw new Error(
      `minimumScore must be in [0, 1], got ${policy.minimumScore}`,
    );
  }
}

/**
 * Validate that an AccountabilityScore is within acceptable ranges.
 */
function validateScore(score: AccountabilityScore): void {
  if (score.score < 0 || score.score > 1) {
    throw new Error(
      `AccountabilityScore.score must be in [0, 1], got ${score.score}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tier logic
// ---------------------------------------------------------------------------

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
export function tierToMinScore(
  tier: AccountabilityTier,
  config?: AccountabilityConfig,
): number {
  const { thresholds } = resolveConfig(config);
  switch (tier) {
    case 'exemplary':
      return thresholds.exemplary;
    case 'trusted':
      return thresholds.trusted;
    case 'verified':
      return thresholds.verified;
    case 'basic':
      return thresholds.basic;
    case 'unaccountable':
      return 0;
  }
}

/**
 * Determine the accountability tier for a given numeric score.
 */
function scoreToTier(
  score: number,
  thresholds: typeof DEFAULT_TIER_THRESHOLDS,
): AccountabilityTier {
  if (score >= thresholds.exemplary) return 'exemplary';
  if (score >= thresholds.trusted) return 'trusted';
  if (score >= thresholds.verified) return 'verified';
  if (score >= thresholds.basic) return 'basic';
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

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute the accountability score for an agent given their protocol data.
 *
 * The score is the weighted sum of five components:
 *  - covenantCompleteness: min(covenantCount / minimumCovenants, 1.0)
 *  - complianceHistory: compliantInteractions / max(totalInteractions, 1)
 *  - stakeRatio: stakeAmount / max(maxStake, 1)
 *  - attestationCoverage: attestedInteractions / max(totalInteractions, 1)
 *  - canaryPassRate: canaryPasses / max(canaryTests, 1)
 */
export function computeAccountability(
  agentId: string,
  data: ProtocolData,
  config?: AccountabilityConfig,
): AccountabilityScore {
  if (config) validateConfig(config);
  validateProtocolData(data);

  const { thresholds, weights, minimumCovenants } = resolveConfig(config);

  const covenantCompleteness = Math.min(data.covenantCount / minimumCovenants, 1.0);
  const complianceHistory = data.compliantInteractions / Math.max(data.totalInteractions, 1);
  const stakeRatio = data.stakeAmount / Math.max(data.maxStake, 1);
  const attestationCoverage = data.attestedInteractions / Math.max(data.totalInteractions, 1);
  const canaryPassRate = data.canaryPasses / Math.max(data.canaryTests, 1);

  const score =
    weights.covenantCompleteness * covenantCompleteness +
    weights.complianceHistory * complianceHistory +
    weights.stakeRatio * stakeRatio +
    weights.attestationCoverage * attestationCoverage +
    weights.canaryPassRate * canaryPassRate;

  const tier = scoreToTier(score, thresholds);

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
 * The riskAdjustment is based on how far below the policy threshold the counterparty falls.
 * For allowed counterparties: riskAdjustment = 1 - counterparty.score
 * For denied counterparties: riskAdjustment = 1 - counterparty.score + deficit below threshold
 */
export function evaluateCounterparty(
  policy: InteractionPolicy,
  counterparty: AccountabilityScore,
): AccessDecision {
  validatePolicy(policy);
  validateScore(counterparty);

  const baseRisk = 1 - counterparty.score;
  const deficit = Math.max(0, policy.minimumScore - counterparty.score);
  const riskAdjustment = Math.min(1, baseRisk + deficit);

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
