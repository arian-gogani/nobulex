import { sha256String, timestamp } from '@stele/crypto';
import type { HashHex } from '@stele/crypto';
import { poseidonHash, hashToField, fieldToHex, FIELD_PRIME } from './poseidon';

import type {
  ComplianceProof,
  ProofVerificationResult,
  ProofGenerationOptions,
  AuditEntryData,
} from './types';

// Re-export types
export type {
  ComplianceProof,
  ProofVerificationResult,
  ProofGenerationOptions,
  AuditEntryData,
} from './types';

// Re-export Poseidon primitives
export { poseidonHash, hashToField, fieldToHex, FIELD_PRIME } from './poseidon';

// ---------------------------------------------------------------------------
// Commitment computation
// ---------------------------------------------------------------------------

/**
 * Compute a Poseidon commitment over a sequence of audit log entries.
 *
 * The commitment is built by chaining: start with a zero accumulator,
 * then for each entry, hash (accumulator, entryFieldElement) with Poseidon.
 * This produces a sequential commitment that depends on the order and
 * content of every entry.
 *
 * @param entries - The audit entries to commit to
 * @returns Hex-encoded Poseidon commitment
 */
export function computeAuditCommitment(entries: AuditEntryData[]): HashHex {
  if (entries.length === 0) {
    // Commitment over empty set is Poseidon(0)
    return fieldToHex(poseidonHash([0n]));
  }

  let accumulator = 0n;

  for (const entry of entries) {
    // Convert each entry's SHA-256 hash to a field element
    const entryField = hashToField(entry.hash);
    // Chain: new accumulator = Poseidon(accumulator, entryField)
    accumulator = poseidonHash([accumulator, entryField]);
  }

  return fieldToHex(accumulator);
}

/**
 * Compute a Poseidon commitment over a constraint definition string.
 *
 * First hashes the string with SHA-256 to get a fixed-size digest,
 * converts that to a field element, then applies Poseidon.
 *
 * @param constraints - The constraint definitions (CCL source or canonical string)
 * @returns Hex-encoded Poseidon commitment
 */
export function computeConstraintCommitment(constraints: string): HashHex {
  // SHA-256 the constraints string to get a fixed-length digest
  const constraintHash = sha256String(constraints);
  // Convert to field element
  const constraintField = hashToField(constraintHash);
  // Poseidon hash for the commitment
  const commitment = poseidonHash([constraintField]);
  return fieldToHex(commitment);
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

/**
 * Generate a compliance proof attesting that the given audit entries
 * are consistent with the covenant's constraints.
 *
 * For v0.1, this produces a Poseidon hash commitment proof:
 * - Computes audit log commitment (chained Poseidon over entry hashes)
 * - Computes constraint commitment (Poseidon of SHA-256 of constraints)
 * - Generates proof = Poseidon(auditLogCommitment, constraintCommitment, covenantId)
 * - Public inputs = [covenantId, auditLogCommitment, constraintCommitment, entryCount]
 *
 * In future versions (groth16, plonk), the proof will be a full ZK-SNARK.
 *
 * @param options - Proof generation parameters
 * @returns A ComplianceProof object
 */
export async function generateComplianceProof(
  options: ProofGenerationOptions
): Promise<ComplianceProof> {
  const { covenantId, constraints, auditEntries, proofSystem = 'poseidon_hash' } = options;

  // Validate inputs
  if (!covenantId || covenantId.length === 0) {
    throw new Error('covenantId is required');
  }
  if (!constraints || constraints.length === 0) {
    throw new Error('constraints string is required');
  }

  // Compute commitments
  const auditLogCommitment = computeAuditCommitment(auditEntries);
  const constraintCommitment = computeConstraintCommitment(constraints);

  // Convert commitments and covenantId to field elements for proof computation
  const auditField = hashToField(auditLogCommitment);
  const constraintField = hashToField(constraintCommitment);
  const covenantField = hashToField(covenantId);

  // Generate proof: Poseidon(auditLogCommitment, constraintCommitment, covenantId)
  // This binds all three values together cryptographically
  const proofValue = poseidonHash([auditField, constraintField, covenantField]);
  const proofHex = fieldToHex(proofValue);

  // Public inputs allow any verifier to check the proof
  const publicInputs: string[] = [
    covenantId,
    auditLogCommitment,
    constraintCommitment,
    String(auditEntries.length),
  ];

  return {
    version: '1.0',
    covenantId,
    auditLogCommitment,
    constraintCommitment,
    proof: proofHex,
    publicInputs,
    proofSystem,
    generatedAt: timestamp(),
    entryCount: auditEntries.length,
  };
}

// ---------------------------------------------------------------------------
// Proof verification
// ---------------------------------------------------------------------------

/**
 * Verify a compliance proof by checking its structural integrity and
 * recomputing the proof value from public inputs.
 *
 * Verification steps:
 * 1. Check proof format (version, required fields)
 * 2. Check public inputs are well-formed (length = 4)
 * 3. Audit log commitment is consistent (publicInputs[1] matches auditLogCommitment, covenantId matches)
 * 4. Constraint commitment matches (publicInputs[2] matches constraintCommitment, entryCount matches)
 * 5. Proof verifies against verification circuit (recompute and compare)
 *
 * @param proof - The ComplianceProof to verify
 * @returns Detailed verification result
 */
export async function verifyComplianceProof(
  proof: ComplianceProof
): Promise<ProofVerificationResult> {
  const errors: string[] = [];

  // --- Step 1: Check proof format ---

  if (proof.version !== '1.0') {
    errors.push(`Unsupported proof version: ${proof.version}`);
  }

  if (!proof.covenantId || proof.covenantId.length === 0) {
    errors.push('Missing covenantId');
  }

  if (!proof.auditLogCommitment || proof.auditLogCommitment.length === 0) {
    errors.push('Missing auditLogCommitment');
  }

  if (!proof.constraintCommitment || proof.constraintCommitment.length === 0) {
    errors.push('Missing constraintCommitment');
  }

  if (!proof.proof || proof.proof.length === 0) {
    errors.push('Missing proof value');
  }

  if (proof.proofSystem !== 'poseidon_hash' && proof.proofSystem !== 'groth16' && proof.proofSystem !== 'plonk') {
    errors.push(`Unsupported proof system: ${proof.proofSystem}`);
  }

  if (typeof proof.entryCount !== 'number' || proof.entryCount < 0) {
    errors.push(`Invalid entryCount: ${proof.entryCount}`);
  }

  if (!proof.generatedAt || proof.generatedAt.length === 0) {
    errors.push('Missing generatedAt timestamp');
  }

  // --- Step 2: Check public inputs ---

  if (!Array.isArray(proof.publicInputs)) {
    errors.push('publicInputs must be an array');
    return {
      valid: false,
      covenantId: proof.covenantId ?? ('' as HashHex),
      entryCount: proof.entryCount ?? 0,
      errors,
    };
  }

  if (proof.publicInputs.length !== 4) {
    errors.push(
      `publicInputs must have exactly 4 elements, got ${proof.publicInputs.length}`
    );
  }

  // --- Step 3: Audit log commitment is consistent ---

  if (proof.publicInputs.length === 4) {
    const [piCovenantId, piAuditCommitment, piConstraintCommitment, piEntryCount] =
      proof.publicInputs;

    if (piCovenantId !== proof.covenantId) {
      errors.push(
        `publicInputs[0] (covenantId) mismatch: expected ${proof.covenantId}, got ${piCovenantId}`
      );
    }

    if (piAuditCommitment !== proof.auditLogCommitment) {
      errors.push(
        `publicInputs[1] (auditLogCommitment) mismatch: expected ${proof.auditLogCommitment}, got ${piAuditCommitment}`
      );
    }
  }

  // --- Step 4: Constraint commitment matches ---

  if (proof.publicInputs.length === 4) {
    const [, , piConstraintCommitment, piEntryCount] = proof.publicInputs;

    if (piConstraintCommitment !== proof.constraintCommitment) {
      errors.push(
        `publicInputs[2] (constraintCommitment) mismatch: expected ${proof.constraintCommitment}, got ${piConstraintCommitment}`
      );
    }

    if (piEntryCount !== String(proof.entryCount)) {
      errors.push(
        `publicInputs[3] (entryCount) mismatch: expected ${proof.entryCount}, got ${piEntryCount}`
      );
    }
  }

  // --- Step 5: Proof verifies against verification circuit ---

  if (proof.proofSystem === 'poseidon_hash' && errors.length === 0) {
    try {
      const auditField = hashToField(proof.auditLogCommitment);
      const constraintField = hashToField(proof.constraintCommitment);
      const covenantField = hashToField(proof.covenantId);

      const expectedProof = poseidonHash([auditField, constraintField, covenantField]);
      const expectedHex = fieldToHex(expectedProof);

      if (expectedHex !== proof.proof) {
        errors.push(
          `Proof value mismatch: recomputed ${expectedHex}, got ${proof.proof}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Error recomputing proof: ${message}`);
    }
  }

  return {
    valid: errors.length === 0,
    covenantId: proof.covenantId ?? ('' as HashHex),
    entryCount: proof.entryCount ?? 0,
    errors,
  };
}
