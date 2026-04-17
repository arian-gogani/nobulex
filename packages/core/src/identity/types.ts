import type { HashHex } from '../crypto/index';

/** The execution environment type for an AI agent. */
export type RuntimeType = 'wasm' | 'container' | 'tee' | 'firecracker' | 'process' | 'browser';

/** Attestation about the AI model powering an agent. */
export interface ModelAttestation {
  /** The model provider (e.g. `"anthropic"`, `"openai"`). */
  provider: string;
  // The model identifier (e.g
  modelId: string;
  /** Optional semantic version of the model. */
  modelVersion?: string;
  /** Optional hash attesting to the model weights or configuration. */
  attestationHash?: HashHex;
  /** How the attestation was produced. */
  attestationType?: 'provider_signed' | 'weight_hash' | 'self_reported';
}

/** Describes where and how an agent is deployed. */
export interface DeploymentContext {
  /** The execution environment type. */
  runtime: RuntimeType;
  /** Optional TEE attestation evidence. */
  teeAttestation?: string;
  /** Optional deployment region (e.g. `"us-east-1"`). */
  region?: string;
  // Optional cloud/hosting provider
  provider?: string;
}

/**
 * A single entry in an agent's lineage chain.
 *
 * Each evolution of an identity appends a new lineage entry,
 * forming a hash-linked chain similar to a blockchain.
 */
export interface LineageEntry {
  /** Composite identity hash at this point in the lineage. */
  identityHash: HashHex;
  /** The type of change that produced this entry. */
  changeType: 'created' | 'model_update' | 'capability_change' | 'operator_transfer' | 'fork' | 'merge';
  /** Human-readable description of the change. */
  description: string;
  // ISO 8601 timestamp of the change
  timestamp: string;
  /** Hash of the previous lineage entry, or `null` for the first entry. */
  parentHash: HashHex | null;
  /** Hex-encoded Ed25519 signature over the entry payload. */
  signature: string;
  /** Fraction of reputation preserved through this change (0.0 to 1.0). */
  reputationCarryForward: number;
}

// A complete, signed AI agent identity
export interface AgentIdentity {
  /** SHA-256 composite hash serving as the identity ID. */
  id: HashHex;
  /** Hex-encoded Ed25519 public key of the operator. */
  operatorPublicKey: string;
  /** Optional human-readable operator name. */
  operatorIdentifier?: string;
  /** Model attestation for the AI model. */
  model: ModelAttestation;
  // Sorted list of capability strings this agent has
  capabilities: string[];
  /** SHA-256 hash of the canonical capability list. */
  capabilityManifestHash: HashHex;
  // Deployment context describing the runtime environment
  deployment: DeploymentContext;
  /** Hash-linked chain of identity evolution entries. */
  lineage: LineageEntry[];
  /** Version number, equal to the lineage chain length. */
  version: number;
  /** ISO 8601 timestamp when the identity was first created. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent evolution. */
  updatedAt: string;
  /** Hex-encoded Ed25519 operator signature over the identity payload. */
  signature: string;
}

// Reputation carry-forward rates for each type of identity evolution
export interface EvolutionPolicy {
  /** Rate for minor updates (e.g. metadata changes). */
  minorUpdate: number;
  /** Rate for version bumps within the same model family. */
  modelVersionChange: number;
  /** Rate for switching to an entirely different model family. */
  modelFamilyChange: number;
  // Rate for transferring the identity to a new operator
  operatorTransfer: number;
  /** Rate for adding new capabilities. */
  capabilityExpansion: number;
  /** Rate for removing capabilities (no loss -- reduction is safe). */
  capabilityReduction: number;
  /** Rate for a full identity rebuild (complete reputation loss). */
  fullRebuild: number;
}

// Options for creating a new agent identity via {@link createIdentity}
export interface CreateIdentityOptions {
  // The operator's Ed25519 key pair for signing
  operatorKeyPair: import('@nobulex/crypto').KeyPair;
  /** Optional human-readable operator name. */
  operatorIdentifier?: string;
  /** Model attestation for the AI model. */
  model: ModelAttestation;
  /** List of capabilities the agent has. */
  capabilities: string[];
  /** Deployment context describing where the agent runs. */
  deployment: DeploymentContext;
}

// ---

// OIDC claims extracted from an identity provider token
export interface OIDCClaims {
  /** Issuer URL (e.g. "https://accounts.google.com"). */
  iss: string;
  /** Subject identifier. */
  sub: string;
  /** Audience. */
  aud: string;
  // Expiration time (unix seconds)
  exp: number;
  /** Issued-at time (unix seconds). */
  iat: number;
  /** Optional email. */
  email?: string;
}

/** An ephemeral session certificate binding an agent to short-lived keys. */
export interface SessionCertificate {
  // Unique certificate ID (content-addressed)
  id: HashHex;
  // DID of the agent this certificate is for
  agentDid: string;
  /** The agent's long-lived identity hash. */
  identityHash: HashHex;
  /** Hex-encoded ephemeral public key for this session. */
  sessionPublicKey: string;
  /** Model attestation for the session. */
  model: ModelAttestation;
  /** Capabilities granted for this session. */
  capabilities: string[];
  // Deployer identifier (organization or individual)
  deployer: string;
  /** Deployment environment for this session. */
  environment: DeploymentContext;
  /** ISO-8601 timestamp when the certificate was issued. */
  issuedAt: string;
  /** ISO-8601 timestamp when the certificate expires. */
  expiresAt: string;
  ttlSeconds: number;
  // OIDC claims from the identity provider, if authenticated via OIDC
  oidcClaims: OIDCClaims | null;
  /** Hex-encoded signature by the operator's long-lived key over the certificate. */
  signature: string;
}

/** Options for issuing a session certificate. */
export interface IssueSessionOptions {
  /** The agent's full identity. */
  identity: AgentIdentity;
  // The operator's long-lived key pair for signing
  operatorKeyPair: import('@nobulex/crypto').KeyPair;
  // The ephemeral session key pair
  sessionKeyPair: import('@nobulex/crypto').KeyPair;
  deployer: string;
  /** Session duration in seconds (default: 3600). */
  ttlSeconds?: number;
  /** Subset of identity capabilities to grant (default: all). */
  capabilities?: string[];
  /** OIDC claims if authenticated via OIDC. */
  oidcClaims?: OIDCClaims;
}

// Options for evolving an existing identity via {@link evolveIdentity}
export interface EvolveIdentityOptions {
  /** The operator's Ed25519 key pair for signing the evolution. */
  operatorKeyPair: import('@nobulex/crypto').KeyPair;
  /** The type of change being made. */
  changeType: LineageEntry['changeType'];
  /** Human-readable description of the change. */
  description: string;
  // The fields being updated (only specified fields change)
  updates: {
    model?: ModelAttestation;
    capabilities?: string[];
    deployment?: DeploymentContext;
    operatorPublicKey?: string;
    operatorIdentifier?: string;
  };
  /** Optional explicit reputation carry-forward rate override. */
  reputationCarryForward?: number;
}
