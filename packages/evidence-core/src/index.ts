/**
 * @nobulex/evidence-core — Signed, hash-chained evidence items recording AI agent actions.
 *
 * An evidence item is a compact, signed record combining: timestamp, agent DID,
 * action type, tool name, input/output hashes, model version, delegation chain,
 * and a hash pointer to the previous item forming an immutable chain.
 *
 * This module provides:
 * - Core creation and verification of evidence items and chains
 * - Chain forking detection between divergent chains
 * - Serialization/deserialization with structural validation
 * - Batch evidence creation for efficient bulk operations
 * - Fluent query API for filtering evidence chains
 * - Detailed chain auditing with per-item error reporting
 * - Chain diffing, statistics, and slicing utilities
 *
 * @packageDocumentation
 */

import {
  sha256String,
  sha256Object,
  canonicalizeJson,
  sign,
  verify,
  fromHex,
  toHex,
  timestamp as nowISO,
  generateId,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single evidence item in the hash chain. */
export interface EvidenceItem {
  /** Content-addressed ID (SHA-256 of canonical fields). */
  readonly id: string;
  /** ISO-8601 timestamp of when the action occurred. */
  readonly timestamp: string;
  /** DID of the agent that performed the action. */
  readonly agentDid: string;
  /** Category of action (e.g. "tool_call", "api_request", "delegation"). */
  readonly actionType: string;
  /** Name of the tool or function invoked. */
  readonly toolName: string;
  /** SHA-256 hash of the action input. */
  readonly inputHash: HashHex;
  /** SHA-256 hash of the action output. */
  readonly outputHash: HashHex;
  /** Model identifier and version (e.g. "claude-opus-4-20250514"). */
  readonly modelVersion: string;
  /** ID of the parent action for delegation chains, or null. */
  readonly parentActionId: string | null;
  /** Hash of the previous evidence item in the chain, or null for the first. */
  readonly previousHash: HashHex | null;
  /** SHA-256 hash of the canonical evidence content. */
  readonly hash: HashHex;
  /** Ed25519 signature over the hash, hex-encoded. */
  readonly signature: string;
}

/** Input for creating a new evidence item (fields the caller provides). */
export interface EvidenceInput {
  readonly agentDid: string;
  readonly actionType: string;
  readonly toolName: string;
  readonly inputHash: HashHex;
  readonly outputHash: HashHex;
  readonly modelVersion: string;
  readonly parentActionId?: string | null;
  readonly timestamp?: string;
}

/** Result of verifying an evidence item's integrity. */
export interface EvidenceVerification {
  readonly valid: boolean;
  readonly checks: readonly EvidenceCheck[];
}

/** A single verification check. */
export interface EvidenceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
}

/** Result of verifying a full evidence chain. */
export interface ChainVerification {
  readonly valid: boolean;
  readonly length: number;
  readonly errors: readonly string[];
}

/** Result of detecting a fork between two chains. */
export interface ForkDetectionResult {
  /** Index at which the two chains diverge (-1 if no fork). */
  readonly forkIndex: number;
  /** The common prefix shared by both chains. */
  readonly commonPrefix: readonly EvidenceItem[];
  /** Items in chain A after the fork point. */
  readonly branchA: readonly EvidenceItem[];
  /** Items in chain B after the fork point. */
  readonly branchB: readonly EvidenceItem[];
}

/** Result of diffing two chains. */
export interface ChainDiffResult {
  /** Items present only in chain A. */
  readonly onlyInA: readonly EvidenceItem[];
  /** Items present only in chain B. */
  readonly onlyInB: readonly EvidenceItem[];
  /** Items present in both chains (by hash). */
  readonly common: readonly EvidenceItem[];
}

/** Statistics about an evidence chain. */
export interface ChainStatistics {
  /** Total number of items in the chain. */
  readonly totalItems: number;
  /** Number of unique agent DIDs. */
  readonly uniqueAgents: number;
  /** Number of unique tool names. */
  readonly uniqueTools: number;
  /** Number of unique action types. */
  readonly uniqueActionTypes: number;
  /** Time span from first to last item in milliseconds, or 0 for empty/single. */
  readonly timeSpan: number;
  /** Average interval between items in milliseconds, or 0 if fewer than 2 items. */
  readonly averageInterval: number;
  /** Size statistics for serialized items. */
  readonly itemSizeStats: {
    readonly min: number;
    readonly max: number;
    readonly average: number;
    readonly total: number;
  };
}

/** Audit status for a single chain entry. */
export interface ChainAuditEntry {
  /** Index of the item in the chain. */
  readonly index: number;
  /** The item's hash. */
  readonly hash: HashHex;
  /** Whether the item's hash integrity check passed. */
  readonly hashValid: boolean;
  /** Whether the item's signature check passed. */
  readonly signatureValid: boolean;
  /** Whether the chain linkage to the previous item is correct. */
  readonly linkageValid: boolean;
  /** List of issues detected for this item. */
  readonly issues: readonly string[];
}

/** Full audit report for an evidence chain. */
export interface ChainAuditReport {
  /** Whether the entire chain is valid (no issues found). */
  readonly valid: boolean;
  /** Total number of items audited. */
  readonly totalItems: number;
  /** Number of items that passed all checks. */
  readonly validItems: number;
  /** Number of items with at least one issue. */
  readonly invalidItems: number;
  /** Per-item audit entries. */
  readonly entries: readonly ChainAuditEntry[];
  /** Indices where gaps in chain linkage were detected. */
  readonly gaps: readonly number[];
  /** Indices of items with duplicate hashes. */
  readonly duplicates: readonly number[];
  /** Indices of items with timing anomalies (non-monotonic timestamps). */
  readonly timingAnomalies: readonly number[];
  /** Human-readable summary of all issues. */
  readonly summary: readonly string[];
}

/** Filter criteria for querying evidence items. */
export interface EvidenceFilter {
  readonly agentDid?: string;
  readonly actionType?: string;
  readonly toolName?: string;
  readonly timeStart?: string;
  readonly timeEnd?: string;
  readonly parentActionId?: string;
  readonly modelVersion?: string;
}

// ─── Core content that gets hashed ──────────────────────────────────────────

interface EvidenceContent {
  readonly timestamp: string;
  readonly agentDid: string;
  readonly actionType: string;
  readonly toolName: string;
  readonly inputHash: HashHex;
  readonly outputHash: HashHex;
  readonly modelVersion: string;
  readonly parentActionId: string | null;
  readonly previousHash: HashHex | null;
}

function extractContent(item: EvidenceItem | EvidenceContent): EvidenceContent {
  return {
    timestamp: item.timestamp,
    agentDid: item.agentDid,
    actionType: item.actionType,
    toolName: item.toolName,
    inputHash: item.inputHash,
    outputHash: item.outputHash,
    modelVersion: item.modelVersion,
    parentActionId: item.parentActionId,
    previousHash: item.previousHash,
  };
}

/** Compute the hash of an evidence item's content. */
export function computeEvidenceHash(content: EvidenceContent): HashHex {
  return sha256String(canonicalizeJson(content));
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds a hash-chained sequence of evidence items.
 * Each item is signed and linked to the previous item via `previousHash`.
 */
export class EvidenceChainBuilder {
  private readonly items: EvidenceItem[] = [];
  private readonly agentDid: string;
  private readonly keyPair: KeyPair;

  constructor(agentDid: string, keyPair: KeyPair) {
    if (!agentDid) throw new Error('agentDid is required');
    this.agentDid = agentDid;
    this.keyPair = keyPair;
  }

  /** Number of items in the chain. */
  get length(): number {
    return this.items.length;
  }

  /** Hash of the most recent item, or null if empty. */
  get headHash(): HashHex | null {
    return this.items.length > 0 ? this.items[this.items.length - 1]!.hash : null;
  }

  /** Append a new evidence item to the chain. */
  async append(input: EvidenceInput): Promise<EvidenceItem> {
    const previousHash = this.headHash;
    const content: EvidenceContent = {
      timestamp: input.timestamp ?? nowISO(),
      agentDid: input.agentDid || this.agentDid,
      actionType: input.actionType,
      toolName: input.toolName,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      modelVersion: input.modelVersion,
      parentActionId: input.parentActionId ?? null,
      previousHash,
    };

    const hash = computeEvidenceHash(content);
    const sigBytes = await sign(
      new TextEncoder().encode(hash),
      this.keyPair.privateKey,
    );

    const item: EvidenceItem = {
      id: sha256Object({ hash, index: this.items.length }),
      ...content,
      hash,
      signature: toHex(sigBytes),
    };

    this.items.push(item);
    return item;
  }

  /**
   * Append multiple evidence items to the chain in sequence.
   * Each item is linked to the previous one. This is more efficient than
   * calling append() in a loop because it avoids repeated promise scheduling.
   */
  async appendBatch(inputs: readonly EvidenceInput[]): Promise<readonly EvidenceItem[]> {
    if (inputs.length === 0) return [];
    const results: EvidenceItem[] = [];
    for (const input of inputs) {
      const item = await this.append(input);
      results.push(item);
    }
    return results;
  }

  /** Get an item by index. */
  get(index: number): EvidenceItem | undefined {
    return this.items[index];
  }

  /** Return all items as a readonly array. */
  entries(): readonly EvidenceItem[] {
    return [...this.items];
  }

  /** Return all item hashes (for feeding into a Merkle tree). */
  hashes(): readonly string[] {
    return this.items.map((i) => i.hash);
  }
}

// ─── Standalone creation ────────────────────────────────────────────────────

/** Create a single signed evidence item (for use outside a chain builder). */
export async function createEvidenceItem(
  input: EvidenceInput,
  previousHash: HashHex | null,
  keyPair: KeyPair,
): Promise<EvidenceItem> {
  const content: EvidenceContent = {
    timestamp: input.timestamp ?? nowISO(),
    agentDid: input.agentDid,
    actionType: input.actionType,
    toolName: input.toolName,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    modelVersion: input.modelVersion,
    parentActionId: input.parentActionId ?? null,
    previousHash,
  };

  const hash = computeEvidenceHash(content);
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

// ─── Batch creation ─────────────────────────────────────────────────────────

/**
 * Create multiple signed evidence items in sequence, each chained to the previous.
 * The first item links to the provided `previousHash` (null for a genesis chain).
 *
 * @param inputs - Array of evidence inputs to create.
 * @param previousHash - Hash to link the first item to, or null.
 * @param keyPair - Key pair for signing all items.
 * @returns Array of created evidence items, in order.
 */
export async function createBatchEvidence(
  inputs: readonly EvidenceInput[],
  previousHash: HashHex | null,
  keyPair: KeyPair,
): Promise<readonly EvidenceItem[]> {
  if (inputs.length === 0) return [];

  const results: EvidenceItem[] = [];
  let prevHash = previousHash;

  for (const input of inputs) {
    const item = await createEvidenceItem(input, prevHash, keyPair);
    results.push(item);
    prevHash = item.hash;
  }

  return results;
}

// ─── Verification ───────────────────────────────────────────────────────────

/** Verify a single evidence item's hash and signature. */
export async function verifyEvidenceItem(
  item: EvidenceItem,
  signerPublicKey: Uint8Array,
): Promise<EvidenceVerification> {
  const checks: EvidenceCheck[] = [];

  // Check hash integrity
  const recomputed = computeEvidenceHash(extractContent(item));
  const hashValid = recomputed === item.hash;
  checks.push({
    name: 'hash_integrity',
    passed: hashValid,
    reason: hashValid ? undefined : 'Recomputed hash does not match item.hash',
  });

  // Check signature
  let sigValid = false;
  try {
    sigValid = await verify(
      new TextEncoder().encode(item.hash),
      fromHex(item.signature),
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

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

/** Verify the integrity of an ordered chain of evidence items. */
export async function verifyEvidenceChain(
  items: readonly EvidenceItem[],
  signerPublicKey: Uint8Array,
): Promise<ChainVerification> {
  const errors: string[] = [];

  if (items.length === 0) {
    return { valid: true, length: 0, errors: [] };
  }

  // First item must have null previousHash
  if (items[0]!.previousHash !== null) {
    errors.push('First item previousHash must be null');
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;

    // Verify hash
    const recomputed = computeEvidenceHash(extractContent(item));
    if (recomputed !== item.hash) {
      errors.push(`Item ${i}: hash mismatch`);
    }

    // Verify signature
    try {
      const valid = await verify(
        new TextEncoder().encode(item.hash),
        fromHex(item.signature),
        signerPublicKey,
      );
      if (!valid) errors.push(`Item ${i}: invalid signature`);
    } catch {
      errors.push(`Item ${i}: signature verification error`);
    }

    // Verify chain linkage
    if (i > 0 && item.previousHash !== items[i - 1]!.hash) {
      errors.push(`Item ${i}: previousHash does not match prior item hash`);
    }

    // Verify non-decreasing timestamps
    if (i > 0 && item.timestamp < items[i - 1]!.timestamp) {
      errors.push(`Item ${i}: timestamp precedes previous item`);
    }
  }

  return { valid: errors.length === 0, length: items.length, errors };
}

// ─── Chain auditing ─────────────────────────────────────────────────────────

/**
 * Perform a comprehensive audit of an evidence chain, returning detailed
 * per-item results including gap detection, duplicate detection, and
 * timing anomaly detection.
 *
 * @param items - The evidence chain to audit.
 * @param publicKey - The expected signer's public key.
 * @returns A full audit report with per-item entries and aggregate findings.
 */
export async function auditChain(
  items: readonly EvidenceItem[],
  publicKey: Uint8Array,
): Promise<ChainAuditReport> {
  if (items.length === 0) {
    return {
      valid: true,
      totalItems: 0,
      validItems: 0,
      invalidItems: 0,
      entries: [],
      gaps: [],
      duplicates: [],
      timingAnomalies: [],
      summary: [],
    };
  }

  const entries: ChainAuditEntry[] = [];
  const gaps: number[] = [];
  const duplicates: number[] = [];
  const timingAnomalies: number[] = [];
  const summary: string[] = [];
  const seenHashes = new Map<string, number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const issues: string[] = [];

    // Hash integrity
    const recomputed = computeEvidenceHash(extractContent(item));
    const hashValid = recomputed === item.hash;
    if (!hashValid) {
      issues.push(`Hash mismatch: expected ${recomputed}, got ${item.hash}`);
    }

    // Signature verification
    let signatureValid = false;
    try {
      signatureValid = await verify(
        new TextEncoder().encode(item.hash),
        fromHex(item.signature),
        publicKey,
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      issues.push('Signature verification failed');
    }

    // Chain linkage
    let linkageValid = true;
    if (i === 0) {
      if (item.previousHash !== null) {
        linkageValid = false;
        issues.push('First item must have null previousHash');
      }
    } else {
      if (item.previousHash !== items[i - 1]!.hash) {
        linkageValid = false;
        gaps.push(i);
        issues.push(
          `Chain linkage broken: previousHash ${item.previousHash} does not match prior item hash ${items[i - 1]!.hash}`,
        );
      }
    }

    // Duplicate detection
    const prevSeen = seenHashes.get(item.hash);
    if (prevSeen !== undefined) {
      duplicates.push(i);
      issues.push(`Duplicate hash found (first seen at index ${prevSeen})`);
    }
    seenHashes.set(item.hash, i);

    // Timing anomaly detection
    if (i > 0) {
      const prevTime = new Date(items[i - 1]!.timestamp).getTime();
      const currTime = new Date(item.timestamp).getTime();
      if (currTime < prevTime) {
        timingAnomalies.push(i);
        issues.push(
          `Timestamp anomaly: ${item.timestamp} precedes previous item ${items[i - 1]!.timestamp}`,
        );
      }
    }

    entries.push({
      index: i,
      hash: item.hash,
      hashValid,
      signatureValid,
      linkageValid,
      issues,
    });
  }

  // Build summary
  const invalidCount = entries.filter((e) => e.issues.length > 0).length;
  if (invalidCount > 0) {
    summary.push(`${invalidCount} of ${items.length} items have issues`);
  }
  if (gaps.length > 0) {
    summary.push(`Chain linkage gaps detected at indices: ${gaps.join(', ')}`);
  }
  if (duplicates.length > 0) {
    summary.push(`Duplicate hashes detected at indices: ${duplicates.join(', ')}`);
  }
  if (timingAnomalies.length > 0) {
    summary.push(`Timing anomalies detected at indices: ${timingAnomalies.join(', ')}`);
  }

  const valid = invalidCount === 0;
  if (valid) {
    summary.push(`All ${items.length} items passed audit`);
  }

  return {
    valid,
    totalItems: items.length,
    validItems: items.length - invalidCount,
    invalidItems: invalidCount,
    entries,
    gaps,
    duplicates,
    timingAnomalies,
    summary,
  };
}

// ─── Serialization / Deserialization ────────────────────────────────────────

/** Required fields for a valid serialized EvidenceItem. */
const EVIDENCE_ITEM_FIELDS: readonly string[] = [
  'id',
  'timestamp',
  'agentDid',
  'actionType',
  'toolName',
  'inputHash',
  'outputHash',
  'modelVersion',
  'parentActionId',
  'previousHash',
  'hash',
  'signature',
];

/**
 * Validate that a parsed object has the shape of an EvidenceItem.
 * Throws an error with a descriptive message if validation fails.
 */
function validateItemShape(obj: unknown, context: string): asserts obj is EvidenceItem {
  if (obj === null || typeof obj !== 'object') {
    throw new Error(`${context}: expected an object, got ${typeof obj}`);
  }

  const record = obj as Record<string, unknown>;
  for (const field of EVIDENCE_ITEM_FIELDS) {
    if (!(field in record)) {
      throw new Error(`${context}: missing required field "${field}"`);
    }
  }

  // Type-check string fields
  const stringFields = [
    'id', 'timestamp', 'agentDid', 'actionType', 'toolName',
    'inputHash', 'outputHash', 'modelVersion', 'hash', 'signature',
  ];
  for (const field of stringFields) {
    if (typeof record[field] !== 'string') {
      throw new Error(`${context}: field "${field}" must be a string, got ${typeof record[field]}`);
    }
  }

  // parentActionId and previousHash can be string or null
  if (record['parentActionId'] !== null && typeof record['parentActionId'] !== 'string') {
    throw new Error(
      `${context}: field "parentActionId" must be a string or null`,
    );
  }
  if (record['previousHash'] !== null && typeof record['previousHash'] !== 'string') {
    throw new Error(
      `${context}: field "previousHash" must be a string or null`,
    );
  }
}

/**
 * Serialize a single evidence item to a canonical JSON string.
 * Uses deterministic key ordering for reproducible output.
 */
export function serializeItem(item: EvidenceItem): string {
  return canonicalizeJson(item);
}

/**
 * Deserialize a JSON string into an EvidenceItem with structural validation.
 * Throws if the JSON is malformed or missing required fields.
 */
export function deserializeItem(json: string): EvidenceItem {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Failed to parse evidence item JSON: ${(err as Error).message}`);
  }
  validateItemShape(parsed, 'Evidence item');
  return parsed;
}

/**
 * Serialize an array of evidence items to a canonical JSON string.
 * Each item is serialized with deterministic key ordering.
 */
export function serializeChain(items: readonly EvidenceItem[]): string {
  return canonicalizeJson(items);
}

/**
 * Deserialize a JSON string into an array of EvidenceItems with structural validation.
 * Validates each item in the array individually.
 * Throws if the JSON is malformed, not an array, or any item is invalid.
 */
export function deserializeChain(json: string): readonly EvidenceItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Failed to parse evidence chain JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Evidence chain must be a JSON array');
  }

  for (let i = 0; i < parsed.length; i++) {
    validateItemShape(parsed[i], `Evidence chain item[${i}]`);
  }

  return parsed as EvidenceItem[];
}

// ─── Chain forking detection ────────────────────────────────────────────────

/**
 * Detect the fork point between two evidence chains that may share a common prefix.
 *
 * Compares chains item-by-item by hash. The fork index is the first index
 * where the two chains diverge. If one chain is a prefix of the other, the
 * fork index is at the end of the shorter chain.
 *
 * @param chainA - The first evidence chain.
 * @param chainB - The second evidence chain.
 * @returns A ForkDetectionResult describing the divergence.
 */
export function detectFork(
  chainA: readonly EvidenceItem[],
  chainB: readonly EvidenceItem[],
): ForkDetectionResult {
  const minLength = Math.min(chainA.length, chainB.length);
  let forkIndex = -1;

  // Find the first point of divergence
  for (let i = 0; i < minLength; i++) {
    if (chainA[i]!.hash !== chainB[i]!.hash) {
      forkIndex = i;
      break;
    }
  }

  // If all compared items match, check if chains have different lengths
  if (forkIndex === -1) {
    if (chainA.length === chainB.length) {
      // Identical chains -- no fork
      return {
        forkIndex: -1,
        commonPrefix: [...chainA],
        branchA: [],
        branchB: [],
      };
    }
    // One is a prefix of the other
    forkIndex = minLength;
  }

  return {
    forkIndex,
    commonPrefix: chainA.slice(0, forkIndex),
    branchA: chainA.slice(forkIndex),
    branchB: chainB.slice(forkIndex),
  };
}

// ─── Chain diff ─────────────────────────────────────────────────────────────

/**
 * Compute the difference between two evidence chains based on item hashes.
 *
 * @param a - The first evidence chain.
 * @param b - The second evidence chain.
 * @returns Items only in A, only in B, and common to both.
 */
export function diffChains(
  a: readonly EvidenceItem[],
  b: readonly EvidenceItem[],
): ChainDiffResult {
  const hashesA = new Set(a.map((item) => item.hash));
  const hashesB = new Set(b.map((item) => item.hash));

  const onlyInA: EvidenceItem[] = [];
  const common: EvidenceItem[] = [];

  for (const item of a) {
    if (hashesB.has(item.hash)) {
      common.push(item);
    } else {
      onlyInA.push(item);
    }
  }

  const onlyInB: EvidenceItem[] = [];
  for (const item of b) {
    if (!hashesA.has(item.hash)) {
      onlyInB.push(item);
    }
  }

  return { onlyInA, onlyInB, common };
}

// ─── Querying ───────────────────────────────────────────────────────────────

/**
 * Fluent query builder for filtering evidence items.
 *
 * @example
 * ```typescript
 * const results = new EvidenceQuery()
 *   .byAgent('did:nobulex:agent1')
 *   .byActionType('tool_call')
 *   .byTimeRange('2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z')
 *   .execute(items);
 * ```
 */
export class EvidenceQuery {
  private filters: Array<(item: EvidenceItem) => boolean> = [];

  /** Filter by agent DID. */
  byAgent(did: string): this {
    this.filters.push((item) => item.agentDid === did);
    return this;
  }

  /** Filter by action type. */
  byActionType(type: string): this {
    this.filters.push((item) => item.actionType === type);
    return this;
  }

  /** Filter by tool name. */
  byToolName(name: string): this {
    this.filters.push((item) => item.toolName === name);
    return this;
  }

  /** Filter by time range (inclusive). Both start and end are ISO-8601 strings. */
  byTimeRange(start: string, end: string): this {
    this.filters.push((item) => item.timestamp >= start && item.timestamp <= end);
    return this;
  }

  /** Filter by parent action ID. */
  byParentAction(id: string): this {
    this.filters.push((item) => item.parentActionId === id);
    return this;
  }

  /** Filter by model version. */
  byModel(version: string): this {
    this.filters.push((item) => item.modelVersion === version);
    return this;
  }

  /**
   * Execute the query against a collection of evidence items.
   * Returns items that match ALL applied filters (logical AND).
   */
  execute(items: readonly EvidenceItem[]): readonly EvidenceItem[] {
    return items.filter((item) => this.filters.every((f) => f(item)));
  }
}

/**
 * Standalone query function for filtering evidence items by a filter object.
 *
 * @param items - The evidence items to filter.
 * @param filter - Filter criteria to apply.
 * @returns Items matching all specified filter criteria.
 */
export function queryChain(
  items: readonly EvidenceItem[],
  filter: EvidenceFilter,
): readonly EvidenceItem[] {
  let query = new EvidenceQuery();

  if (filter.agentDid !== undefined) {
    query = query.byAgent(filter.agentDid);
  }
  if (filter.actionType !== undefined) {
    query = query.byActionType(filter.actionType);
  }
  if (filter.toolName !== undefined) {
    query = query.byToolName(filter.toolName);
  }
  if (filter.timeStart !== undefined && filter.timeEnd !== undefined) {
    query = query.byTimeRange(filter.timeStart, filter.timeEnd);
  }
  if (filter.parentActionId !== undefined) {
    query = query.byParentAction(filter.parentActionId);
  }
  if (filter.modelVersion !== undefined) {
    query = query.byModel(filter.modelVersion);
  }

  return query.execute(items);
}

// ─── Chain statistics ───────────────────────────────────────────────────────

/**
 * Compute aggregate statistics for an evidence chain.
 *
 * @param items - The evidence chain to analyze.
 * @returns Statistics including counts, time spans, and size metrics.
 */
export function chainStats(items: readonly EvidenceItem[]): ChainStatistics {
  if (items.length === 0) {
    return {
      totalItems: 0,
      uniqueAgents: 0,
      uniqueTools: 0,
      uniqueActionTypes: 0,
      timeSpan: 0,
      averageInterval: 0,
      itemSizeStats: { min: 0, max: 0, average: 0, total: 0 },
    };
  }

  const agents = new Set<string>();
  const tools = new Set<string>();
  const actionTypes = new Set<string>();
  const sizes: number[] = [];

  for (const item of items) {
    agents.add(item.agentDid);
    tools.add(item.toolName);
    actionTypes.add(item.actionType);
    sizes.push(evidenceItemSize(item));
  }

  // Compute time span
  const timestamps = items.map((item) => new Date(item.timestamp).getTime());
  const firstTime = timestamps[0]!;
  const lastTime = timestamps[timestamps.length - 1]!;
  const timeSpan = items.length > 1 ? lastTime - firstTime : 0;

  // Compute average interval
  let averageInterval = 0;
  if (items.length > 1) {
    let totalInterval = 0;
    for (let i = 1; i < timestamps.length; i++) {
      totalInterval += timestamps[i]! - timestamps[i - 1]!;
    }
    averageInterval = totalInterval / (timestamps.length - 1);
  }

  // Compute size stats
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const totalSize = sizes.reduce((sum, s) => sum + s, 0);
  const avgSize = totalSize / sizes.length;

  return {
    totalItems: items.length,
    uniqueAgents: agents.size,
    uniqueTools: tools.size,
    uniqueActionTypes: actionTypes.size,
    timeSpan,
    averageInterval,
    itemSizeStats: {
      min: minSize,
      max: maxSize,
      average: avgSize,
      total: totalSize,
    },
  };
}

// ─── Chain slicing ──────────────────────────────────────────────────────────

/**
 * Slice a chain from `start` (inclusive) to `end` (exclusive) with validation.
 * Throws if indices are out of bounds or start > end.
 *
 * @param items - The evidence chain to slice.
 * @param start - Start index (inclusive, default 0).
 * @param end - End index (exclusive, default items.length).
 * @returns The sliced sub-array of evidence items.
 */
export function sliceChain(
  items: readonly EvidenceItem[],
  start: number = 0,
  end: number = items.length,
): readonly EvidenceItem[] {
  if (start < 0) {
    throw new Error(`sliceChain: start index ${start} is negative`);
  }
  if (end > items.length) {
    throw new Error(
      `sliceChain: end index ${end} exceeds chain length ${items.length}`,
    );
  }
  if (start > end) {
    throw new Error(
      `sliceChain: start index ${start} exceeds end index ${end}`,
    );
  }
  return items.slice(start, end);
}

/**
 * Return the first N items from a chain.
 * If N exceeds the chain length, returns the entire chain.
 *
 * @param items - The evidence chain.
 * @param n - Number of items to take from the head.
 * @returns The first N items.
 */
export function headN(
  items: readonly EvidenceItem[],
  n: number,
): readonly EvidenceItem[] {
  if (n < 0) {
    throw new Error(`headN: n must be non-negative, got ${n}`);
  }
  return items.slice(0, Math.min(n, items.length));
}

/**
 * Return the last N items from a chain.
 * If N exceeds the chain length, returns the entire chain.
 *
 * @param items - The evidence chain.
 * @param n - Number of items to take from the tail.
 * @returns The last N items.
 */
export function tailN(
  items: readonly EvidenceItem[],
  n: number,
): readonly EvidenceItem[] {
  if (n < 0) {
    throw new Error(`tailN: n must be non-negative, got ${n}`);
  }
  if (n >= items.length) return [...items];
  return items.slice(items.length - n);
}

// ─── Size utility ───────────────────────────────────────────────────────────

/** Compute the size in bytes of a serialized evidence item. */
export function evidenceItemSize(item: EvidenceItem): number {
  return new TextEncoder().encode(canonicalizeJson(item)).length;
}
