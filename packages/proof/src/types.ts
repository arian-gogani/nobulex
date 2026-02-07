import type { HashHex } from '@stele/crypto';

/**
 * A zero-knowledge compliance proof attesting that audit log entries
 * satisfy the constraints defined in a covenant.
 */
export interface ComplianceProof {
  /** Schema version for forward compatibility */
  version: '1.0';
  /** The covenant this proof is generated for */
  covenantId: HashHex;
  /** Poseidon commitment over all audit log entries */
  auditLogCommitment: HashHex;
  /** Poseidon commitment over the constraint set */
  constraintCommitment: HashHex;
  /** The proof value (Poseidon hash of commitments for v0.1) */
  proof: string;
  /** Public inputs visible to any verifier */
  publicInputs: string[];
  /** Which proof system was used */
  proofSystem: 'poseidon_hash' | 'groth16' | 'plonk';
  /** ISO 8601 timestamp when the proof was generated */
  generatedAt: string;
  /** Number of audit entries covered by this proof */
  entryCount: number;
}

/**
 * Result of verifying a compliance proof.
 */
export interface ProofVerificationResult {
  /** Whether the proof is valid */
  valid: boolean;
  /** The covenant the proof claims to cover */
  covenantId: HashHex;
  /** Number of entries covered */
  entryCount: number;
  /** Detailed error messages if verification failed */
  errors: string[];
}

/**
 * Options for generating a compliance proof.
 */
export interface ProofGenerationOptions {
  /** The covenant ID to bind this proof to */
  covenantId: HashHex;
  /** The constraint definitions (CCL source or canonical string) */
  constraints: string;
  /** Audit log entries to prove compliance over */
  auditEntries: AuditEntryData[];
  /** Proof system to use (only poseidon_hash in v0.1) */
  proofSystem?: 'poseidon_hash';
}

/**
 * Minimal audit entry data needed for proof generation.
 */
export interface AuditEntryData {
  /** The action that was taken */
  action: string;
  /** The resource the action targeted */
  resource: string;
  /** The enforcement outcome */
  outcome: 'EXECUTED' | 'DENIED' | 'IMPOSSIBLE';
  /** ISO 8601 timestamp of the action */
  timestamp: string;
  /** SHA-256 hash of the full audit entry */
  hash: HashHex;
}
