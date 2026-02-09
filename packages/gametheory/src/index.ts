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
