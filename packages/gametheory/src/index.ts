export type {
  HonestyParameters,
  HonestyProof,
} from './types';

import type { HonestyParameters, HonestyProof } from './types';

/**
 * Core theorem: Honesty dominates when:
 *   stake * detectionProbability + reputationValue + coburn > maxViolationGain
 *
 * Prove (or disprove) that honesty is the dominant strategy for the given parameters.
 */
export function proveHonesty(params: HonestyParameters): HonestyProof {
  const { stakeAmount, detectionProbability, reputationValue, maxViolationGain, coburn } = params;

  const costOfBreach = stakeAmount * detectionProbability + reputationValue + coburn;
  const margin = costOfBreach - maxViolationGain;
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
    `Honesty dominates when: stake(${stakeAmount}) * detection(${detectionProbability}) + ` +
    `reputation(${reputationValue}) + coburn(${coburn}) > maxGain(${maxViolationGain}). ` +
    `Left side = ${costOfBreach}, Right side = ${maxViolationGain}, Margin = ${margin}. ` +
    `Result: honesty is ${isDominantStrategy ? '' : 'NOT '}the dominant strategy.`;

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
 * Clamped to [0, 1]. If stakeAmount is 0, returns 1 (need full detection).
 */
export function minimumDetection(
  params: Omit<HonestyParameters, 'detectionProbability'>,
): number {
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
  return params.stakeAmount * params.detectionProbability + params.coburn;
}

/**
 * Compute the honesty margin:
 *   (stake * detection + reputation + coburn) - maxViolationGain
 *
 * Positive margin means honesty dominates.
 */
export function honestyMargin(params: HonestyParameters): number {
  const { stakeAmount, detectionProbability, reputationValue, maxViolationGain, coburn } = params;
  return (stakeAmount * detectionProbability + reputationValue + coburn) - maxViolationGain;
}
