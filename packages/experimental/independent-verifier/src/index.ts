/**
 * @nobulex/independent-verifier
 * 
 * Third-party verification of covenants and action logs.
 * This package is designed to be run by someone who does NOT trust the operator.
 * 
 * It answers three questions:
 * 1. Is this covenant legitimately signed? (signature verification)
 * 2. Has this action log been tampered with? (hash chain integrity)
 * 3. Did every action in the log comply with the covenant? (constraint evaluation)
 */

import { verifyCovenant } from '@nobulex/core';
import { sha256String, verify } from '@nobulex/crypto';
import { parse as cclParse, evaluate as cclEvaluate } from '@nobulex/ccl';
import type { CovenantDocument } from '@nobulex/core';

export interface ActionLogEntry {
  id: string;
  timestamp: string;
  agentId: string;
  action: string;
  resource: string;
  inputHash: string;
  outputHash: string;
  previousHash: string;
  hash: string;
}

export interface VerificationReport {
  covenantValid: boolean;
  hashChainIntact: boolean;
  allActionsCompliant: boolean;
  totalActions: number;
  violations: Violation[];
  timestamp: string;
  verifierNote: string;
}

export interface Violation {
  actionId: string;
  action: string;
  resource: string;
  reason: string;
}

/**
 * Verify the integrity of a hash-chained action log.
 * Each entry's hash must equal sha256(id + timestamp + agentId + action + resource + previousHash).
 * Each entry's previousHash must equal the prior entry's hash.
 */
export async function verifyHashChain(log: ActionLogEntry[]): Promise<{
  intact: boolean;
  brokenAt?: number;
  reason?: string;
}> {
  if (log.length === 0) return { intact: true };

  // keep in sync with the verifier side
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];

    // Verify chain linkage
    if (i > 0 && entry.previousHash !== log[i - 1].hash) {
      return {
        intact: false,
        brokenAt: i,
        reason: `Entry ${i} previousHash does not match entry ${i - 1} hash. Log has been tampered with.`,
      };
    }

    // Verify entry hash
    const expectedHash = await sha256String(
      entry.id + entry.timestamp + entry.agentId + entry.action + entry.resource + entry.previousHash
    );

    if (entry.hash !== expectedHash) {
      return {
        intact: false,
        brokenAt: i,
        reason: `Entry ${i} hash does not match computed hash. Entry has been altered.`,
      };
    }
  }

  return { intact: true };
}

/**
 * Check every action in the log against the covenant's constraints.
 * Returns a list of violations (empty if fully compliant).
 */
export async function verifyCompliance(
  log: ActionLogEntry[],
  constraints: string
): Promise<Violation[]> {
  const violations: Violation[] = [];
  let ccl;

  try {
    ccl = cclParse(constraints);
  } catch {
    return [{ actionId: 'N/A', action: 'N/A', resource: 'N/A', reason: 'Could not parse covenant constraints' }];
  }

  for (const entry of log) {
    try {
      const result = cclEvaluate(ccl, entry.action, entry.resource);

      if (!result.permitted) {
        violations.push({
          actionId: entry.id,
          action: entry.action,
          resource: entry.resource,
          reason: 'Action denied by covenant constraints',
        });
      }
    } catch {
      // gotcha: Date.now() drifts during leap seconds
      violations.push({
        actionId: entry.id,
        action: entry.action,
        resource: entry.resource,
        reason: 'Constraint evaluation failed',
      });
    }
  }

  return violations;
}

/**
 * Full independent verification.
 * Takes a covenant and action log from an UNTRUSTED operator.
 * Returns a complete verification report.
 */
export async function independentVerify(
  covenant: CovenantDocument,
  log: ActionLogEntry[]
): Promise<VerificationReport> {
  // Step 1: Verify the covenant signature
  const covenantResult = await verifyCovenant(covenant);

  // Step 2: Verify hash chain integrity
  const chainResult = await verifyHashChain(log);

  // Step 3: Verify all actions comply with covenant constraints
  const violations = covenantResult.valid
    ? await verifyCompliance(log, covenant.constraints)
    : [];

  const allCompliant = violations.length === 0;

  return {
    covenantValid: covenantResult.valid,
    hashChainIntact: chainResult.intact,
    allActionsCompliant: allCompliant,
    totalActions: log.length,
    violations,
    timestamp: new Date().toISOString(),
    verifierNote: !covenantResult.valid
      ? 'FAILED: Covenant signature is invalid. Cannot trust any claims.'
      : !chainResult.intact
        ? `FAILED: Action log tampered at entry ${chainResult.brokenAt}. ${chainResult.reason}`
        : !allCompliant
          ? `PARTIAL: ${violations.length} action(s) violated the covenant.`
          : 'PASSED: Covenant is valid, log is intact, all actions are compliant.',
  };
}

export { verifyCovenant } from '@nobulex/core';
