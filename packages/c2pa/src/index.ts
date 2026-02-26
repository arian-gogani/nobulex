/**
 * @nobulex/c2pa — C2PA content provenance manifests for AI agent outputs.
 *
 * When an agent produces output, wrap it with a manifest containing:
 * - Digital source type (AI-generated, AI-assisted, human)
 * - Input provenance references
 * - Transparency log pointer
 * - Merkle root covering the action chain
 *
 * The output carries cryptographic proof of its creation history.
 *
 * @packageDocumentation
 */

import {
  sha256String,
  sha256Object,
  canonicalizeJson,
  sign,
  verify,
  toHex,
  fromHex,
  timestamp as nowISO,
  generateId,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';
import type { EvidenceItem } from '@nobulex/evidence-core';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * C2PA digital source type.
 * @see https://c2pa.org/specifications/
 */
export type DigitalSourceType =
  | 'trainedAlgorithmicMedia'
  | 'compositeWithTrainedAlgorithmicMedia'
  | 'algorithmicMedia'
  | 'humanCreated'
  | 'composite';

/** Reference to a provenance-tracked input. */
export interface InputReference {
  /** Content hash of the input. */
  readonly contentHash: HashHex;
  /** Manifest ID of the input, if it has one. */
  readonly manifestId?: string;
  /** Relationship type. */
  readonly relationship: 'parentOf' | 'inputTo' | 'derivedFrom';
  /** Optional description. */
  readonly description?: string;
}

/** Pointer to a transparency log entry. */
export interface TransparencyPointer {
  /** URL or identifier of the transparency log. */
  readonly logId: string;
  /** Index of the log entry. */
  readonly entryIndex: number;
  /** Hash of the log entry for verification. */
  readonly entryHash: string;
  /** Optional endpoint URL for the log. */
  readonly endpoint?: string;
}

/** A C2PA-compatible provenance manifest. */
export interface ProvenanceManifest {
  /** Unique manifest identifier. */
  readonly id: string;
  /** C2PA claim generator identifier. */
  readonly claimGenerator: string;
  /** Digital source type classification. */
  readonly digitalSourceType: DigitalSourceType;
  /** Hash of the output content. */
  readonly contentHash: HashHex;
  /** MIME type of the output. */
  readonly contentType: string;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** DID of the agent that created the output. */
  readonly agentDid: string;
  /** Model that produced the output. */
  readonly modelVersion: string;
  /** References to input provenance. */
  readonly inputs: readonly InputReference[];
  /** Merkle root covering the action chain that produced this output. */
  readonly merkleRoot: string;
  /** Pointer to the transparency log entry, if available. */
  readonly transparencyPointer: TransparencyPointer | null;
  /** Evidence item hashes included in this manifest. */
  readonly evidenceChain: readonly string[];
  /** SHA-256 hash of the manifest content. */
  readonly hash: HashHex;
  /** Ed25519 signature of the hash. */
  readonly signature: string;
}

/** Input for creating a new manifest. */
export interface ManifestInput {
  readonly digitalSourceType: DigitalSourceType;
  readonly contentHash: HashHex;
  readonly contentType: string;
  readonly agentDid: string;
  readonly modelVersion: string;
  readonly inputs?: readonly InputReference[];
  readonly merkleRoot: string;
  readonly transparencyPointer?: TransparencyPointer | null;
  readonly evidenceChain?: readonly string[];
}

/** Result of verifying a manifest's integrity. */
export interface ManifestVerification {
  readonly valid: boolean;
  readonly checks: readonly ManifestCheck[];
}

/** A single verification check. */
export interface ManifestCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
}

// ─── Manifest content for hashing ───────────────────────────────────────────

interface ManifestContent {
  readonly claimGenerator: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly contentHash: HashHex;
  readonly contentType: string;
  readonly createdAt: string;
  readonly agentDid: string;
  readonly modelVersion: string;
  readonly inputs: readonly InputReference[];
  readonly merkleRoot: string;
  readonly transparencyPointer: TransparencyPointer | null;
  readonly evidenceChain: readonly string[];
}

const CLAIM_GENERATOR = 'nobulex/c2pa/0.2.0';

// ─── Create manifest ────────────────────────────────────────────────────────

/**
 * Create a signed C2PA provenance manifest for an agent's output.
 *
 * The manifest cryptographically binds the output content to:
 * - The agent's identity
 * - The chain of evidence items leading to the output
 * - The Merkle root of the evidence epoch
 * - An optional transparency log pointer
 */
export async function createManifest(
  input: ManifestInput,
  keyPair: KeyPair,
): Promise<ProvenanceManifest> {
  const content: ManifestContent = {
    claimGenerator: CLAIM_GENERATOR,
    digitalSourceType: input.digitalSourceType,
    contentHash: input.contentHash,
    contentType: input.contentType,
    createdAt: nowISO(),
    agentDid: input.agentDid,
    modelVersion: input.modelVersion,
    inputs: input.inputs ?? [],
    merkleRoot: input.merkleRoot,
    transparencyPointer: input.transparencyPointer ?? null,
    evidenceChain: input.evidenceChain ?? [],
  };

  const hash = sha256String(canonicalizeJson(content));
  const sigBytes = await sign(
    new TextEncoder().encode(hash),
    keyPair.privateKey,
  );

  return {
    id: generateId(),
    ...content,
    hash,
    signature: toHex(sigBytes),
  };
}

// ─── Verify manifest ────────────────────────────────────────────────────────

/** Verify a manifest's hash integrity and signature. */
export async function verifyManifest(
  manifest: ProvenanceManifest,
  signerPublicKey: Uint8Array,
): Promise<ManifestVerification> {
  const checks: ManifestCheck[] = [];

  // Check hash integrity
  const content: ManifestContent = {
    claimGenerator: manifest.claimGenerator,
    digitalSourceType: manifest.digitalSourceType,
    contentHash: manifest.contentHash,
    contentType: manifest.contentType,
    createdAt: manifest.createdAt,
    agentDid: manifest.agentDid,
    modelVersion: manifest.modelVersion,
    inputs: manifest.inputs,
    merkleRoot: manifest.merkleRoot,
    transparencyPointer: manifest.transparencyPointer,
    evidenceChain: manifest.evidenceChain,
  };

  const expectedHash = sha256String(canonicalizeJson(content));
  const hashValid = expectedHash === manifest.hash;
  checks.push({
    name: 'hash_integrity',
    passed: hashValid,
    reason: hashValid ? undefined : 'Manifest hash does not match content',
  });

  // Check signature
  let sigValid = false;
  try {
    sigValid = await verify(
      new TextEncoder().encode(manifest.hash),
      fromHex(manifest.signature),
      signerPublicKey,
    );
  } catch {
    sigValid = false;
  }
  checks.push({
    name: 'signature_valid',
    passed: sigValid,
    reason: sigValid ? undefined : 'Signature verification failed',
  });

  // Check required fields
  const hasContent = manifest.contentHash.length > 0;
  checks.push({
    name: 'content_hash_present',
    passed: hasContent,
    reason: hasContent ? undefined : 'Content hash is empty',
  });

  const hasMerkleRoot = manifest.merkleRoot.length > 0;
  checks.push({
    name: 'merkle_root_present',
    passed: hasMerkleRoot,
    reason: hasMerkleRoot ? undefined : 'Merkle root is empty',
  });

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

// ─── Convenience helpers ────────────────────────────────────────────────────

/** Create an input reference from an evidence item. */
export function inputFromEvidence(item: EvidenceItem, relationship: InputReference['relationship'] = 'inputTo'): InputReference {
  return {
    contentHash: item.inputHash,
    relationship,
  };
}

/** Hash arbitrary content for use as contentHash in a manifest. */
export function hashContent(content: string): HashHex {
  return sha256String(content);
}

/** Serialize a manifest to canonical JSON. */
export function serializeManifest(manifest: ProvenanceManifest): string {
  return canonicalizeJson(manifest);
}
