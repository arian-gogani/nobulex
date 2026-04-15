/**
 * Shared protocol constants.
 *
 * Imported wherever a literal would otherwise be duplicated across packages —
 * keeps canonical spellings (hash algorithm names, DID relationships, VC proof
 * types, content types) in one place so a rename only has to happen once.
 *
 * Only add entries here for literals that appear in 3+ distinct files and
 * encode a protocol/format identifier — not log messages or error strings.
 */

/** Hash algorithm identifiers as used by crypto libraries and manifests. */
export const HashAlg = {
  SHA256: 'sha256',
} as const;

/** DID Core verification relationship names. */
export const DidRelationship = {
  ASSERTION_METHOD: 'assertionMethod',
} as const;

/** W3C Verifiable Credential proof suite type identifiers. */
export const ProofType = {
  ED25519_SIGNATURE_2020: 'Ed25519Signature2020',
} as const;

/** HTTP content-type identifiers. */
export const ContentType = {
  APPLICATION_JSON: 'application/json',
} as const;
