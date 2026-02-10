import type { HashHex } from '@stele/crypto';

/** The execution environment type for an AI agent. */
export type RuntimeType = 'wasm' | 'container' | 'tee' | 'firecracker' | 'process' | 'browser';

/** Attestation about the AI model powering an agent. */
export interface ModelAttestation {
  /** The model provider (e.g. `"anthropic"`, `"openai"`). */
  provider: string;
  /** The model identifier (e.g. `"claude-3"`, `"gpt-4"`). */
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
  /** Optional cloud/hosting provider. */
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
  /** ISO 8601 timestamp of the change. */
  timestamp: string;
  /** Hash of the previous lineage entry, or `null` for the first entry. */
  parentHash: HashHex | null;
  /** Hex-encoded Ed25519 signature over the entry payload. */
  signature: string;
  /** Fraction of reputation preserved through this change (0.0 to 1.0). */
  reputationCarryForward: number;
}

/**
 * A complete, signed AI agent identity.
 *
 * The identity is content-addressed: the `id` field is a SHA-256 hash
 * of all other fields (except `signature`). Any modification changes
 * the ID, making tampering detectable.
 */
export interface AgentIdentity {
  /** SHA-256 composite hash serving as the identity ID. */
  id: HashHex;
  /** Hex-encoded Ed25519 public key of the operator. */
  operatorPublicKey: string;
  /** Optional human-readable operator name. */
  operatorIdentifier?: string;
  /** Model attestation for the AI model. */
  model: ModelAttestation;
  /** Sorted list of capability strings this agent has. */
  capabilities: string[];
  /** SHA-256 hash of the canonical capability list. */
  capabilityManifestHash: HashHex;
  /** Deployment context describing the runtime environment. */
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

/**
 * Reputation carry-forward rates for each type of identity evolution.
 *
 * Each field is a value between 0.0 (no reputation preserved) and
 * 1.0 (full reputation preserved).
 */
export interface EvolutionPolicy {
  /** Rate for minor updates (e.g. metadata changes). */
  minorUpdate: number;
  /** Rate for version bumps within the same model family. */
  modelVersionChange: number;
  /** Rate for switching to an entirely different model family. */
  modelFamilyChange: number;
  /** Rate for transferring the identity to a new operator. */
  operatorTransfer: number;
  /** Rate for adding new capabilities. */
  capabilityExpansion: number;
  /** Rate for removing capabilities (no loss -- reduction is safe). */
  capabilityReduction: number;
  /** Rate for a full identity rebuild (complete reputation loss). */
  fullRebuild: number;
}

/** Options for creating a new agent identity via {@link createIdentity}. */
export interface CreateIdentityOptions {
  /** The operator's Ed25519 key pair for signing. */
  operatorKeyPair: import('@stele/crypto').KeyPair;
  /** Optional human-readable operator name. */
  operatorIdentifier?: string;
  /** Model attestation for the AI model. */
  model: ModelAttestation;
  /** List of capabilities the agent has. */
  capabilities: string[];
  /** Deployment context describing where the agent runs. */
  deployment: DeploymentContext;
}

/** Options for evolving an existing identity via {@link evolveIdentity}. */
export interface EvolveIdentityOptions {
  /** The operator's Ed25519 key pair for signing the evolution. */
  operatorKeyPair: import('@stele/crypto').KeyPair;
  /** The type of change being made. */
  changeType: LineageEntry['changeType'];
  /** Human-readable description of the change. */
  description: string;
  /** The fields being updated (only specified fields change). */
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
