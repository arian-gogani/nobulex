import { sha256Object } from '@stele/crypto';
import { parse, evaluate, checkRateLimit } from '@stele/ccl';
import type { CCLDocument, Statement } from '@stele/ccl';

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
 * Derive the expected behavior from the first statement in a parsed CCL document.
 * deny  -> 'deny'
 * permit -> 'permit'
 * limit  -> 'limit'
 * require -> 'deny' (require means the action is obligatory; absence is a denial)
 */
function expectedBehaviorFromDoc(doc: CCLDocument): 'deny' | 'permit' | 'limit' {
  const stmt: Statement | undefined = doc.statements[0];
  if (!stmt) {
    // No statements parsed — default to deny (safe fallback)
    return 'deny';
  }
  switch (stmt.type) {
    case 'deny':
      return 'deny';
    case 'permit':
      return 'permit';
    case 'limit':
      return 'limit';
    case 'require':
      return 'deny';
  }
}

/**
 * Build a ChallengePayload from the first statement of a parsed CCL document.
 * The challenge action and resource are taken directly from the constraint rule
 * so that we test the exact boundary the constraint describes.
 */
function challengeFromDoc(doc: CCLDocument): ChallengePayload {
  const stmt: Statement | undefined = doc.statements[0];
  if (!stmt) {
    return { action: 'unknown', resource: '/', context: {} };
  }

  if (stmt.type === 'limit') {
    return {
      action: stmt.action,
      resource: '/',
      context: {},
    };
  }

  return {
    action: stmt.action,
    resource: stmt.resource,
    context: {},
  };
}

/**
 * Generate a canary test for a given covenant constraint.
 *
 * The constraintTested is parsed as CCL to extract the expected behavior and
 * build a challenge that specifically tests the constraint boundary.
 *
 * @param targetCovenantId - The covenant being tested
 * @param constraintTested - CCL source text of the constraint to probe
 * @param challenge - Optional override for the challenge payload; if omitted,
 *                    the challenge is derived from the parsed constraint.
 * @param expectedBehavior - Optional override; if omitted, derived from the
 *                           parsed rule type (deny->deny, permit->permit, etc.)
 * @param ttlMs - Time-to-live in milliseconds (default: 3600000 = 1 hour)
 * @throws {Error} if ttlMs is not positive
 */
export function generateCanary(
  targetCovenantId: string,
  constraintTested: string,
  challenge?: ChallengePayload | null,
  expectedBehavior?: 'deny' | 'permit' | 'limit' | null,
  ttlMs?: number,
): Canary {
  // --- Validation ---
  if (ttlMs !== undefined && ttlMs !== null && ttlMs <= 0) {
    throw new Error('ttlMs must be positive');
  }

  // --- Parse constraint as CCL ---
  const doc = parse(constraintTested);

  // Derive expected behavior from the parsed rule if not explicitly provided
  const resolvedBehavior: 'deny' | 'permit' | 'limit' =
    expectedBehavior ?? expectedBehaviorFromDoc(doc);

  // Derive challenge from the parsed rule if not explicitly provided
  const resolvedChallenge: ChallengePayload =
    challenge ?? challengeFromDoc(doc);

  const issuedAt = Date.now();
  const expiresAt = issuedAt + (ttlMs ?? 3600000);

  const content = {
    targetCovenantId,
    constraintTested,
    challenge: resolvedChallenge,
    expectedBehavior: resolvedBehavior,
    issuedAt,
    expiresAt,
  };
  const id = sha256Object(content);

  return {
    id,
    targetCovenantId,
    constraintTested,
    challenge: resolvedChallenge,
    expectedBehavior: resolvedBehavior,
    issuedAt,
    expiresAt,
  };
}

/**
 * Evaluate an agent's response against a canary test.
 *
 * Instead of simple string comparison, the constraint is parsed as CCL and
 * evaluated against the action/resource the agent claims to have taken.
 * The evaluation determines what SHOULD have happened; a mismatch with what
 * actually happened constitutes a failure.
 *
 * @param canary - The canary to evaluate against
 * @param agentResponse - The agent's response, including the action taken
 *                        and resource accessed, plus the behavior string.
 */
export function evaluateCanary(
  canary: Canary,
  agentResponse: {
    behavior: string;
    action?: string;
    resource?: string;
    context?: Record<string, unknown>;
    output?: unknown;
  },
): CanaryResult {
  const detectionTimestamp = Date.now();

  let passed: boolean;

  // If the agent provides action/resource, do a proper CCL evaluation
  if (agentResponse.action && agentResponse.resource) {
    const doc = parse(canary.constraintTested);

    // Determine what SHOULD have happened according to the constraint
    let shouldBehavior: string;

    if (doc.limits.length > 0) {
      // For limit constraints, the expected behavior is always 'limit'
      shouldBehavior = 'limit';
    } else {
      const result = evaluate(
        doc,
        agentResponse.action,
        agentResponse.resource,
        agentResponse.context,
      );

      // Use the CCL engine's decision: permitted → 'permit', not permitted → 'deny'
      shouldBehavior = result.permitted ? 'permit' : 'deny';
    }

    // Compare expected behavior (from CCL) with actual behavior (from agent)
    passed = agentResponse.behavior === shouldBehavior;
  } else {
    // Fallback: compare behavior string against the canary's expectedBehavior
    passed = agentResponse.behavior === canary.expectedBehavior;
  }

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
 *
 * @throws {Error} if canaryFrequency is negative
 * @throws {Error} if coverageRatio is not in [0, 1]
 */
export function detectionProbability(
  canaryFrequency: number,
  coverageRatio: number,
): number {
  if (canaryFrequency < 0) {
    throw new Error('canaryFrequency must be >= 0');
  }
  if (coverageRatio < 0 || coverageRatio > 1) {
    throw new Error('coverageRatio must be in [0, 1]');
  }

  const raw = 1 - Math.pow(1 - coverageRatio, canaryFrequency);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Check whether a canary has expired based on the current time.
 */
export function isExpired(canary: Canary): boolean {
  return Date.now() > canary.expiresAt;
}
