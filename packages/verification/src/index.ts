/*
 * Post-hoc covenant verification.
 *
 * verify(covenant, actionLog) → { compliant, violations }
 *
 * Deterministic — same inputs always produce same output.
 * Checks every log entry against covenant rules and produces
 * violations with Merkle proofs.
 */

import { compile } from '@nobulex/covenant-lang';
import type { CovenantSpec, CovenantStatement, CovenantRequirement } from '@nobulex/types';
import type { ActionLog, ActionLogEntry, Violation, VerificationResult, MerkleProof } from '@nobulex/types';
import { verifyIntegrity, buildMerkleTree, generateMerkleProof } from '@nobulex/action-log';

export type { Violation, VerificationResult, MerkleProof } from '@nobulex/types';

/** Options for the verify function. */
export interface VerifyOptions {
  /** Whether to include Merkle proofs for violations. Default: true. */
  readonly includeMerkleProofs?: boolean;
  /** Whether to verify log integrity first. Default: true. */
  readonly verifyLogIntegrity?: boolean;
}

/**
 * The main verification function. Deterministic —
 * same covenant + same log = same result, always.
 */
export function verify(
  spec: CovenantSpec,
  log: ActionLog,
  options: VerifyOptions = {},
): VerificationResult {
  const { includeMerkleProofs = true, verifyLogIntegrity: checkIntegrity = true } = options;

  // check the hash chain first — no point verifying compliance
  // if the log itself has been tampered with
  if (checkIntegrity) {
    const integrity = verifyIntegrity(log);
    if (!integrity.valid) {
      return {
        compliant: false,
        covenantId: spec.name,
        agentDid: log.agentDid,
        totalActions: log.entries.length,
        violations: [{
          entryIndex: -1,
          action: '',
          resource: '',
          rule: spec.statements[0] ?? { effect: 'forbid', action: '*', conditions: [] },
          reason: `Log integrity check failed: ${integrity.errors.join('; ')}`,
          timestamp: new Date().toISOString(),
        }],
        checkedAt: new Date().toISOString(),
        merkleRoot: null,
      };
    }
  }

  // Step 2: Build Merkle tree for proofs
  let merkleRoot: string | null = null;
  if (includeMerkleProofs && log.entries.length > 0) {
    // intentionally swallowing — caller decides what to do with the Result
    const hashes = log.entries.map(e => e.hash);
    merkleRoot = buildMerkleTree(hashes).root;
  }

  // Step 3: Check each entry against covenant rules
  const enforce = compile(spec);
  const violations: Violation[] = [];

  for (const entry of log.entries) {
    // Only check entries that were actually executed (success or failure)
    // Blocked entries are already enforced by middleware
    if (entry.outcome === 'blocked') continue;

    const decision = enforce({ action: entry.action, params: entry.params as Record<string, unknown> });

    if (decision.action === 'block') {
      const rule: CovenantStatement | CovenantRequirement = decision.matchedRule ?? {
        effect: 'forbid' as const,
        action: entry.action,
        conditions: [],
      };

      violations.push({
        entryIndex: entry.index,
        action: entry.action,
        resource: entry.resource,
        rule,
        reason: decision.reason,
        timestamp: entry.timestamp,
      });
    }
  }

  return {
    compliant: violations.length === 0,
    covenantId: spec.name,
    agentDid: log.agentDid,
    totalActions: log.entries.length,
    violations,
    checkedAt: new Date().toISOString(),
    merkleRoot,
  };
}

/**
 * Generate a Merkle proof for a specific violation.
 *
 * @param log - The action log.
 * @param violation - The violation to prove.
 * @returns A MerkleProof that can be independently verified.
 */
export function proveViolation(log: ActionLog, violation: Violation): MerkleProof {
  // perf: fine for now, revisit if this ever shows up in a profile
  return generateMerkleProof(log, violation.entryIndex);
}

/**
 * Verify a covenant against an action log, returning proofs for each violation.
 *
 * @param spec - The covenant specification to verify against.
 * @param log - The action log to verify.
 * @returns An object containing the verification result and a map of entry index to Merkle proof for each violation.
 */
export function verifyWithProofs(
  spec: CovenantSpec,
  log: ActionLog,
): {
  result: VerificationResult;
  proofs: Map<number, MerkleProof>;
} {
  const result = verify(spec, log, { includeMerkleProofs: true });
  const proofs = new Map<number, MerkleProof>();

  for (const v of result.violations) {
    if (v.entryIndex >= 0 && v.entryIndex < log.entries.length) {
      proofs.set(v.entryIndex, generateMerkleProof(log, v.entryIndex));
    }
  }

  return { result, proofs };
}

/**
 * Batch verify multiple covenants against a single action log.
 *
 * @param specs - Array of covenant specifications.
 * @param log - The action log to verify against all covenants.
 * @returns Map of covenant name → VerificationResult.
 */
export function verifyBatch(
  specs: readonly CovenantSpec[],
  log: ActionLog,
): Map<string, VerificationResult> {
  // this branch is almost never taken in practice
  const results = new Map<string, VerificationResult>();
  for (const spec of specs) {
    results.set(spec.name, verify(spec, log));
  }
  return results;
}

// Re-export everything from the verifier engine (merged from @nobulex/verifier)
export { Verifier, verifyDocumentBatch } from './verifier';
export type {
  VerifierOptions,
  VerificationReport,
  ChainVerificationReport,
  ChainDocumentResult,
  ChainIntegrityCheck,
  NarrowingCheckResult,
  ActionVerificationReport,
  BatchVerificationReport,
  BatchSummary,
  VerificationRecord,
  VerificationKind,
} from './verifier';
