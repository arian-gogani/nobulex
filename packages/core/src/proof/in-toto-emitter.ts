/**
 * @nobulex/in-toto-emitter, In-toto Decision Receipt Predicate Emitter
 *
 * Converts Nobulex's internal BilateralReceipt to the in-toto v1
 * Decision Receipt predicate format proposed in in-toto/attestation#549.
 *
 * The predicate uses snake_case top-level fields (per APS/aeoess
 * convention) and supports optional authorization_signature and
 * result_signature fields for the bilateral shape.
 *
 * Round-trip compatibility: byte-identical with APS bilateral-delegation
 * fixtures via JCS RFC 8785 + SHA-256 + Ed25519.
 */

import type { BilateralReceipt } from '../middleware';

/**
 * In-toto Decision Receipt predicate (v1).
 *
 * Single predicate with optional authorization/result signature fields.
 * Per aeoess (APS) and discussion on in-toto/attestation#549,
 * fragmenting into separate predicates forces verifiers to branch on
 * predicate name before processing, single predicate with optional
 * fields is the right interop shape.
 */
export interface DecisionReceiptPredicate {
  /** ISO-8601 timestamp of the receipt. */
  readonly timestamp: string;
  /** SHA-256 hex of canonical JSON of the authorization decision. */
  readonly authorization_hash: string;
  /** SHA-256 hex of canonical JSON of the execution result. */
  readonly result_hash: string;
  /** Hex-encoded Ed25519 public key of the signer. */
  readonly signer_public_key: string;
  /** Optional pre-execution signature (Ed25519 over authorization_hash). */
  readonly authorization_signature?: string;
  /** Optional post-execution signature (Ed25519 over result_hash). */
  readonly result_signature?: string;
  /** Optional migration attestation for chain rotation. */
  readonly migration_attestation?: MigrationAttestation;
}

/**
 * Migration attestation shape for chain rotation events.
 *
 * Carries the cryptographic bridge between pre-rotation and
 * post-rotation receipts so a verifier can confirm chain continuity
 * without trusting an unsigned "this is the same entity" claim.
 *
 * Matches APS `agent-passport-system/fixtures/bilateral-delegation/migration-attestation-shape`.
 */
export interface MigrationAttestation {
  readonly from_chain_root: string;
  readonly to_chain_root: string;
  readonly rotation_signature: string;
  readonly rotation_timestamp: string;
  readonly from_epistemic_state?: string;
  readonly to_epistemic_state?: string;
}

/**
 * Convert Nobulex's internal BilateralReceipt to the in-toto
 * Decision Receipt predicate format.
 *
 * Field name mapping:
 * - `authorizationHash` → `authorization_hash`
 * - `authorizationSignature` → `authorization_signature`
 * - `resultHash` → `result_hash`
 * - `resultSignature` → `result_signature`
 * - `signerPublicKey` → `signer_public_key`
 * - `timestamp` → `timestamp`
 *
 * All fields emit at the top level of the predicate (no `bilateral`
 * wrapper object) to match the APS schema for round-trip compatibility.
 */
export function bilateralReceiptToInTotoPredicate(
  receipt: BilateralReceipt,
  migrationAttestation?: MigrationAttestation,
): DecisionReceiptPredicate {
  const predicate: DecisionReceiptPredicate = {
    timestamp: receipt.timestamp,
    authorization_hash: receipt.authorizationHash,
    result_hash: receipt.resultHash,
    signer_public_key: receipt.signerPublicKey,
    authorization_signature: receipt.authorizationSignature,
    result_signature: receipt.resultSignature,
    ...(migrationAttestation ? { migration_attestation: migrationAttestation } : {}),
  };
  return predicate;
}

/**
 * Serialize the predicate to canonical JSON bytes (RFC 8785 JCS).
 *
 * The returned UTF-8 byte string is what gets signed. Two implementations
 * canonicalizing the same predicate object MUST produce byte-identical
 * output, that's the cross-language interop guarantee.
 */
export async function predicateToCanonicalBytes(
  predicate: DecisionReceiptPredicate,
): Promise<Uint8Array> {
  const { canonicalizeJson } = await import('@nobulex/crypto');
  const canonical = canonicalizeJson(predicate as unknown as Record<string, unknown>);
  return new TextEncoder().encode(canonical);
}
