import type { HashHex } from '@stele/crypto';
import type { Severity } from '@stele/ccl';

// ─── Protocol constants ────────────────────────────────────────────────────────

/** Current Stele Covenant protocol version. */
export const PROTOCOL_VERSION = '1.0';

/** Maximum number of CCL constraint statements in a single covenant. */
export const MAX_CONSTRAINTS = 1000;

/** Maximum depth of a covenant chain (number of ancestors). */
export const MAX_CHAIN_DEPTH = 16;

/** Maximum serialized document size in bytes (1 MiB). */
export const MAX_DOCUMENT_SIZE = 1_048_576;

// ─── Enum-like union types ─────────────────────────────────────────────────────

/** How the covenant's constraints are enforced at runtime. */
export type EnforcementType = 'capability' | 'monitor' | 'audit' | 'bond' | 'composite';

/** What kind of proof attests to compliance. */
export type ProofType = 'tee' | 'capability_manifest' | 'audit_log' | 'bond_reference' | 'zkp' | 'composite';

/** How a child covenant relates to its parent in the chain. */
export type ChainRelation = 'delegates' | 'restricts' | 'extends';

/** Method used to revoke a covenant before its natural expiry. */
export type RevocationMethod = 'crl' | 'status_endpoint' | 'onchain';

/** Role a party plays in a covenant. */
export type PartyRole = 'issuer' | 'beneficiary' | 'auditor' | 'operator' | 'regulator';

// ─── Party types ───────────────────────────────────────────────────────────────

/** A participant in a covenant. */
export interface Party {
  /** Unique identifier for this party. */
  id: string;
  /** Hex-encoded Ed25519 public key. */
  publicKey: string;
  /** The role this party plays. */
  role: PartyRole;
  /** Optional human-readable name. */
  name?: string;
  /** Arbitrary metadata attached to the party. */
  metadata?: Record<string, unknown>;
}

/** The party that issues (creates and signs) the covenant. */
export interface Issuer extends Party {
  role: 'issuer';
}

/** The party that benefits from (is bound by) the covenant. */
export interface Beneficiary extends Party {
  role: 'beneficiary';
}

// ─── Chain types ───────────────────────────────────────────────────────────────

/** Reference to a parent covenant in a delegation chain. */
export interface ChainReference {
  /** SHA-256 ID of the parent covenant document. */
  parentId: HashHex;
  /** How this covenant relates to the parent. */
  relation: ChainRelation;
  /** Depth in the chain (parent is depth-1, grandparent depth-2, etc.). */
  depth: number;
}

// ─── Configuration types ───────────────────────────────────────────────────────

/** Runtime enforcement configuration for a covenant. */
export interface EnforcementConfig {
  /** The enforcement mechanism type. */
  type: EnforcementType;
  /** Type-specific configuration parameters. */
  config: Record<string, unknown>;
  /** Human-readable description of the enforcement. */
  description?: string;
}

/** Compliance proof configuration for a covenant. */
export interface ProofConfig {
  /** The proof mechanism type. */
  type: ProofType;
  /** Type-specific configuration parameters. */
  config: Record<string, unknown>;
  /** Human-readable description of the proof. */
  description?: string;
}

/** Revocation configuration for a covenant. */
export interface RevocationConfig {
  /** The revocation method. */
  method: RevocationMethod;
  /** URL endpoint for revocation checking (for status_endpoint method). */
  endpoint?: string;
  /** Method-specific configuration parameters. */
  config?: Record<string, unknown>;
}

// ─── Countersignature ──────────────────────────────────────────────────────────

/** A countersignature added by a third party (auditor, regulator, etc.). */
export interface Countersignature {
  /** Hex-encoded public key of the countersigner. */
  signerPublicKey: string;
  /** Role of the countersigner. */
  signerRole: PartyRole;
  /** Hex-encoded Ed25519 signature over the canonical form. */
  signature: string;
  /** ISO 8601 timestamp when the countersignature was created. */
  timestamp: string;
}

// ─── Obligation ────────────────────────────────────────────────────────────────

/** An obligation that must be fulfilled as part of the covenant. */
export interface Obligation {
  /** Unique identifier for this obligation. */
  id: string;
  /** Human-readable description of the obligation. */
  description: string;
  /** The action required to fulfill the obligation. */
  action: string;
  /** Optional deadline (ISO 8601) by which the obligation must be fulfilled. */
  deadline?: string;
}

// ─── Metadata ──────────────────────────────────────────────────────────────────

/** Optional metadata attached to a covenant document. */
export interface CovenantMetadata {
  /** Human-readable name of the covenant. */
  name?: string;
  /** Human-readable description. */
  description?: string;
  /** Searchable tags. */
  tags?: string[];
  /** Semantic version of the covenant content (not the protocol). */
  version?: string;
  /** Arbitrary custom metadata. */
  custom?: Record<string, unknown>;
}

// ─── Covenant document ─────────────────────────────────────────────────────────

/** A complete, signed Covenant document. */
export interface CovenantDocument {
  /** SHA-256 hash of the canonical form, serving as the document ID. */
  id: HashHex;
  /** Protocol version (always PROTOCOL_VERSION). */
  version: string;
  /** The issuer who created and signed this covenant. */
  issuer: Issuer;
  /** The beneficiary bound by this covenant. */
  beneficiary: Beneficiary;
  /** CCL constraint source text. */
  constraints: string;
  /** Optional list of obligations. */
  obligations?: Obligation[];
  /** Optional chain reference to a parent covenant. */
  chain?: ChainReference;
  /** Optional enforcement configuration. */
  enforcement?: EnforcementConfig;
  /** Optional proof configuration. */
  proof?: ProofConfig;
  /** Optional revocation configuration. */
  revocation?: RevocationConfig;
  /** Optional metadata. */
  metadata?: CovenantMetadata;
  /** Hex-encoded 32-byte nonce for replay protection. */
  nonce: string;
  /** ISO 8601 timestamp of document creation. */
  createdAt: string;
  /** Optional ISO 8601 expiry timestamp. */
  expiresAt?: string;
  /** Optional ISO 8601 activation timestamp. */
  activatesAt?: string;
  /** Hex-encoded Ed25519 signature of the issuer over the canonical form. */
  signature: string;
  /** Optional list of countersignatures from third parties. */
  countersignatures?: Countersignature[];
}

// ─── Builder options ───────────────────────────────────────────────────────────

/** Options passed to buildCovenant() to construct a new CovenantDocument. */
export interface CovenantBuilderOptions {
  /** The issuing party. */
  issuer: Issuer;
  /** The beneficiary party. */
  beneficiary: Beneficiary;
  /** CCL constraint source text. */
  constraints: string;
  /** Issuer's private key used to sign the document. */
  privateKey: Uint8Array;
  /** Optional obligations. */
  obligations?: Obligation[];
  /** Optional chain reference to parent covenant. */
  chain?: ChainReference;
  /** Optional enforcement configuration. */
  enforcement?: EnforcementConfig;
  /** Optional proof configuration. */
  proof?: ProofConfig;
  /** Optional revocation configuration. */
  revocation?: RevocationConfig;
  /** Optional metadata. */
  metadata?: CovenantMetadata;
  /** Optional ISO 8601 expiry timestamp. */
  expiresAt?: string;
  /** Optional ISO 8601 activation timestamp. */
  activatesAt?: string;
}

// ─── Verification types ────────────────────────────────────────────────────────

/** A single verification check and its result. */
export interface VerificationCheck {
  /** Name identifying this check. */
  name: string;
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable message explaining the result. */
  message?: string;
}

/** Complete result of verifying a covenant document. */
export interface VerificationResult {
  /** Whether all checks passed. */
  valid: boolean;
  /** Detailed results for each individual check. */
  checks: VerificationCheck[];
  /** The document that was verified (included for convenience). */
  document?: CovenantDocument;
}

// Re-export Severity from CCL for downstream consumers
export type { Severity };
