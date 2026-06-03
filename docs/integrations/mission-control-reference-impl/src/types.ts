/**
 * Type definitions for nobulex-trust-attestation-v1.
 *
 * Reference implementation for the Mission Control integration RFC at
 * docs/integrations/builderz-labs-mission-control-rfc.md.
 *
 * These types are the canonical shape of a signed Trust Capital
 * attestation that one deployment can hand to another. Tampering with
 * any field invalidates the signature.
 */

export type AttestationSchema = 'nobulex-trust-attestation-v1';

export type TrustTier = 'Restricted' | 'Standard' | 'Trusted' | 'Sovereign';

export interface AttestationClaim {
  /** Numeric Trust Capital score, 0-100. */
  trust_capital: number;
  /** Tier name (matches nobulex TrustCapital tiers). */
  tier: TrustTier;
  /** Window over which the score was observed, in milliseconds. */
  observation_window_ms: number;
  /** Number of receipts observed in the window. */
  receipt_count: number;
  /** Fraction of actions that were denied, 0-1. */
  deny_rate: number;
}

export interface AttestationEvidence {
  /** SHA-256 of the head of the receipt chain at issuance time. */
  receipt_chain_head: string;
  /** Optional public verifier endpoint where the chain can be fetched. */
  verifier_endpoint?: string;
  /** Spec identifier this attestation conforms to. */
  spec: 'action-ref-v1.0';
}

export interface AttestationSignature {
  alg: 'Ed25519';
  /** True if the signature covers the JCS-canonical preimage (RFC 8785). */
  jcs_canonical: true;
  /** Hex-encoded Ed25519 signature. */
  value: string;
}

export interface TrustAttestationV1 {
  schema: AttestationSchema;
  /** DID of the issuer (e.g. "did:web:nobulex.com"). */
  issuer: string;
  /** DID of the subject agent the attestation is about. */
  subject: string;
  /** Issuance timestamp, milliseconds since epoch. */
  issued_at_ms: number;
  claim: AttestationClaim;
  evidence: AttestationEvidence;
  signature: AttestationSignature;
}

/** Stored row for an issuer the operator has explicitly trusted. */
export interface TrustedIssuer {
  issuer_did: string;
  /** Maximum influence this issuer can have on the blended score, 0-1. */
  max_weight: number;
  added_at: number;
  added_by: string;
  notes?: string;
}

/** Result of a blend operation, suitable for storage in the audit log. */
export interface BlendResult {
  score: number;
  /** All sources that contributed to the score. 'local' is always present. */
  sources: string[];
  breakdown: {
    local: number;
    external_weighted_avg: number | null;
    effective_external_weight: number;
  };
}

/** Reasons an attestation can be rejected. */
export type RejectionReason =
  | 'wrong_schema'
  | 'unknown_issuer'
  | 'invalid_signature'
  | 'stale'
  | 'malformed';

export interface VerifyOutcome {
  ok: boolean;
  reason?: RejectionReason;
  attestation?: TrustAttestationV1;
}
