import { sha256Object } from '@stele/crypto';

export type {
  ChallengePayload,
  Canary,
  CanaryResult,
} from './types';

import type {
  ChallengePayload,
  Canary,
  CanaryResult,
} from './types';

/**
 * Generate a canary test for a given covenant constraint.
 *
 * @param targetCovenantId - The covenant being tested
 * @param constraintTested - Which specific constraint this canary probes
 * @param challenge - The challenge payload to present to the agent
 * @param expectedBehavior - What the agent should do if the constraint holds
 * @param ttlMs - Time-to-live in milliseconds (default: 3600000 = 1 hour)
 */
export function generateCanary(
  targetCovenantId: string,
  constraintTested: string,
  challenge: ChallengePayload,
  expectedBehavior: 'deny' | 'permit' | 'limit',
  ttlMs?: number,
): Canary {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (ttlMs ?? 3600000);

  const content = {
    targetCovenantId,
    constraintTested,
    challenge,
    expectedBehavior,
    issuedAt,
    expiresAt,
  };
  const id = sha256Object(content);

  return {
    id,
    targetCovenantId,
    constraintTested,
    challenge,
    expectedBehavior,
    issuedAt,
    expiresAt,
  };
}

/**
 * Evaluate an agent's response against a canary test.
 *
 * The canary passes if the agent's behavior string matches the canary's
 * expectedBehavior. If it fails, breachEvidence is populated with a
 * human-readable explanation.
 */
export function evaluateCanary(
  canary: Canary,
  agentResponse: { behavior: string; output?: unknown },
): CanaryResult {
  const passed = agentResponse.behavior === canary.expectedBehavior;
  const detectionTimestamp = Date.now();

  const result: CanaryResult = {
    canaryId: canary.id,
    passed,
    actualBehavior: agentResponse.behavior,
    detectionTimestamp,
  };

  if (!passed) {
    result.breachEvidence =
      `Canary ${canary.id} failed: constraint "${canary.constraintTested}" ` +
      `on covenant "${canary.targetCovenantId}" expected behavior "${canary.expectedBehavior}" ` +
      `but agent responded with "${agentResponse.behavior}"`;
  }

  return result;
}

/**
 * Compute the probability that at least one canary detects a violation,
 * given the canary frequency (number of canaries deployed) and the
 * coverage ratio (probability any single canary catches the violation).
 *
 * Formula: P = 1 - (1 - coverageRatio)^canaryFrequency
 * Result is clamped to [0, 1].
 */
export function detectionProbability(
  canaryFrequency: number,
  coverageRatio: number,
): number {
  const raw = 1 - Math.pow(1 - coverageRatio, canaryFrequency);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Check whether a canary has expired based on the current time.
 */
export function isExpired(canary: Canary): boolean {
  return Date.now() > canary.expiresAt;
}
