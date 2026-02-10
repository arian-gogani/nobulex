export type {
  HonestyParameters,
  HonestyProof,
} from './types';

import type { HonestyParameters, HonestyProof } from './types';

/**
 * Validate that all HonestyParameters are within acceptable ranges.
 * Throws descriptive errors on any violation.
 */
export function validateParameters(params: Partial<HonestyParameters>): void {
  if (params.stakeAmount !== undefined && params.stakeAmount < 0) {
    throw new Error(`stakeAmount must be >= 0, got ${params.stakeAmount}`);
  }
  if (params.detectionProbability !== undefined) {
    if (params.detectionProbability < 0 || params.detectionProbability > 1) {
      throw new Error(
        `detectionProbability must be in [0, 1], got ${params.detectionProbability}`,
      );
    }
  }
  if (params.reputationValue !== undefined && params.reputationValue < 0) {
    throw new Error(`reputationValue must be >= 0, got ${params.reputationValue}`);
  }
  if (params.maxViolationGain !== undefined && params.maxViolationGain < 0) {
    throw new Error(`maxViolationGain must be >= 0, got ${params.maxViolationGain}`);
  }
  if (params.coburn !== undefined && params.coburn < 0) {
    throw new Error(`coburn must be >= 0, got ${params.coburn}`);
  }
}

function validateFull(params: HonestyParameters): void {
  validateParameters(params);
}

/**
 * Core theorem: Honesty dominates when:
 *   stake * detectionProbability + reputationValue + coburn > maxViolationGain
 *
 * Prove (or disprove) that honesty is the dominant strategy for the given parameters.
 * Returns a structured proof with step-by-step derivation.
 */
export function proveHonesty(params: HonestyParameters): HonestyProof {
  validateFull(params);

  const { stakeAmount, detectionProbability, reputationValue, maxViolationGain, coburn } = params;

  const s = stakeAmount;
  const d = detectionProbability;
  const r = reputationValue;
  const c = coburn;
  const g = maxViolationGain;

  const total = s * d + r + c;
  const margin = total - g;
  const isDominantStrategy = margin > 0;

  const requiredStake = minimumStake({
    detectionProbability,
    reputationValue,
    maxViolationGain,
    coburn,
  });

  const requiredDetection = minimumDetection({
    stakeAmount,
    reputationValue,
    maxViolationGain,
    coburn,
  });

  const formula =
    `Expected cost of dishonesty: stake(${s}) × detection(${d}) + reputation(${r}) + coburn(${c}) = ${total}\n` +
    `Maximum gain from violation: ${g}\n` +
    `Margin: ${total} - ${g} = ${margin}\n` +
    `Honesty is ${isDominantStrategy ? 'dominant' : 'not dominant'} strategy`;

  return {
    isDominantStrategy,
    margin,
    requiredStake,
    requiredDetection,
    formula,
  };
}

/**
 * Compute the minimum stake required for honesty to dominate,
 * given all other parameters.
 *
 * minimumStake = (maxViolationGain - reputationValue - coburn) / detectionProbability
 * Clamped to max(0, result). If detectionProbability is 0, returns Infinity.
 */
export function minimumStake(
  params: Omit<HonestyParameters, 'stakeAmount'>,
): number {
  validateParameters(params);

  const { detectionProbability, reputationValue, maxViolationGain, coburn } = params;

  if (detectionProbability === 0) {
    return Infinity;
  }

  const raw = (maxViolationGain - reputationValue - coburn) / detectionProbability;
  return Math.max(0, raw);
}

/**
 * Compute the minimum detection probability required for honesty to dominate,
 * given all other parameters.
 *
 * minimumDetection = (maxViolationGain - reputationValue - coburn) / stakeAmount
 * Clamped to [0, 1]. If stakeAmount is 0, returns 1 (need 100% detection).
 */
export function minimumDetection(
  params: Omit<HonestyParameters, 'detectionProbability'>,
): number {
  validateParameters(params);

  const { stakeAmount, reputationValue, maxViolationGain, coburn } = params;

  if (stakeAmount === 0) {
    return 1;
  }

  const raw = (maxViolationGain - reputationValue - coburn) / stakeAmount;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Compute the expected cost an agent would incur from a breach:
 *   stakeAmount * detectionProbability + coburn
 */
export function expectedCostOfBreach(params: HonestyParameters): number {
  validateFull(params);
  return params.stakeAmount * params.detectionProbability + params.coburn;
}

/**
 * Compute the honesty margin:
 *   (stake * detection + reputation + coburn) - maxViolationGain
 *
 * Positive margin means honesty dominates.
 */
export function honestyMargin(params: HonestyParameters): number {
  validateFull(params);
  const { stakeAmount, detectionProbability, reputationValue, maxViolationGain, coburn } = params;
  return (stakeAmount * detectionProbability + reputationValue + coburn) - maxViolationGain;
}

// ---------------------------------------------------------------------------
// Repeated Game Equilibrium (Folk Theorem)
// ---------------------------------------------------------------------------

/**
 * Parameters for a repeated (iterated) game between two strategies.
 */
export interface RepeatedGameParams {
  /** Payoff when both cooperate (reward) */
  cooperatePayoff: number;
  /** Payoff when both defect (punishment) */
  defectPayoff: number;
  /** Payoff for defecting while opponent cooperates (temptation) */
  temptationPayoff: number;
  /** Payoff for cooperating while opponent defects (sucker's payoff) */
  suckerPayoff: number;
  /** Discount factor per round, in (0, 1). Higher = more patient agents. */
  discountFactor: number;
}

/**
 * Result of repeated game equilibrium analysis.
 */
export interface RepeatedGameResult {
  /** Whether cooperation can be sustained as a subgame-perfect equilibrium */
  cooperationSustainable: boolean;
  /** The minimum discount factor required for cooperation (Folk Theorem threshold) */
  minDiscountFactor: number;
  /** The actual discount factor provided */
  actualDiscountFactor: number;
  /** Margin: actualDiscountFactor - minDiscountFactor. Positive means cooperation is sustainable. */
  margin: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute the discount factor threshold for cooperation in an infinitely
 * repeated game using the Folk Theorem / grim trigger strategy analysis.
 *
 * The Folk Theorem states that cooperation can be sustained as a subgame-perfect
 * Nash equilibrium in an infinitely repeated game if the discount factor delta
 * satisfies:
 *
 *   delta >= (T - R) / (T - P)
 *
 * where:
 *   T = temptation payoff (defect while other cooperates)
 *   R = reward payoff (mutual cooperation)
 *   P = punishment payoff (mutual defection)
 *   S = sucker payoff (cooperate while other defects)
 *
 * Preconditions (Prisoner's Dilemma structure): T > R > P > S
 *
 * Intuition: A sufficiently patient agent (high delta) values future cooperation
 * payoffs enough that the one-shot temptation gain is not worth the punishment
 * of perpetual defection.
 */
export function repeatedGameEquilibrium(params: RepeatedGameParams): RepeatedGameResult {
  const { cooperatePayoff: R, defectPayoff: P, temptationPayoff: T, suckerPayoff: S, discountFactor: delta } = params;

  // Validate payoff ordering: T > R > P > S (Prisoner's Dilemma structure)
  if (T <= R) {
    throw new Error(
      `temptationPayoff (${T}) must be > cooperatePayoff (${R}) for a valid dilemma`,
    );
  }
  if (R <= P) {
    throw new Error(
      `cooperatePayoff (${R}) must be > defectPayoff (${P}) for a valid dilemma`,
    );
  }
  if (P <= S) {
    throw new Error(
      `defectPayoff (${P}) must be > suckerPayoff (${S}) for a valid dilemma`,
    );
  }

  // Validate discount factor is in (0, 1)
  if (delta <= 0 || delta >= 1) {
    throw new Error(
      `discountFactor must be in (0, 1), got ${delta}`,
    );
  }

  // Folk Theorem threshold: delta_min = (T - R) / (T - P)
  const minDiscountFactor = (T - R) / (T - P);
  const margin = delta - minDiscountFactor;
  const cooperationSustainable = margin >= 0;

  const formula =
    `Folk Theorem threshold: delta_min = (T - R) / (T - P) = (${T} - ${R}) / (${T} - ${P}) = ${minDiscountFactor.toFixed(6)}\n` +
    `Actual discount factor: delta = ${delta}\n` +
    `Margin: ${delta} - ${minDiscountFactor.toFixed(6)} = ${margin.toFixed(6)}\n` +
    `Cooperation is ${cooperationSustainable ? 'sustainable' : 'not sustainable'} as equilibrium`;

  return {
    cooperationSustainable,
    minDiscountFactor,
    actualDiscountFactor: delta,
    margin,
    formula,
  };
}

// ---------------------------------------------------------------------------
// Coalition Stability (Core of Cooperative Game Theory)
// ---------------------------------------------------------------------------

/**
 * A characteristic function value for a coalition.
 * The coalition is represented as a sorted array of agent indices.
 */
export interface CoalitionValue {
  /** Sorted array of agent indices forming this coalition */
  coalition: number[];
  /** The value (payoff) this coalition can achieve on its own */
  value: number;
}

/**
 * Result of coalition stability analysis.
 */
export interface CoalitionStabilityResult {
  /** Whether the allocation is in the core (no blocking coalition exists) */
  isStable: boolean;
  /** List of blocking coalitions (coalitions that can profitably deviate) */
  blockingCoalitions: Array<{
    coalition: number[];
    coalitionValue: number;
    currentAllocation: number;
    surplus: number;
  }>;
  /** The total allocation vs the grand coalition value */
  efficiency: number;
  /** Human-readable summary */
  formula: string;
}

/**
 * Check whether an allocation is in the core of a cooperative game.
 *
 * In cooperative game theory, the "core" is the set of allocations where no
 * subset (coalition) of agents can do better by breaking away. Formally,
 * an allocation x is in the core if:
 *
 *   1. Group rationality: sum(x_i for all i) = v(N)  (efficiency)
 *   2. Coalition rationality: For every coalition S subset of N:
 *        sum(x_i for i in S) >= v(S)
 *
 * If any coalition S has sum(x_i for i in S) < v(S), that coalition is a
 * "blocking coalition" -- its members could do better by deviating.
 *
 * @param agentCount Number of agents (indexed 0 to agentCount-1)
 * @param allocation Array of payoffs allocated to each agent. Length must equal agentCount.
 * @param coalitionValues Array of CoalitionValue entries defining v(S) for subsets S.
 *        Must include the grand coalition (all agents). Unspecified coalitions default to v(S) = 0.
 */
export function coalitionStability(
  agentCount: number,
  allocation: number[],
  coalitionValues: CoalitionValue[],
): CoalitionStabilityResult {
  if (agentCount < 1) {
    throw new Error(`agentCount must be >= 1, got ${agentCount}`);
  }
  if (allocation.length !== agentCount) {
    throw new Error(
      `allocation length (${allocation.length}) must equal agentCount (${agentCount})`,
    );
  }

  // Build a map from coalition key to value for fast lookup
  const valueMap = new Map<string, number>();
  for (const cv of coalitionValues) {
    const key = [...cv.coalition].sort((a, b) => a - b).join(',');
    valueMap.set(key, cv.value);
  }

  // Grand coalition value
  const grandCoalition = Array.from({ length: agentCount }, (_, i) => i);
  const grandKey = grandCoalition.join(',');
  const grandCoalitionValue = valueMap.get(grandKey);
  if (grandCoalitionValue === undefined) {
    throw new Error('coalitionValues must include the grand coalition (all agents)');
  }

  // Efficiency check: sum of allocation vs grand coalition value
  const totalAllocation = allocation.reduce((s, v) => s + v, 0);
  const efficiency = grandCoalitionValue > 0 ? totalAllocation / grandCoalitionValue : 1;

  // Check all subsets (coalitions) for blocking
  const blockingCoalitions: CoalitionStabilityResult['blockingCoalitions'] = [];

  // Enumerate all non-empty proper subsets of agents
  const totalSubsets = 1 << agentCount; // 2^n
  for (let mask = 1; mask < totalSubsets - 1; mask++) {
    const coalition: number[] = [];
    for (let i = 0; i < agentCount; i++) {
      if (mask & (1 << i)) {
        coalition.push(i);
      }
    }

    const key = coalition.join(',');
    const coalitionValue = valueMap.get(key) ?? 0;
    const currentAllocation = coalition.reduce((s, i) => s + allocation[i], 0);

    // A coalition blocks if it can get more by deviating
    if (coalitionValue > currentAllocation) {
      blockingCoalitions.push({
        coalition,
        coalitionValue,
        currentAllocation,
        surplus: coalitionValue - currentAllocation,
      });
    }
  }

  const isStable = blockingCoalitions.length === 0;

  const formula = blockingCoalitions.length === 0
    ? `Allocation is in the core: no coalition can profitably deviate.\n` +
      `Grand coalition value: ${grandCoalitionValue}, total allocation: ${totalAllocation}, efficiency: ${efficiency.toFixed(4)}`
    : `Allocation is NOT in the core: ${blockingCoalitions.length} blocking coalition(s) found.\n` +
      blockingCoalitions.map(bc =>
        `  Coalition {${bc.coalition.join(',')}} has v(S)=${bc.coalitionValue} > allocated=${bc.currentAllocation} (surplus=${bc.surplus.toFixed(4)})`
      ).join('\n') +
      `\nGrand coalition value: ${grandCoalitionValue}, total allocation: ${totalAllocation}, efficiency: ${efficiency.toFixed(4)}`;

  return {
    isStable,
    blockingCoalitions,
    efficiency,
    formula,
  };
}

// ---------------------------------------------------------------------------
// Mechanism Design (Incentive Compatibility)
// ---------------------------------------------------------------------------

/**
 * Parameters for mechanism design analysis.
 */
export interface MechanismDesignParams {
  /** The gain an agent gets from dishonest behavior */
  dishonestGain: number;
  /** The probability of detecting dishonest behavior, in [0, 1] */
  detectionProbability: number;
  /** Intrinsic cost the agent bears from being dishonest (moral cost, etc.), >= 0 */
  intrinsicHonestyCost?: number;
}

/**
 * Result of mechanism design analysis.
 */
export interface MechanismDesignResult {
  /** The minimum penalty to make honest behavior incentive-compatible */
  minimumPenalty: number;
  /**
   * Whether a finite penalty can enforce honesty.
   * False when detectionProbability is 0 and dishonestGain > intrinsicHonestyCost.
   */
  enforceable: boolean;
  /** The expected penalty given detection probability */
  expectedPenalty: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute the minimum penalty required to make honest behavior
 * incentive-compatible in a mechanism design setting.
 *
 * An agent will behave honestly if the expected penalty for dishonesty
 * exceeds the gain from dishonesty:
 *
 *   detectionProbability * penalty + intrinsicHonestyCost >= dishonestGain
 *
 * Solving for the minimum penalty:
 *
 *   penalty_min = (dishonestGain - intrinsicHonestyCost) / detectionProbability
 *
 * This implements the Revelation Principle insight: a mechanism is
 * incentive-compatible if truth-telling is a dominant strategy, which
 * requires the penalty for lying to outweigh the benefit.
 *
 * When detectionProbability = 0 and dishonestGain > intrinsicHonestyCost,
 * no finite penalty can enforce honesty (enforceable = false).
 */
export function mechanismDesign(params: MechanismDesignParams): MechanismDesignResult {
  const { dishonestGain, detectionProbability, intrinsicHonestyCost = 0 } = params;

  if (dishonestGain < 0) {
    throw new Error(`dishonestGain must be >= 0, got ${dishonestGain}`);
  }
  if (detectionProbability < 0 || detectionProbability > 1) {
    throw new Error(
      `detectionProbability must be in [0, 1], got ${detectionProbability}`,
    );
  }
  if (intrinsicHonestyCost < 0) {
    throw new Error(
      `intrinsicHonestyCost must be >= 0, got ${intrinsicHonestyCost}`,
    );
  }

  const netGain = dishonestGain - intrinsicHonestyCost;

  // If intrinsic cost already exceeds gain, no penalty needed
  if (netGain <= 0) {
    return {
      minimumPenalty: 0,
      enforceable: true,
      expectedPenalty: 0,
      formula:
        `Intrinsic honesty cost (${intrinsicHonestyCost}) >= dishonest gain (${dishonestGain}).\n` +
        `No penalty needed: honest behavior is already incentive-compatible.`,
    };
  }

  // If detection is impossible, no finite penalty works
  if (detectionProbability === 0) {
    return {
      minimumPenalty: Infinity,
      enforceable: false,
      expectedPenalty: 0,
      formula:
        `Detection probability is 0 but net dishonest gain is ${netGain} > 0.\n` +
        `No finite penalty can enforce honesty without detection.`,
    };
  }

  // penalty_min = netGain / detectionProbability
  const minimumPenalty = netGain / detectionProbability;
  const expectedPenalty = minimumPenalty * detectionProbability;

  const formula =
    `Incentive compatibility constraint: p * penalty + intrinsicCost >= dishonestGain\n` +
    `  ${detectionProbability} * penalty + ${intrinsicHonestyCost} >= ${dishonestGain}\n` +
    `  penalty >= (${dishonestGain} - ${intrinsicHonestyCost}) / ${detectionProbability}\n` +
    `  penalty >= ${minimumPenalty.toFixed(6)}\n` +
    `Expected penalty at minimum: ${detectionProbability} * ${minimumPenalty.toFixed(6)} = ${expectedPenalty.toFixed(6)}`;

  return {
    minimumPenalty,
    enforceable: true,
    expectedPenalty,
    formula,
  };
}
