/**
 * @nobulex/c2pa — Production-grade C2PA content provenance manifests for AI agent outputs.
 *
 * Implements C2PA-aligned provenance tracking including:
 * - Signed provenance manifests binding output to creation history
 * - Multiple assertion types (creative work, actions, ingredients, data hashes, data provenance, custom)
 * - Full structural validation with per-field reporting
 * - Manifest chain verification with gap/cycle detection
 * - JSON and binary manifest embedding/extraction
 * - In-memory manifest store with indexing, querying, and chain traversal
 * - Manifest diffing, summarization, and aggregate statistics
 * - Batch manifest creation for multi-output workflows
 * - Assertion construction from evidence items
 * - C2PA claim generation
 *
 * @packageDocumentation
 */

import {
  sha256String,
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

// ─── Constants ──────────────────────────────────────────────────────────────

const CLAIM_GENERATOR = 'nobulex/c2pa/0.2.0';
const BINARY_MANIFEST_TAG = 'C2PA\x00\x01';
const BINARY_MANIFEST_TAG_BYTES = new TextEncoder().encode(BINARY_MANIFEST_TAG);

// ─── Core Types ─────────────────────────────────────────────────────────────

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

// ─── Assertion Types ────────────────────────────────────────────────────────

/** Assertion declaring the digital source type of content. */
export interface CreativeWorkAssertion {
  readonly type: 'creativeWork';
  readonly digitalSourceType: DigitalSourceType;
  readonly authors?: readonly string[];
  readonly dateCreated?: string;
}

/** Assertion describing an action an agent performed. */
export interface ActionAssertion {
  readonly type: 'action';
  readonly action: string;
  readonly softwareAgent: string;
  readonly parameters?: Record<string, unknown>;
  readonly when?: string;
}

/** Assertion referencing an ingredient (input) used in production. */
export interface IngredientAssertion {
  readonly type: 'ingredient';
  readonly title: string;
  readonly contentHash: HashHex;
  readonly relationship: InputReference['relationship'];
  readonly manifestId?: string;
}

/** Assertion containing a data hash for content binding. */
export interface DataHashAssertion {
  readonly type: 'dataHash';
  readonly algorithm: 'sha256' | 'sha384' | 'sha512';
  readonly hash: HashHex;
  readonly name?: string;
  readonly exclusions?: readonly { start: number; length: number }[];
}

/**
 * Assertion describing the provenance lineage of a data source.
 * Captures where data came from, how it was collected, and its chain of custody.
 */
export interface DataProvenanceAssertion {
  readonly type: 'dataProvenance';
  /** Identifier or name of the data source. */
  readonly sourceName: string;
  /** URI or URL of the original data source. */
  readonly sourceUri?: string;
  /** Hash of the original source data. */
  readonly sourceHash?: HashHex;
  /** ISO-8601 timestamp when the data was collected or acquired. */
  readonly collectedAt?: string;
  /** Agent or process that collected the data. */
  readonly collectedBy?: string;
  /** Description of how the data was processed or transformed. */
  readonly processingDescription?: string;
  /** License or usage terms for the data. */
  readonly license?: string;
}

/** Extensible custom assertion for domain-specific use. */
export interface CustomAssertion {
  readonly type: 'custom';
  readonly label: string;
  readonly data: Record<string, unknown>;
}

/** Union of all assertion types. */
export type Assertion =
  | CreativeWorkAssertion
  | ActionAssertion
  | IngredientAssertion
  | DataHashAssertion
  | DataProvenanceAssertion
  | CustomAssertion;

// ─── Manifest Types ─────────────────────────────────────────────────────────

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
  /** Typed assertions attached to this manifest. */
  readonly assertions: readonly Assertion[];
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
  readonly assertions?: readonly Assertion[];
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

// ─── Validation Types ───────────────────────────────────────────────────────

/** Result of a single field validation. */
export interface FieldValidation {
  readonly field: string;
  readonly valid: boolean;
  readonly message: string;
}

/** Full structural validation report for a manifest. */
export interface ValidationReport {
  readonly valid: boolean;
  readonly results: readonly FieldValidation[];
}

// ─── Chain Verification Types ───────────────────────────────────────────────

/** A node in the manifest chain graph. */
export interface ChainNode {
  readonly manifestId: string;
  readonly contentHash: HashHex;
  readonly agentDid: string;
  readonly createdAt: string;
  readonly inputManifestIds: readonly string[];
}

/** Result of verifying a manifest chain. */
export interface ManifestChainResult {
  readonly valid: boolean;
  readonly chain: readonly ChainNode[];
  readonly gaps: readonly string[];
  readonly cycles: readonly string[];
  readonly errors: readonly string[];
}

// ─── Diff Types ─────────────────────────────────────────────────────────────

/** A single field difference between two manifests. */
export interface ManifestFieldDiff {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/** Full diff result between two manifests. */
export interface ManifestDiff {
  readonly fieldsChanged: readonly ManifestFieldDiff[];
  readonly identical: boolean;
}

// ─── Summary Types ──────────────────────────────────────────────────────────

/** Human-readable manifest summary. */
export interface ManifestSummary {
  readonly id: string;
  readonly agent: string;
  readonly sourceType: string;
  readonly contentType: string;
  readonly createdAt: string;
  readonly inputCount: number;
  readonly assertionCount: number;
  readonly hasTransparencyPointer: boolean;
  readonly evidenceChainLength: number;
  readonly summary: string;
}

/** Aggregate statistics across multiple manifests. */
export interface ManifestStats {
  readonly totalManifests: number;
  readonly uniqueAgents: readonly string[];
  readonly sourceTypeDistribution: Record<string, number>;
  readonly contentTypeDistribution: Record<string, number>;
  readonly averageInputCount: number;
  readonly averageAssertionCount: number;
  readonly earliestCreatedAt: string | null;
  readonly latestCreatedAt: string | null;
  readonly totalAssertionsByType: Record<string, number>;
}

// ─── Claim Types ────────────────────────────────────────────────────────────

/** C2PA Claim structure (v2 aligned). */
export interface ClaimV2 {
  readonly claimGenerator: string;
  readonly claimGeneratorInfo?: readonly { name: string; version: string }[];
  readonly dc_title?: string;
  readonly dc_format: string;
  readonly instanceId: string;
  readonly signature: string;
  readonly assertions: readonly ClaimAssertionReference[];
  readonly ingredients: readonly ClaimIngredient[];
  readonly createdAt: string;
  readonly contentBindings: readonly ContentBinding[];
}

/** Reference to an assertion within a claim. */
export interface ClaimAssertionReference {
  readonly url: string;
  readonly hash: HashHex;
}

/** Ingredient reference within a claim. */
export interface ClaimIngredient {
  readonly title: string;
  readonly relationship: string;
  readonly hash: HashHex;
  readonly manifestId?: string;
}

/** Content binding hash within a claim. */
export interface ContentBinding {
  readonly algorithm: string;
  readonly hash: HashHex;
}

// ─── Manifest Store Query Types ─────────────────────────────────────────────

/** Query filter for searching manifests in the store. */
export interface ManifestQuery {
  /** Filter by agent DID. */
  readonly agentDid?: string;
  /** Filter by digital source type. */
  readonly digitalSourceType?: DigitalSourceType;
  /** Filter by content type (MIME type). */
  readonly contentType?: string;
  /** Filter by model version. */
  readonly modelVersion?: string;
  /** Only include manifests created at or after this ISO-8601 timestamp. */
  readonly createdAfter?: string;
  /** Only include manifests created at or before this ISO-8601 timestamp. */
  readonly createdBefore?: string;
  /** Only include manifests that have at least one input. */
  readonly hasInputs?: boolean;
  /** Only include manifests that have assertions of this type. */
  readonly assertionType?: Assertion['type'];
  /** Maximum number of results to return. */
  readonly limit?: number;
}

// ─── Internal: Manifest content for hashing ─────────────────────────────────

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
  readonly assertions: readonly Assertion[];
}

function extractManifestContent(manifest: ProvenanceManifest): ManifestContent {
  return {
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
    assertions: manifest.assertions,
  };
}

// ─── Create Manifest ────────────────────────────────────────────────────────

/**
 * Create a signed C2PA provenance manifest for an agent's output.
 *
 * The manifest cryptographically binds the output content to:
 * - The agent's identity
 * - The chain of evidence items leading to the output
 * - The Merkle root of the evidence epoch
 * - An optional transparency log pointer
 * - Typed assertions about the content
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
    assertions: input.assertions ?? [],
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

// ─── Batch Manifest Creation ────────────────────────────────────────────────

/**
 * Create signed manifests for multiple outputs in a single batch.
 *
 * Each input produces an independent manifest signed by the same key pair.
 * All manifests in the batch share the same timestamp for consistency.
 * This is more efficient than calling createManifest in a loop when
 * creating manifests for multi-output workflows (e.g., an agent that
 * produces several files in one action).
 *
 * @param inputs - Array of manifest inputs, one per output.
 * @param keyPair - Key pair used to sign all manifests.
 * @returns Array of signed manifests in the same order as inputs.
 */
export async function createBatchManifests(
  inputs: readonly ManifestInput[],
  keyPair: KeyPair,
): Promise<readonly ProvenanceManifest[]> {
  if (inputs.length === 0) return [];

  const results: ProvenanceManifest[] = [];
  const ts = nowISO();

  for (const input of inputs) {
    const content: ManifestContent = {
      claimGenerator: CLAIM_GENERATOR,
      digitalSourceType: input.digitalSourceType,
      contentHash: input.contentHash,
      contentType: input.contentType,
      createdAt: ts,
      agentDid: input.agentDid,
      modelVersion: input.modelVersion,
      inputs: input.inputs ?? [],
      merkleRoot: input.merkleRoot,
      transparencyPointer: input.transparencyPointer ?? null,
      evidenceChain: input.evidenceChain ?? [],
      assertions: input.assertions ?? [],
    };

    const hash = sha256String(canonicalizeJson(content));
    const sigBytes = await sign(
      new TextEncoder().encode(hash),
      keyPair.privateKey,
    );

    results.push({
      id: generateId(),
      ...content,
      hash,
      signature: toHex(sigBytes),
    });
  }

  return results;
}

// ─── Verify Manifest ────────────────────────────────────────────────────────

/** Verify a manifest's hash integrity and signature. */
export async function verifyManifest(
  manifest: ProvenanceManifest,
  signerPublicKey: Uint8Array,
): Promise<ManifestVerification> {
  const checks: ManifestCheck[] = [];

  // Check hash integrity
  const content = extractManifestContent(manifest);
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

// ─── Assertions ─────────────────────────────────────────────────────────────

/**
 * Add an assertion to a manifest, returning a new manifest with the assertion appended.
 * The new manifest is re-signed since the content has changed.
 */
export async function addAssertion(
  manifest: ProvenanceManifest,
  assertion: Assertion,
  keyPair: KeyPair,
): Promise<ProvenanceManifest> {
  const newAssertions = [...manifest.assertions, assertion];

  const content: ManifestContent = {
    ...extractManifestContent(manifest),
    assertions: newAssertions,
  };

  const hash = sha256String(canonicalizeJson(content));
  const sigBytes = await sign(
    new TextEncoder().encode(hash),
    keyPair.privateKey,
  );

  return {
    id: manifest.id,
    ...content,
    hash,
    signature: toHex(sigBytes),
  };
}

/**
 * Create an assertion from an evidence item.
 *
 * Maps evidence fields to an ActionAssertion capturing the tool call,
 * agent identity, model version, and input/output hashes.
 *
 * @param item - The evidence item to derive an assertion from.
 * @returns An ActionAssertion derived from the evidence item.
 */
export function assertionFromEvidence(item: EvidenceItem): ActionAssertion {
  return {
    type: 'action',
    action: item.actionType,
    softwareAgent: `${item.agentDid}/${item.modelVersion}`,
    parameters: {
      toolName: item.toolName,
      inputHash: item.inputHash,
      outputHash: item.outputHash,
    },
    when: item.timestamp,
  };
}

/**
 * Create a CreativeWork assertion with common defaults.
 *
 * @param sourceType - The digital source type.
 * @param authors - Optional list of author identifiers.
 * @param dateCreated - Optional ISO-8601 creation date.
 * @returns A CreativeWorkAssertion.
 */
export function creativeWorkAssertion(
  sourceType: DigitalSourceType,
  authors?: readonly string[],
  dateCreated?: string,
): CreativeWorkAssertion {
  return {
    type: 'creativeWork',
    digitalSourceType: sourceType,
    authors,
    dateCreated,
  };
}

/**
 * Create a DataProvenance assertion describing the lineage of a data source.
 *
 * @param sourceName - Name or identifier of the data source.
 * @param options - Additional provenance metadata.
 * @returns A DataProvenanceAssertion.
 */
export function dataProvenanceAssertion(
  sourceName: string,
  options?: {
    sourceUri?: string;
    sourceHash?: HashHex;
    collectedAt?: string;
    collectedBy?: string;
    processingDescription?: string;
    license?: string;
  },
): DataProvenanceAssertion {
  return {
    type: 'dataProvenance',
    sourceName,
    ...options,
  };
}

// ─── Manifest Validation ────────────────────────────────────────────────────

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX_HASH_REGEX = /^[0-9a-f]{64}$/;

function validateField(
  field: string,
  valid: boolean,
  message: string,
): FieldValidation {
  return { field, valid, message };
}

/** Validate the structural integrity of a manifest beyond cryptographic checks. */
export function validateManifest(manifest: ProvenanceManifest): ValidationReport {
  const results: FieldValidation[] = [];

  // Required string fields
  results.push(validateField(
    'id',
    typeof manifest.id === 'string' && manifest.id.length > 0,
    manifest.id?.length > 0 ? 'Present' : 'Missing or empty',
  ));

  results.push(validateField(
    'claimGenerator',
    typeof manifest.claimGenerator === 'string' && manifest.claimGenerator.length > 0,
    manifest.claimGenerator?.length > 0 ? 'Present' : 'Missing or empty',
  ));

  results.push(validateField(
    'agentDid',
    typeof manifest.agentDid === 'string' && manifest.agentDid.startsWith('did:'),
    manifest.agentDid?.startsWith('did:') ? 'Valid DID format' : 'Must start with did:',
  ));

  results.push(validateField(
    'modelVersion',
    typeof manifest.modelVersion === 'string' && manifest.modelVersion.length > 0,
    manifest.modelVersion?.length > 0 ? 'Present' : 'Missing or empty',
  ));

  // Content hash format
  results.push(validateField(
    'contentHash',
    typeof manifest.contentHash === 'string' && HEX_HASH_REGEX.test(manifest.contentHash),
    HEX_HASH_REGEX.test(manifest.contentHash ?? '') ? 'Valid SHA-256 hex' : 'Must be 64-char lowercase hex',
  ));

  // Content type
  results.push(validateField(
    'contentType',
    typeof manifest.contentType === 'string' && manifest.contentType.includes('/'),
    manifest.contentType?.includes('/') ? 'Valid MIME type' : 'Must be a valid MIME type (e.g. text/plain)',
  ));

  // Timestamp
  results.push(validateField(
    'createdAt',
    typeof manifest.createdAt === 'string' && ISO_8601_REGEX.test(manifest.createdAt),
    ISO_8601_REGEX.test(manifest.createdAt ?? '') ? 'Valid ISO-8601' : 'Must be ISO-8601 UTC (e.g. 2025-01-15T12:00:00.000Z)',
  ));

  // Timestamp not in the future (with 5 minute tolerance)
  if (ISO_8601_REGEX.test(manifest.createdAt ?? '')) {
    const ts = new Date(manifest.createdAt).getTime();
    const now = Date.now();
    const futureLimit = now + 5 * 60 * 1000;
    const notFuture = ts <= futureLimit;
    results.push(validateField(
      'createdAt.notFuture',
      notFuture,
      notFuture ? 'Not in the future' : 'Timestamp is in the future',
    ));
  }

  // Digital source type
  const validSourceTypes: DigitalSourceType[] = [
    'trainedAlgorithmicMedia',
    'compositeWithTrainedAlgorithmicMedia',
    'algorithmicMedia',
    'humanCreated',
    'composite',
  ];
  results.push(validateField(
    'digitalSourceType',
    validSourceTypes.includes(manifest.digitalSourceType),
    validSourceTypes.includes(manifest.digitalSourceType) ? 'Valid source type' : 'Unknown digital source type',
  ));

  // Merkle root
  results.push(validateField(
    'merkleRoot',
    typeof manifest.merkleRoot === 'string' && manifest.merkleRoot.length > 0,
    manifest.merkleRoot?.length > 0 ? 'Present' : 'Missing or empty',
  ));

  // Hash format
  results.push(validateField(
    'hash',
    typeof manifest.hash === 'string' && HEX_HASH_REGEX.test(manifest.hash),
    HEX_HASH_REGEX.test(manifest.hash ?? '') ? 'Valid SHA-256 hex' : 'Must be 64-char lowercase hex',
  ));

  // Signature format (Ed25519 = 128 hex chars = 64 bytes)
  const sigHexRegex = /^[0-9a-f]{128}$/;
  results.push(validateField(
    'signature',
    typeof manifest.signature === 'string' && sigHexRegex.test(manifest.signature),
    sigHexRegex.test(manifest.signature ?? '') ? 'Valid Ed25519 signature hex' : 'Must be 128-char lowercase hex',
  ));

  // Inputs validation
  results.push(validateField(
    'inputs',
    Array.isArray(manifest.inputs),
    Array.isArray(manifest.inputs) ? `${manifest.inputs.length} input(s)` : 'Must be an array',
  ));

  if (Array.isArray(manifest.inputs)) {
    for (let i = 0; i < manifest.inputs.length; i++) {
      const inp = manifest.inputs[i]!;
      const validRel = ['parentOf', 'inputTo', 'derivedFrom'].includes(inp.relationship);
      results.push(validateField(
        `inputs[${i}].relationship`,
        validRel,
        validRel ? `Valid: ${inp.relationship}` : `Invalid relationship: ${inp.relationship}`,
      ));

      const hasHash = typeof inp.contentHash === 'string' && inp.contentHash.length > 0;
      results.push(validateField(
        `inputs[${i}].contentHash`,
        hasHash,
        hasHash ? 'Present' : 'Missing or empty',
      ));
    }
  }

  // Assertions validation
  results.push(validateField(
    'assertions',
    Array.isArray(manifest.assertions),
    Array.isArray(manifest.assertions) ? `${manifest.assertions.length} assertion(s)` : 'Must be an array',
  ));

  if (Array.isArray(manifest.assertions)) {
    for (let i = 0; i < manifest.assertions.length; i++) {
      const a = manifest.assertions[i]!;
      const validResult = validateAssertionStructure(a, i);
      results.push(...validResult);
    }
  }

  // Transparency pointer
  if (manifest.transparencyPointer !== null && manifest.transparencyPointer !== undefined) {
    const tp = manifest.transparencyPointer;
    results.push(validateField(
      'transparencyPointer.logId',
      typeof tp.logId === 'string' && tp.logId.length > 0,
      tp.logId?.length > 0 ? 'Present' : 'Missing or empty',
    ));
    results.push(validateField(
      'transparencyPointer.entryIndex',
      typeof tp.entryIndex === 'number' && tp.entryIndex >= 0,
      tp.entryIndex >= 0 ? `Index: ${tp.entryIndex}` : 'Must be non-negative',
    ));
    results.push(validateField(
      'transparencyPointer.entryHash',
      typeof tp.entryHash === 'string' && tp.entryHash.length > 0,
      tp.entryHash?.length > 0 ? 'Present' : 'Missing or empty',
    ));
  }

  return {
    valid: results.every((r) => r.valid),
    results,
  };
}

function validateAssertionStructure(a: Assertion, index: number): FieldValidation[] {
  const results: FieldValidation[] = [];
  const prefix = `assertions[${index}]`;

  const validTypes = ['creativeWork', 'action', 'ingredient', 'dataHash', 'dataProvenance', 'custom'];
  results.push(validateField(
    `${prefix}.type`,
    validTypes.includes(a.type),
    validTypes.includes(a.type) ? `Valid type: ${a.type}` : `Unknown type: ${a.type}`,
  ));

  switch (a.type) {
    case 'creativeWork': {
      const validSourceTypes: DigitalSourceType[] = [
        'trainedAlgorithmicMedia', 'compositeWithTrainedAlgorithmicMedia',
        'algorithmicMedia', 'humanCreated', 'composite',
      ];
      results.push(validateField(
        `${prefix}.digitalSourceType`,
        validSourceTypes.includes(a.digitalSourceType),
        validSourceTypes.includes(a.digitalSourceType) ? 'Valid' : 'Invalid source type',
      ));
      break;
    }
    case 'action': {
      results.push(validateField(
        `${prefix}.action`,
        typeof a.action === 'string' && a.action.length > 0,
        a.action?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      results.push(validateField(
        `${prefix}.softwareAgent`,
        typeof a.softwareAgent === 'string' && a.softwareAgent.length > 0,
        a.softwareAgent?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      break;
    }
    case 'ingredient': {
      results.push(validateField(
        `${prefix}.title`,
        typeof a.title === 'string' && a.title.length > 0,
        a.title?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      results.push(validateField(
        `${prefix}.contentHash`,
        typeof a.contentHash === 'string' && a.contentHash.length > 0,
        a.contentHash?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      break;
    }
    case 'dataHash': {
      const validAlgs = ['sha256', 'sha384', 'sha512'];
      results.push(validateField(
        `${prefix}.algorithm`,
        validAlgs.includes(a.algorithm),
        validAlgs.includes(a.algorithm) ? 'Valid' : `Unknown algorithm: ${a.algorithm}`,
      ));
      results.push(validateField(
        `${prefix}.hash`,
        typeof a.hash === 'string' && a.hash.length > 0,
        a.hash?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      break;
    }
    case 'dataProvenance': {
      results.push(validateField(
        `${prefix}.sourceName`,
        typeof a.sourceName === 'string' && a.sourceName.length > 0,
        a.sourceName?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      if (a.collectedAt !== undefined) {
        results.push(validateField(
          `${prefix}.collectedAt`,
          ISO_8601_REGEX.test(a.collectedAt),
          ISO_8601_REGEX.test(a.collectedAt) ? 'Valid ISO-8601' : 'Must be ISO-8601 UTC',
        ));
      }
      break;
    }
    case 'custom': {
      results.push(validateField(
        `${prefix}.label`,
        typeof a.label === 'string' && a.label.length > 0,
        a.label?.length > 0 ? 'Present' : 'Missing or empty',
      ));
      results.push(validateField(
        `${prefix}.data`,
        typeof a.data === 'object' && a.data !== null,
        typeof a.data === 'object' && a.data !== null ? 'Present' : 'Must be an object',
      ));
      break;
    }
  }

  return results;
}

// ─── Manifest Chain Verification ────────────────────────────────────────────

/**
 * Verify that an array of manifests form a valid provenance chain,
 * where outputs reference inputs correctly. Detects gaps and cycles.
 */
export function verifyManifestChain(
  manifests: readonly ProvenanceManifest[],
): ManifestChainResult {
  const errors: string[] = [];
  const gaps: string[] = [];
  const cycles: string[] = [];
  const chain: ChainNode[] = [];

  if (manifests.length === 0) {
    return { valid: true, chain: [], gaps: [], cycles: [], errors: [] };
  }

  // Build index of known manifest IDs and content hashes
  const manifestById = new Map<string, ProvenanceManifest>();
  const manifestByContentHash = new Map<string, ProvenanceManifest>();
  for (const m of manifests) {
    if (manifestById.has(m.id)) {
      errors.push(`Duplicate manifest ID: ${m.id}`);
    }
    manifestById.set(m.id, m);
    manifestByContentHash.set(m.contentHash, m);
  }

  // Build chain nodes and check references
  for (const m of manifests) {
    const inputManifestIds: string[] = [];

    for (const input of m.inputs) {
      if (input.manifestId) {
        inputManifestIds.push(input.manifestId);
        if (!manifestById.has(input.manifestId)) {
          gaps.push(`Manifest ${m.id} references unknown manifest ${input.manifestId}`);
        }
      } else if (input.contentHash) {
        // Try to resolve by content hash
        const referenced = manifestByContentHash.get(input.contentHash);
        if (referenced) {
          inputManifestIds.push(referenced.id);
        }
        // Not having a manifest for an input content hash is not necessarily a gap
        // -- the input might be raw content without its own manifest
      }
    }

    chain.push({
      manifestId: m.id,
      contentHash: m.contentHash,
      agentDid: m.agentDid,
      createdAt: m.createdAt,
      inputManifestIds,
    });
  }

  // Cycle detection using DFS
  const adjacency = new Map<string, string[]>();
  for (const node of chain) {
    adjacency.set(node.manifestId, [...node.inputManifestIds]);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): void {
    if (inStack.has(nodeId)) {
      cycles.push(`Cycle detected involving manifest ${nodeId}`);
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    inStack.add(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (adjacency.has(neighbor)) {
        dfs(neighbor);
      }
    }

    inStack.delete(nodeId);
  }

  for (const node of chain) {
    dfs(node.manifestId);
  }

  // Temporal ordering check
  for (const node of chain) {
    const manifest = manifestById.get(node.manifestId)!;
    const manifestTime = new Date(manifest.createdAt).getTime();

    for (const inputId of node.inputManifestIds) {
      const inputManifest = manifestById.get(inputId);
      if (inputManifest) {
        const inputTime = new Date(inputManifest.createdAt).getTime();
        if (manifestTime < inputTime) {
          errors.push(
            `Manifest ${manifest.id} (${manifest.createdAt}) created before its input ${inputId} (${inputManifest.createdAt})`,
          );
        }
      }
    }
  }

  const valid = errors.length === 0 && cycles.length === 0;

  return { valid, chain, gaps, cycles, errors };
}

// ─── JSON Embedding/Extraction ──────────────────────────────────────────────

/**
 * Embed a provenance manifest into a JSON-serializable object by adding a `_c2pa` field.
 * Returns a new object with the manifest embedded -- does not mutate the original.
 */
export function embedManifestInJSON<T extends Record<string, unknown>>(
  data: T,
  manifest: ProvenanceManifest,
): T & { _c2pa: ProvenanceManifest } {
  return { ...data, _c2pa: manifest };
}

/**
 * Extract a provenance manifest from a JSON object's `_c2pa` field.
 * Returns null if no manifest is embedded.
 */
export function extractManifestFromJSON(
  data: Record<string, unknown>,
): ProvenanceManifest | null {
  if (data && typeof data === 'object' && '_c2pa' in data && data._c2pa !== null && data._c2pa !== undefined) {
    return data._c2pa as ProvenanceManifest;
  }
  return null;
}

// ─── Binary Embedding/Extraction ────────────────────────────────────────────

/**
 * Embed a manifest into a binary buffer by appending:
 *   [original bytes] [manifest JSON UTF-8] [4-byte big-endian manifest length] [tag bytes]
 *
 * The tag allows detection and extraction of the manifest from the end of the buffer.
 */
export function embedManifestInBinary(
  buffer: Uint8Array,
  manifest: ProvenanceManifest,
): Uint8Array {
  const manifestJson = canonicalizeJson(manifest);
  const manifestBytes = new TextEncoder().encode(manifestJson);
  const lengthBytes = new Uint8Array(4);
  const view = new DataView(lengthBytes.buffer);
  view.setUint32(0, manifestBytes.length, false); // big-endian

  const result = new Uint8Array(
    buffer.length + manifestBytes.length + 4 + BINARY_MANIFEST_TAG_BYTES.length,
  );
  result.set(buffer, 0);
  result.set(manifestBytes, buffer.length);
  result.set(lengthBytes, buffer.length + manifestBytes.length);
  result.set(BINARY_MANIFEST_TAG_BYTES, buffer.length + manifestBytes.length + 4);

  return result;
}

/**
 * Extract a manifest from a binary buffer that was embedded with `embedManifestInBinary`.
 * Returns null if no manifest tag is found at the end of the buffer.
 */
export function extractManifestFromBinary(
  buffer: Uint8Array,
): { manifest: ProvenanceManifest; originalBuffer: Uint8Array } | null {
  const tagLen = BINARY_MANIFEST_TAG_BYTES.length;

  if (buffer.length < tagLen + 4) {
    return null;
  }

  // Check for the tag at the end
  const tagStart = buffer.length - tagLen;
  for (let i = 0; i < tagLen; i++) {
    if (buffer[tagStart + i] !== BINARY_MANIFEST_TAG_BYTES[i]) {
      return null;
    }
  }

  // Read 4-byte big-endian manifest length
  const lengthStart = tagStart - 4;
  const view = new DataView(buffer.buffer, buffer.byteOffset + lengthStart, 4);
  const manifestLength = view.getUint32(0, false);

  const manifestStart = lengthStart - manifestLength;
  if (manifestStart < 0) {
    return null;
  }

  const manifestBytes = buffer.slice(manifestStart, manifestStart + manifestLength);
  const manifestJson = new TextDecoder().decode(manifestBytes);

  let manifest: ProvenanceManifest;
  try {
    manifest = JSON.parse(manifestJson) as ProvenanceManifest;
  } catch {
    return null;
  }

  const originalBuffer = buffer.slice(0, manifestStart);

  return { manifest, originalBuffer };
}

// ─── Manifest Store ─────────────────────────────────────────────────────────

/**
 * In-memory manifest store with indexing by ID, content hash, and agent DID.
 * Supports chain traversal via `getChainFor` and flexible querying via `query`.
 */
export class ManifestStore {
  private readonly byId = new Map<string, ProvenanceManifest>();
  private readonly byContentHash = new Map<string, ProvenanceManifest[]>();
  private readonly byAgent = new Map<string, ProvenanceManifest[]>();

  /** Add a manifest to the store. Overwrites if the same ID already exists. */
  add(manifest: ProvenanceManifest): void {
    this.byId.set(manifest.id, manifest);

    // Index by content hash
    const byHash = this.byContentHash.get(manifest.contentHash);
    if (byHash) {
      // Replace if same ID, otherwise append
      const existingIdx = byHash.findIndex((m) => m.id === manifest.id);
      if (existingIdx >= 0) {
        byHash[existingIdx] = manifest;
      } else {
        byHash.push(manifest);
      }
    } else {
      this.byContentHash.set(manifest.contentHash, [manifest]);
    }

    // Index by agent DID
    const byDid = this.byAgent.get(manifest.agentDid);
    if (byDid) {
      const existingIdx = byDid.findIndex((m) => m.id === manifest.id);
      if (existingIdx >= 0) {
        byDid[existingIdx] = manifest;
      } else {
        byDid.push(manifest);
      }
    } else {
      this.byAgent.set(manifest.agentDid, [manifest]);
    }
  }

  /** Retrieve a manifest by its ID. */
  get(id: string): ProvenanceManifest | undefined {
    return this.byId.get(id);
  }

  /** Retrieve all manifests with a given content hash. */
  getByContentHash(hash: HashHex): readonly ProvenanceManifest[] {
    return this.byContentHash.get(hash) ?? [];
  }

  /** Retrieve all manifests created by a given agent DID. */
  getByAgent(did: string): readonly ProvenanceManifest[] {
    return this.byAgent.get(did) ?? [];
  }

  /** List all manifests in insertion order. */
  list(): readonly ProvenanceManifest[] {
    return [...this.byId.values()];
  }

  /**
   * Query manifests using flexible filter criteria.
   *
   * All filter fields are combined with logical AND. Only manifests matching
   * every specified criterion are returned. Unspecified fields are not filtered.
   *
   * @param filter - Query criteria for filtering manifests.
   * @returns Manifests matching all specified criteria.
   */
  query(filter: ManifestQuery): readonly ProvenanceManifest[] {
    let results: ProvenanceManifest[];

    // Start from the narrowest index if possible
    if (filter.agentDid !== undefined) {
      results = [...(this.byAgent.get(filter.agentDid) ?? [])];
    } else {
      results = [...this.byId.values()];
    }

    // Apply remaining filters
    if (filter.digitalSourceType !== undefined) {
      results = results.filter((m) => m.digitalSourceType === filter.digitalSourceType);
    }

    if (filter.contentType !== undefined) {
      results = results.filter((m) => m.contentType === filter.contentType);
    }

    if (filter.modelVersion !== undefined) {
      results = results.filter((m) => m.modelVersion === filter.modelVersion);
    }

    if (filter.createdAfter !== undefined) {
      const after = filter.createdAfter;
      results = results.filter((m) => m.createdAt >= after);
    }

    if (filter.createdBefore !== undefined) {
      const before = filter.createdBefore;
      results = results.filter((m) => m.createdAt <= before);
    }

    if (filter.hasInputs !== undefined) {
      if (filter.hasInputs) {
        results = results.filter((m) => m.inputs.length > 0);
      } else {
        results = results.filter((m) => m.inputs.length === 0);
      }
    }

    if (filter.assertionType !== undefined) {
      const assertType = filter.assertionType;
      results = results.filter((m) =>
        m.assertions.some((a) => a.type === assertType),
      );
    }

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /** Remove a manifest by ID. Returns true if found and removed. */
  remove(id: string): boolean {
    const manifest = this.byId.get(id);
    if (!manifest) return false;

    this.byId.delete(id);

    // Remove from content hash index
    const byHash = this.byContentHash.get(manifest.contentHash);
    if (byHash) {
      const idx = byHash.findIndex((m) => m.id === id);
      if (idx >= 0) byHash.splice(idx, 1);
      if (byHash.length === 0) this.byContentHash.delete(manifest.contentHash);
    }

    // Remove from agent index
    const byDid = this.byAgent.get(manifest.agentDid);
    if (byDid) {
      const idx = byDid.findIndex((m) => m.id === id);
      if (idx >= 0) byDid.splice(idx, 1);
      if (byDid.length === 0) this.byAgent.delete(manifest.agentDid);
    }

    return true;
  }

  /** Get the total number of manifests in the store. */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Get the provenance chain leading to a given manifest.
   * Traverses input references backwards through the store, returning manifests
   * in order from root inputs to the target manifest.
   */
  getChainFor(manifestId: string): readonly ProvenanceManifest[] {
    const target = this.byId.get(manifestId);
    if (!target) return [];

    const chain: ProvenanceManifest[] = [];
    const visited = new Set<string>();
    const queue: ProvenanceManifest[] = [target];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      chain.push(current);

      for (const input of current.inputs) {
        if (input.manifestId) {
          const inputManifest = this.byId.get(input.manifestId);
          if (inputManifest && !visited.has(inputManifest.id)) {
            queue.push(inputManifest);
          }
        } else {
          // Try to resolve by content hash
          const candidates = this.byContentHash.get(input.contentHash);
          if (candidates) {
            for (const candidate of candidates) {
              if (!visited.has(candidate.id)) {
                queue.push(candidate);
              }
            }
          }
        }
      }
    }

    // Reverse so root inputs come first, target comes last
    chain.reverse();
    return chain;
  }
}

// ─── Manifest Diff ──────────────────────────────────────────────────────────

/** Fields to compare when diffing manifests. */
const DIFF_FIELDS: readonly (keyof ProvenanceManifest)[] = [
  'claimGenerator',
  'digitalSourceType',
  'contentHash',
  'contentType',
  'createdAt',
  'agentDid',
  'modelVersion',
  'merkleRoot',
  'hash',
  'signature',
];

/**
 * Compare two manifests and return a list of fields that differ.
 * Compares both scalar fields and structured fields (inputs, assertions, etc.).
 */
export function diffManifests(
  a: ProvenanceManifest,
  b: ProvenanceManifest,
): ManifestDiff {
  const fieldsChanged: ManifestFieldDiff[] = [];

  // Compare scalar fields
  for (const field of DIFF_FIELDS) {
    const va = a[field];
    const vb = b[field];
    if (va !== vb) {
      fieldsChanged.push({ field, oldValue: va, newValue: vb });
    }
  }

  // Compare inputs
  const inputsA = canonicalizeJson(a.inputs);
  const inputsB = canonicalizeJson(b.inputs);
  if (inputsA !== inputsB) {
    fieldsChanged.push({ field: 'inputs', oldValue: a.inputs, newValue: b.inputs });
  }

  // Compare assertions
  const assertionsA = canonicalizeJson(a.assertions);
  const assertionsB = canonicalizeJson(b.assertions);
  if (assertionsA !== assertionsB) {
    fieldsChanged.push({ field: 'assertions', oldValue: a.assertions, newValue: b.assertions });
  }

  // Compare evidence chain
  const evidenceA = canonicalizeJson(a.evidenceChain);
  const evidenceB = canonicalizeJson(b.evidenceChain);
  if (evidenceA !== evidenceB) {
    fieldsChanged.push({ field: 'evidenceChain', oldValue: a.evidenceChain, newValue: b.evidenceChain });
  }

  // Compare transparency pointer
  const tpA = canonicalizeJson(a.transparencyPointer);
  const tpB = canonicalizeJson(b.transparencyPointer);
  if (tpA !== tpB) {
    fieldsChanged.push({
      field: 'transparencyPointer',
      oldValue: a.transparencyPointer,
      newValue: b.transparencyPointer,
    });
  }

  return {
    fieldsChanged,
    identical: fieldsChanged.length === 0,
  };
}

// ─── Manifest Summary ───────────────────────────────────────────────────────

/** Generate a human-readable summary of a manifest. */
export function summarizeManifest(manifest: ProvenanceManifest): ManifestSummary {
  const sourceTypeLabels: Record<DigitalSourceType, string> = {
    trainedAlgorithmicMedia: 'AI-generated (trained model)',
    compositeWithTrainedAlgorithmicMedia: 'Composite with AI-generated content',
    algorithmicMedia: 'Algorithmically generated',
    humanCreated: 'Human-created',
    composite: 'Composite',
  };

  const sourceLabel = sourceTypeLabels[manifest.digitalSourceType] ?? manifest.digitalSourceType;

  const parts: string[] = [
    `${sourceLabel} content (${manifest.contentType})`,
    `created by ${manifest.agentDid}`,
    `using ${manifest.modelVersion}`,
    `at ${manifest.createdAt}`,
  ];

  if (manifest.inputs.length > 0) {
    parts.push(`with ${manifest.inputs.length} input(s)`);
  }

  if (manifest.assertions.length > 0) {
    parts.push(`and ${manifest.assertions.length} assertion(s)`);
  }

  if (manifest.transparencyPointer) {
    parts.push(`logged to ${manifest.transparencyPointer.logId}`);
  }

  return {
    id: manifest.id,
    agent: manifest.agentDid,
    sourceType: sourceLabel,
    contentType: manifest.contentType,
    createdAt: manifest.createdAt,
    inputCount: manifest.inputs.length,
    assertionCount: manifest.assertions.length,
    hasTransparencyPointer: manifest.transparencyPointer !== null,
    evidenceChainLength: manifest.evidenceChain.length,
    summary: parts.join(', '),
  };
}

/** Compute aggregate statistics across multiple manifests. */
export function manifestStats(manifests: readonly ProvenanceManifest[]): ManifestStats {
  if (manifests.length === 0) {
    return {
      totalManifests: 0,
      uniqueAgents: [],
      sourceTypeDistribution: {},
      contentTypeDistribution: {},
      averageInputCount: 0,
      averageAssertionCount: 0,
      earliestCreatedAt: null,
      latestCreatedAt: null,
      totalAssertionsByType: {},
    };
  }

  const agents = new Set<string>();
  const sourceTypes: Record<string, number> = {};
  const contentTypes: Record<string, number> = {};
  const assertionTypes: Record<string, number> = {};
  let totalInputs = 0;
  let totalAssertions = 0;
  let earliest = manifests[0]!.createdAt;
  let latest = manifests[0]!.createdAt;

  for (const m of manifests) {
    agents.add(m.agentDid);

    sourceTypes[m.digitalSourceType] = (sourceTypes[m.digitalSourceType] ?? 0) + 1;
    contentTypes[m.contentType] = (contentTypes[m.contentType] ?? 0) + 1;

    totalInputs += m.inputs.length;
    totalAssertions += m.assertions.length;

    for (const a of m.assertions) {
      assertionTypes[a.type] = (assertionTypes[a.type] ?? 0) + 1;
    }

    if (m.createdAt < earliest) earliest = m.createdAt;
    if (m.createdAt > latest) latest = m.createdAt;
  }

  return {
    totalManifests: manifests.length,
    uniqueAgents: [...agents].sort(),
    sourceTypeDistribution: sourceTypes,
    contentTypeDistribution: contentTypes,
    averageInputCount: totalInputs / manifests.length,
    averageAssertionCount: totalAssertions / manifests.length,
    earliestCreatedAt: earliest,
    latestCreatedAt: latest,
    totalAssertionsByType: assertionTypes,
  };
}

// ─── Claim Generation ───────────────────────────────────────────────────────

/**
 * Generate a C2PA-aligned claim structure from a provenance manifest.
 * Maps manifest fields to the C2PA claim v2 format.
 */
export function generateClaim(manifest: ProvenanceManifest): ClaimV2 {
  // Build assertion references
  const assertionRefs: ClaimAssertionReference[] = manifest.assertions.map((a, i) => ({
    url: `self#jumbf=c2pa.assertions/${a.type}_${i}`,
    hash: sha256String(canonicalizeJson(a)),
  }));

  // Build ingredient list
  const ingredients: ClaimIngredient[] = manifest.inputs.map((input, i) => ({
    title: input.description ?? `Input ${i}`,
    relationship: input.relationship,
    hash: input.contentHash,
    manifestId: input.manifestId,
  }));

  // Content binding
  const contentBindings: ContentBinding[] = [
    {
      algorithm: 'sha256',
      hash: manifest.contentHash,
    },
  ];

  // Add any data hash assertions as additional bindings
  for (const a of manifest.assertions) {
    if (a.type === 'dataHash') {
      contentBindings.push({
        algorithm: a.algorithm,
        hash: a.hash,
      });
    }
  }

  return {
    claimGenerator: manifest.claimGenerator,
    claimGeneratorInfo: [
      { name: 'Nobulex', version: '0.2.0' },
    ],
    dc_title: `Agent output by ${manifest.agentDid}`,
    dc_format: manifest.contentType,
    instanceId: manifest.id,
    signature: manifest.signature,
    assertions: assertionRefs,
    ingredients,
    createdAt: manifest.createdAt,
    contentBindings,
  };
}

// ─── Convenience Helpers ────────────────────────────────────────────────────

/** Create an input reference from an evidence item. */
export function inputFromEvidence(
  item: EvidenceItem,
  relationship: InputReference['relationship'] = 'inputTo',
): InputReference {
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

// ─── Re-exports for consumer convenience ────────────────────────────────────

export type { EvidenceItem } from '@nobulex/evidence-core';
export type { KeyPair, HashHex } from '@nobulex/crypto';
