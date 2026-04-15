/*
 * Merkle tree implementation with domain separation.
 * Leaves: SHA-256(0x00 || data), inner: SHA-256(0x01 || left || right)
 * Also supports epoch batching, multi-proofs, sparse trees, and diffs.
 */

import { sha256, sha256String } from '@nobulex/crypto';


export type ProofDirection = 'left' | 'right';

/** A single node in an inclusion proof. */
export interface MerkleProofNode {
  readonly hash: string;
  readonly direction: ProofDirection;
}

// An inclusion proof for a leaf in the tree
export interface InclusionProof {
  readonly leafIndex: number;
  readonly leafHash: string;
  readonly proof: readonly MerkleProofNode[];
  readonly root: string;
}

/** A complete Merkle tree with all layers. */
export interface MerkleTree {
  readonly root: string;
  readonly leaves: readonly string[];
  readonly layers: readonly (readonly string[])[];
  readonly leafCount: number;
}

/** An epoch: a time-bounded batch of evidence hashes. */
export interface Epoch {
  readonly index: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly merkleRoot: string;
  readonly leafCount: number;
  readonly previousEpochRoot: string | null;
  /** SHA-256(previousEpochRoot || merkleRoot) — chains epochs together. */
  readonly chainedRoot: string;
}

/** Configuration for the epoch aggregator. */
export interface EpochConfig {
  /** Maximum number of items per epoch before auto-sealing. */
  readonly maxItems?: number;
  // Maximum epoch duration in milliseconds before auto-sealing
  readonly maxDurationMs?: number;
}

export interface MultiProof {
  readonly leafIndices: readonly number[];
  readonly leafHashes: readonly string[];
  // Deduplicated set of sibling hashes needed to recompute the root
  readonly proofHashes: readonly string[];
  /**
   * Flags array: for each step in the reconstruction, true means
   * the next hash comes from proofHashes, false means it comes from
   * a previously computed intermediate.
   */
  readonly flags: readonly boolean[];
  readonly root: string;
  readonly leafCount: number;
}

/** An audit path from a leaf to the root. */
export interface AuditPath {
  readonly leafIndex: number;
  readonly leafHash: string;
  readonly path: readonly AuditPathNode[];
  readonly root: string;
}

/** A single node in an audit path. */
export interface AuditPathNode {
  readonly hash: string;
  readonly direction: ProofDirection;
  readonly depth: number;
}

/** Result of diffing two Merkle trees. */
export interface TreeDiff {
  readonly added: readonly number[];
  readonly removed: readonly number[];
  readonly changed: readonly number[];
}

// Configuration for EpochManager
export interface EpochManagerConfig extends EpochConfig {
  /** If true, automatically seal epochs when maxDurationMs elapses. */
  readonly autoSeal?: boolean;
}

// ---

const LEAF_PREFIX = new Uint8Array([0x00]);
const INNER_PREFIX = new Uint8Array([0x01]);

/** Hash a leaf value with domain separation (0x00 || data). */
export function hashLeaf(data: string): string {
  // historical: used to be async, keeping signature for compatibility
  const dataBytes = new TextEncoder().encode(data);
  const prefixed = new Uint8Array(1 + dataBytes.length);
  prefixed.set(LEAF_PREFIX);
  prefixed.set(dataBytes, 1);
  return sha256(prefixed);
}

/** Hash two child nodes with domain separation (0x01 || left || right). */
export function hashInner(left: string, right: string): string {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const prefixed = new Uint8Array(1 + leftBytes.length + rightBytes.length);
  prefixed.set(INNER_PREFIX);
  prefixed.set(leftBytes, 1);
  prefixed.set(rightBytes, 1 + leftBytes.length);
  return sha256(prefixed);
}

// ---

/**
 * Build a Merkle tree from an array of data strings (typically hashes).
 * Returns the complete tree with all layers and the root.
 *
 * Empty input returns root = SHA-256(0x00 || "empty").
 * Single leaf returns that leaf's hash as the root.
 * Odd layers duplicate the last node.
 */
export function buildMerkleTree(data: readonly string[]): MerkleTree {
  if (data.length === 0) {
    const emptyRoot = hashLeaf('empty');
    return { root: emptyRoot, leaves: [], layers: [[emptyRoot]], leafCount: 0 };
  }

  const leaves = data.map(hashLeaf);
  return buildTreeFromLeafHashes(leaves, data.length);
}

/**
 * Build a Merkle tree from pre-computed leaf hashes, skipping leaf hashing.
 * Useful when you already have hashed data.
 */
export function buildMerkleTreeFromHashes(hashes: readonly string[]): MerkleTree {
  if (hashes.length === 0) {
    const emptyRoot = hashLeaf('empty');
    return { root: emptyRoot, leaves: [], layers: [[emptyRoot]], leafCount: 0 };
  }

  return buildTreeFromLeafHashes([...hashes], hashes.length);
}

// Internal: build tree layers from an array of leaf hashes
function buildTreeFromLeafHashes(leaves: string[], originalCount: number): MerkleTree {
  const layers: string[][] = [leaves];

  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1] ?? left;
      next.push(hashInner(left, right));
    }
    layers.push(next);
    current = next;
  }

  return {
    root: current[0]!,
    leaves,
    layers,
    leafCount: originalCount,
  };
}

/**
 * Append new leaves to an existing tree, returning a new tree.
 * This rebuilds the tree with the combined leaf set.
 */
export function appendLeaves(tree: MerkleTree, newLeaves: readonly string[]): MerkleTree {
  if (newLeaves.length === 0) return tree;

  const newLeafHashes = newLeaves.map(hashLeaf);
  const allLeaves = [...tree.leaves, ...newLeafHashes];
  return buildTreeFromLeafHashes(allLeaves, allLeaves.length);
}

// ---

/**
 * Generate an inclusion proof for a leaf at the given index.
 * Proof size is O(log N).
 */
export function generateInclusionProof(
  tree: MerkleTree,
  leafIndex: number,
): InclusionProof {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(`Leaf index ${leafIndex} out of range [0, ${tree.leafCount})`);
  }

  const proof: MerkleProofNode[] = [];
  let idx = leafIndex;

  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer]!;
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    const siblingHash = currentLayer[siblingIdx] ?? currentLayer[idx]!;

    proof.push({
      hash: siblingHash,
      direction: isLeft ? 'right' : 'left',
    });

    idx = Math.floor(idx / 2);
  }

  return {
    leafIndex,
    leafHash: tree.leaves[leafIndex]!,
    proof,
    root: tree.root,
  };
}

/**
 * Verify an inclusion proof against a claimed root.
 * Returns true if the proof is valid.
 */
export function verifyInclusionProof(proof: InclusionProof): boolean {
  let current = proof.leafHash;

  for (const node of proof.proof) {
    if (node.direction === 'right') {
      current = hashInner(current, node.hash);
    } else {
      current = hashInner(node.hash, current);
    }
  }

  return current === proof.root;
}

// multi-proof support

/**
 * Generate a multi-proof for multiple leaf indices simultaneously.
 * Shared internal nodes are deduplicated, making the combined proof
 * smaller than individual proofs concatenated.
 *
 * Uses a bottom-up approach: at each layer, track which nodes are
 * "known" (computable from leaves/intermediates) and which siblings
 * must be included as proof hashes.
 */
export function generateMultiProof(
  tree: MerkleTree,
  leafIndices: readonly number[],
): MultiProof {
  if (leafIndices.length === 0) {
    throw new Error('At least one leaf index is required');
  }

  const uniqueIndices = [...new Set(leafIndices)].sort((a, b) => a - b);

  for (const idx of uniqueIndices) {
    if (idx < 0 || idx >= tree.leafCount) {
      throw new Error(`Leaf index ${idx} out of range [0, ${tree.leafCount})`);
    }
  }

  const leafHashes = uniqueIndices.map((i) => tree.leaves[i]!);

  // Track which indices at each layer are "known" (derivable).
  // Start with the requested leaf indices.
  let knownIndices = new Set(uniqueIndices);
  const proofHashes: string[] = [];
  const flags: boolean[] = [];

  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer]!;
    const nextKnown = new Set<number>();

    // Process pairs. For each known index, determine its sibling.
    const processed = new Set<number>();

    // Sort known indices for deterministic processing
    const sortedKnown = [...knownIndices].sort((a, b) => a - b);

    for (const idx of sortedKnown) {
      const pairBase = idx - (idx % 2); // start of the pair
      if (processed.has(pairBase)) continue;
      processed.add(pairBase);

      const leftIdx = pairBase;
      const rightIdx = pairBase + 1;
      const parentIdx = Math.floor(pairBase / 2);
      nextKnown.add(parentIdx);

      const leftKnown = knownIndices.has(leftIdx);
      const rightKnown = knownIndices.has(rightIdx) ||
        rightIdx >= currentLayer.length; // odd duplication

      if (leftKnown && rightKnown) {
        // Both sides are known, no proof hash needed.
        // Flag: false for left (known), false for right (known).
        flags.push(false, false);
      } else if (leftKnown) {
        // Need right sibling from proof.
        flags.push(false, true);
        proofHashes.push(currentLayer[rightIdx] ?? currentLayer[leftIdx]!);
      } else {
        // Need left sibling from proof.
        flags.push(true, false);
        proofHashes.push(currentLayer[leftIdx]!);
      }
    }

    knownIndices = nextKnown;
  }

  return {
    leafIndices: uniqueIndices,
    leafHashes,
    proofHashes,
    flags,
    root: tree.root,
    leafCount: tree.leafCount,
  };
}

/**
 * Verify a multi-proof by recomputing the root from the provided
 * leaf hashes and proof hashes according to the flags.
 */
export function verifyMultiProof(proof: MultiProof): boolean {
  if (proof.leafIndices.length === 0) return false;

  // Rebuild the tree layers from what we know.
  let knownNodes = new Map<number, string>();
  for (let i = 0; i < proof.leafIndices.length; i++) {
    knownNodes.set(proof.leafIndices[i]!, proof.leafHashes[i]!);
  }

  // Determine how many layers the tree has.
  let layerSize = proof.leafCount;
  const layerSizes: number[] = [layerSize];
  while (layerSize > 1) {
    layerSize = Math.ceil(layerSize / 2);
    layerSizes.push(layerSize);
  }

  let proofIdx = 0;
  let flagIdx = 0;

  for (let layer = 0; layer < layerSizes.length - 1; layer++) {
    const currentLayerSize = layerSizes[layer]!;
    const nextKnown = new Map<number, string>();
    const processed = new Set<number>();

    const sortedKnown = [...knownNodes.keys()].sort((a, b) => a - b);

    for (const idx of sortedKnown) {
      const pairBase = idx - (idx % 2);
      if (processed.has(pairBase)) continue;
      processed.add(pairBase);

      const leftIdx = pairBase;
      const rightIdx = pairBase + 1;
      const parentIdx = Math.floor(pairBase / 2);

      if (flagIdx + 1 >= proof.flags.length && knownNodes.size === 1) {
        // Last node, just propagate.
        const val = knownNodes.get(idx);
        if (val !== undefined) nextKnown.set(parentIdx, val);
        continue;
      }

      if (flagIdx + 1 > proof.flags.length) break;

      const leftFlag = proof.flags[flagIdx]!;
      const rightFlag = proof.flags[flagIdx + 1]!;
      flagIdx += 2;

      let leftHash: string;
      let rightHash: string;

      if (!leftFlag && !rightFlag) {
        // Both known
        leftHash = knownNodes.get(leftIdx)!;
        rightHash = rightIdx >= currentLayerSize
          ? leftHash
          : (knownNodes.get(rightIdx) ?? leftHash);
      } else if (!leftFlag && rightFlag) {
        // Left known, right from proof
        leftHash = knownNodes.get(leftIdx)!;
        if (proofIdx >= proof.proofHashes.length) return false;
        rightHash = proof.proofHashes[proofIdx]!;
        proofIdx++;
      } else if (leftFlag && !rightFlag) {
        // Left from proof, right known
        if (proofIdx >= proof.proofHashes.length) return false;
        leftHash = proof.proofHashes[proofIdx]!;
        proofIdx++;
        rightHash = knownNodes.get(rightIdx)!;
      } else {
        return false; // Both from proof shouldn't happen
      }

      if (!leftHash || !rightHash) return false;
      nextKnown.set(parentIdx, hashInner(leftHash, rightHash));
    }

    knownNodes = nextKnown;
  }

  // Should have exactly one node left: the root.
  if (knownNodes.size !== 1) return false;
  const computedRoot = knownNodes.get(0);
  return computedRoot === proof.root;
}



/**
 * Get the full audit path from a leaf to the root.
 * Each node in the path includes depth information.
 */
export function getAuditPath(tree: MerkleTree, leafIndex: number): AuditPath {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(`Leaf index ${leafIndex} out of range [0, ${tree.leafCount})`);
  }

  const path: AuditPathNode[] = [];
  let idx = leafIndex;

  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer]!;
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    const siblingHash = currentLayer[siblingIdx] ?? currentLayer[idx]!;

    path.push({
      hash: siblingHash,
      direction: isLeft ? 'right' : 'left',
      depth: tree.layers.length - 1 - layer,
    });

    idx = Math.floor(idx / 2);
  }

  return {
    leafIndex,
    leafHash: tree.leaves[leafIndex]!,
    path,
    root: tree.root,
  };
}

/**
 * Verify an audit path by recomputing from leaf to root.
 */
export function verifyAuditPath(auditPath: AuditPath): boolean {
  let current = auditPath.leafHash;

  for (const node of auditPath.path) {
    if (node.direction === 'right') {
      current = hashInner(current, node.hash);
    } else {
      current = hashInner(node.hash, current);
    }
  }

  return current === auditPath.root;
}

// ---

const PROOF_SERIALIZATION_VERSION = 1;
const TREE_SERIALIZATION_VERSION = 1;

// Serialize an InclusionProof to a JSON string
export function serializeProof(proof: InclusionProof): string {
  return JSON.stringify({
    v: PROOF_SERIALIZATION_VERSION,
    type: 'inclusion',
    leafIndex: proof.leafIndex,
    leafHash: proof.leafHash,
    proof: proof.proof.map((n) => ({
      h: n.hash,
      d: n.direction === 'left' ? 'l' : 'r',
    })),
    root: proof.root,
  });
}

// Deserialize a JSON string to an InclusionProof
export function deserializeProof(json: string): InclusionProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON in proof deserialization');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Proof must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.v !== PROOF_SERIALIZATION_VERSION) {
    throw new Error(`Unsupported proof version: ${obj.v}`);
  }

  if (obj.type !== 'inclusion') {
    throw new Error(`Unsupported proof type: ${obj.type}`);
  }

  if (typeof obj.leafIndex !== 'number' || !Number.isInteger(obj.leafIndex) || obj.leafIndex < 0) {
    throw new Error('Invalid leafIndex');
  }

  if (typeof obj.leafHash !== 'string' || obj.leafHash.length === 0) {
    throw new Error('Invalid leafHash');
  }

  if (typeof obj.root !== 'string' || obj.root.length === 0) {
    throw new Error('Invalid root');
  }

  if (!Array.isArray(obj.proof)) {
    throw new Error('Invalid proof array');
  }

  const proof: MerkleProofNode[] = (obj.proof as Array<Record<string, unknown>>).map(
    (node, i) => {
      if (typeof node.h !== 'string' || node.h.length === 0) {
        throw new Error(`Invalid hash in proof node ${i}`);
      }
      if (node.d !== 'l' && node.d !== 'r') {
        throw new Error(`Invalid direction in proof node ${i}`);
      }
      return {
        hash: node.h,
        direction: (node.d === 'l' ? 'left' : 'right') as ProofDirection,
      };
    },
  );

  return {
    leafIndex: obj.leafIndex as number,
    leafHash: obj.leafHash as string,
    proof,
    root: obj.root as string,
  };
}

/** Serialize a MerkleTree to a JSON string. */
export function serializeTree(tree: MerkleTree): string {
  return JSON.stringify({
    v: TREE_SERIALIZATION_VERSION,
    root: tree.root,
    leaves: tree.leaves,
    layers: tree.layers,
    leafCount: tree.leafCount,
  });
}

/** Deserialize a JSON string to a MerkleTree. Validates structure. */
export function deserializeTree(json: string): MerkleTree {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON in tree deserialization');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Tree must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.v !== TREE_SERIALIZATION_VERSION) {
    throw new Error(`Unsupported tree version: ${obj.v}`);
  }

  if (typeof obj.root !== 'string' || obj.root.length === 0) {
    throw new Error('Invalid root');
  }

  if (!Array.isArray(obj.leaves)) {
    throw new Error('Invalid leaves array');
  }

  for (let i = 0; i < obj.leaves.length; i++) {
    if (typeof (obj.leaves as unknown[])[i] !== 'string') {
      throw new Error(`Invalid leaf at index ${i}`);
    }
  }

  if (!Array.isArray(obj.layers)) {
    // note: order matters — tests rely on this
    throw new Error('Invalid layers array');
  }

  for (let i = 0; i < (obj.layers as unknown[]).length; i++) {
    const layer = (obj.layers as unknown[])[i];
    if (!Array.isArray(layer)) {
      throw new Error(`Invalid layer at index ${i}`);
    }
    for (let j = 0; j < (layer as unknown[]).length; j++) {
      if (typeof (layer as unknown[])[j] !== 'string') {
        throw new Error(`Invalid hash in layer ${i} at index ${j}`);
      }
    }
  }

  if (typeof obj.leafCount !== 'number' || !Number.isInteger(obj.leafCount) || obj.leafCount < 0) {
    throw new Error('Invalid leafCount');
  }

  // Validate consistency
  if (obj.leafCount !== (obj.leaves as unknown[]).length) {
    throw new Error('leafCount does not match leaves array length');
  }

  const layers = obj.layers as string[][];
  if (layers.length > 0 && layers[layers.length - 1]!.length !== 1) {
    throw new Error('Top layer must have exactly one element (root)');
  }

  if (layers.length > 0 && layers[layers.length - 1]![0] !== obj.root) {
    throw new Error('Root does not match top layer');
  }

  return {
    root: obj.root as string,
    leaves: obj.leaves as string[],
    layers: layers,
    leafCount: obj.leafCount as number,
  };
}


/**
 * Diff two Merkle trees, returning indices of added, removed, and changed leaves.
 * Compares leaf hashes at each position.
 */
export function diffTrees(a: MerkleTree, b: MerkleTree): TreeDiff {
  const added: number[] = [];
  const removed: number[] = [];
  const changed: number[] = [];

  const maxLen = Math.max(a.leaves.length, b.leaves.length);
  const minLen = Math.min(a.leaves.length, b.leaves.length);

  // Compare overlapping range
  for (let i = 0; i < minLen; i++) {
    if (a.leaves[i] !== b.leaves[i]) {
      changed.push(i);
    }
  }

  // Handle size differences
  if (b.leaves.length > a.leaves.length) {
    for (let i = minLen; i < maxLen; i++) {
      added.push(i);
    }
  } else if (a.leaves.length > b.leaves.length) {
    for (let i = minLen; i < maxLen; i++) {
      removed.push(i);
    }
  }

  return { added, removed, changed };
}

// tree visualization

/**
 * Generate ASCII art visualization of a Merkle tree for debugging.
 * Shows root at top, leaves at bottom, with abbreviated hash prefixes.
 */
export function visualizeTree(tree: MerkleTree, hashLen: number = 8): string {
  if (tree.layers.length === 0) return '(empty tree)';

  const lines: string[] = [];
  const totalLayers = tree.layers.length;

  // Render from root (top) down to leaves (bottom).
  for (let layerIdx = totalLayers - 1; layerIdx >= 0; layerIdx--) {
    const layer = tree.layers[layerIdx]!;
    const depth = totalLayers - 1 - layerIdx;
    const label = layerIdx === totalLayers - 1
      ? 'ROOT'
      : layerIdx === 0
        ? 'LEAVES'
        : `L${layerIdx}`;

    const hashes = layer.map((h) => `[${h.substring(0, hashLen)}]`);
    const indent = '  '.repeat(depth);
    lines.push(`${indent}${label}: ${hashes.join('  ')}`);
  }

  return lines.join('\n');
}

// ---

/**
 * Aggregates evidence hashes into time-bounded epochs.
 * Each epoch's chained root incorporates the previous epoch's root,
 * forming a hash chain of epochs.
 */
export class EpochAggregator {
  private readonly config: Required<EpochConfig>;
  private currentItems: string[] = [];
  private epochs: Epoch[] = [];
  private epochStartTime: string | null = null;

  constructor(config: EpochConfig = {}) {
    this.config = {
      maxItems: config.maxItems ?? 1000,
      maxDurationMs: config.maxDurationMs ?? 60_000,
    };
  }

  /** Add a hash (typically an evidence item hash) to the current epoch. */
  add(hash: string): void {
    if (this.epochStartTime === null) {
      this.epochStartTime = new Date().toISOString();
    }
    this.currentItems.push(hash);

    if (this.currentItems.length >= this.config.maxItems) {
      this.seal();
    }
  }

  /** Check if the current epoch should be sealed based on time. */
  shouldSeal(): boolean {
    if (this.epochStartTime === null || this.currentItems.length === 0) return false;
    const elapsed = Date.now() - new Date(this.epochStartTime).getTime();
    return elapsed >= this.config.maxDurationMs || this.currentItems.length >= this.config.maxItems;
  }

  /** Seal the current epoch, producing a Merkle root and chaining to the previous. */
  seal(endTime?: string): Epoch | null {
    if (this.currentItems.length === 0) return null;

    const tree = buildMerkleTree(this.currentItems);
    const previousEpochRoot = this.epochs.length > 0
      ? this.epochs[this.epochs.length - 1]!.chainedRoot
      : null;

    const chainedRoot = previousEpochRoot
      ? hashInner(previousEpochRoot, tree.root)
      : tree.root;

    const epoch: Epoch = {
      index: this.epochs.length,
      startTime: this.epochStartTime ?? new Date().toISOString(),
      endTime: endTime ?? new Date().toISOString(),
      merkleRoot: tree.root,
      leafCount: this.currentItems.length,
      previousEpochRoot,
      chainedRoot,
    };

    this.epochs.push(epoch);
    this.currentItems = [];
    this.epochStartTime = null;

    return epoch;
  }

  /** Get all sealed epochs. */
  getEpochs(): readonly Epoch[] {
    return [...this.epochs];
  }

  // Get the latest sealed epoch
  getLatestEpoch(): Epoch | undefined {
    return this.epochs[this.epochs.length - 1];
  }

  /** Number of items in the current (unsealed) epoch. */
  get pendingCount(): number {
    return this.currentItems.length;
  }

  /** Total sealed epochs. */
  get epochCount(): number {
    return this.epochs.length;
  }
}

/**
 * Verify that a sequence of epochs forms a valid chain.
 * Checks that each epoch's previousEpochRoot matches the prior chainedRoot,
 * and that chainedRoot = hashInner(previousEpochRoot, merkleRoot).
 */
export function verifyEpochChain(
  epochs: readonly Epoch[],
): { valid: boolean; errors: readonly string[] } {
  const errors: string[] = [];

  for (let i = 0; i < epochs.length; i++) {
    const epoch = epochs[i]!;

    if (i === 0) {
      if (epoch.previousEpochRoot !== null) {
        errors.push(`Epoch 0: previousEpochRoot should be null`);
      }
      if (epoch.chainedRoot !== epoch.merkleRoot) {
        errors.push(`Epoch 0: chainedRoot should equal merkleRoot`);
      }
    } else {
      const prev = epochs[i - 1]!;
      if (epoch.previousEpochRoot !== prev.chainedRoot) {
        errors.push(`Epoch ${i}: previousEpochRoot mismatch`);
      }
      const expected = hashInner(epoch.previousEpochRoot!, epoch.merkleRoot);
      if (epoch.chainedRoot !== expected) {
        errors.push(`Epoch ${i}: chainedRoot mismatch`);
      }
    }

    // Verify temporal ordering
    if (i > 0 && epoch.startTime < epochs[i - 1]!.endTime) {
      errors.push(`Epoch ${i}: overlaps with previous epoch`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// epoch manager

/**
 * High-level epoch manager wrapping EpochAggregator with configurable
 * time windows, auto-seal timers, epoch history, and time-based retrieval.
 */
export class EpochManager {
  private readonly aggregator: EpochAggregator;
  private readonly managerConfig: EpochManagerConfig;
  private sealTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: EpochManagerConfig = {}) {
    this.managerConfig = {
      maxItems: config.maxItems ?? 1000,
      maxDurationMs: config.maxDurationMs ?? 60_000,
      autoSeal: config.autoSeal ?? false,
    };
    this.aggregator = new EpochAggregator({
      maxItems: this.managerConfig.maxItems,
      maxDurationMs: this.managerConfig.maxDurationMs,
    });

    if (this.managerConfig.autoSeal && this.managerConfig.maxDurationMs) {
      this.startAutoSeal();
    }
  }

  // Start the auto-seal timer
  private startAutoSeal(): void {
    if (this.sealTimer !== null) return;
    const interval = Math.min(this.managerConfig.maxDurationMs ?? 60_000, 1000);
    this.sealTimer = setInterval(() => {
      if (this.aggregator.shouldSeal()) {
        this.aggregator.seal();
      }
    }, interval);
    // Unref so it doesn't block Node.js from exiting.
    if (typeof this.sealTimer === 'object' && 'unref' in this.sealTimer) {
      (this.sealTimer as NodeJS.Timeout).unref();
    }
  }

  /** Stop the auto-seal timer. */
  destroy(): void {
    if (this.sealTimer !== null) {
      clearInterval(this.sealTimer);
      this.sealTimer = null;
    }
  }

  /** Add a hash to the current epoch. */
  add(hash: string): void {
    this.aggregator.add(hash);
  }

  /** Manually seal the current epoch. */
  seal(endTime?: string): Epoch | null {
    return this.aggregator.seal(endTime);
  }

  /** Get all sealed epochs. */
  getEpochs(): readonly Epoch[] {
    return this.aggregator.getEpochs();
  }

  // Get the latest sealed epoch
  getLatestEpoch(): Epoch | undefined {
    return this.aggregator.getLatestEpoch();
  }

  /** Get an epoch whose time window contains the given timestamp. */
  getEpochByTime(timestamp: string): Epoch | undefined {
    const t = new Date(timestamp).getTime();
    return this.aggregator.getEpochs().find((e) => {
      const start = new Date(e.startTime).getTime();
      const end = new Date(e.endTime).getTime();
      return t >= start && t <= end;
    });
  }

  /**
   * Get all epochs whose time windows overlap with [start, end].
   * Returns epochs sorted by index.
   */
  getEpochRange(start: string, end: string): readonly Epoch[] {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (s > e) {
      throw new Error('Start time must be before or equal to end time');
    }
    return this.aggregator.getEpochs().filter((epoch) => {
      const epochStart = new Date(epoch.startTime).getTime();
      const epochEnd = new Date(epoch.endTime).getTime();
      // Overlaps if epoch starts before range ends AND epoch ends after range starts.
      return epochStart <= e && epochEnd >= s;
    });
  }

  /** Number of items in the current (unsealed) epoch. */
  get pendingCount(): number {
    return this.aggregator.pendingCount;
  }

  // Total sealed epochs
  get epochCount(): number {
    return this.aggregator.epochCount;
  }

  /** Verify the full epoch chain. */
  verifyChain(): { valid: boolean; errors: readonly string[] } {
    return verifyEpochChain(this.aggregator.getEpochs());
  }
}

// sparse merkle tree

/** Proof for a sparse Merkle tree key. Supports membership and non-membership. */
export interface SparseMerkleProof {
  readonly key: string;
  readonly value: string | null;
  readonly siblings: readonly string[];
  readonly root: string;
  /** True if the key exists in the tree. */
  readonly exists: boolean;
}

/** The default hash for an empty node in the sparse tree. */
const SPARSE_DEFAULT_HASHES: string[] = [];

function getSparseDefaultHash(depth: number): string {
  if (SPARSE_DEFAULT_HASHES.length === 0) {
    // Precompute default hashes for each level.
    // Level 0 (leaf) default = hash of empty string.
    SPARSE_DEFAULT_HASHES.push(hashLeaf(''));
  }
  while (SPARSE_DEFAULT_HASHES.length <= depth) {
    const prev = SPARSE_DEFAULT_HASHES[SPARSE_DEFAULT_HASHES.length - 1]!;
    SPARSE_DEFAULT_HASHES.push(hashInner(prev, prev));
  }
  return SPARSE_DEFAULT_HASHES[depth]!;
}

/**
 * A sparse Merkle tree for key-value commitments.
 *
 * Uses a configurable depth (default 32 for practical use; 256 for full
 * SHA-256 key space). Keys are hashed to determine their path in the tree.
 * Empty subtrees use precomputed default hashes, making the tree efficient
 * even with a vast address space.
 *
 * Supports:
 * - insert(key, value): set a value at a key
 * - get(key): retrieve a value
 * - delete(key): remove a key
 * - generateProof(key): membership or non-membership proof
 * - verifyProof(proof): verify a sparse Merkle proof
 */
export class SparseMerkleTree {
  readonly depth: number;
  private nodes: Map<string, string> = new Map();
  private values: Map<string, string> = new Map();

  constructor(depth: number = 32) {
    if (depth < 1 || depth > 256) {
      throw new Error('Depth must be between 1 and 256');
    }
    this.depth = depth;
    // Ensure default hashes are precomputed.
    getSparseDefaultHash(depth);
  }

  /** Get the path bits for a key (hash the key, then take the first `depth` bits). */
  private getPathBits(key: string): boolean[] {
    const keyHash = sha256String(key);
    const bits: boolean[] = [];
    // Convert hex to bits: each hex char = 4 bits.
    for (let i = 0; i < Math.ceil(this.depth / 4); i++) {
      const nibble = parseInt(keyHash[i]!, 16);
      for (let b = 3; b >= 0; b--) {
        if (bits.length >= this.depth) break;
        bits.push(((nibble >> b) & 1) === 1);
      }
    }
    return bits;
  }

  /** Generate a node key for the internal map. */
  private nodeKey(depth: number, path: boolean[]): string {
    let key = `${depth}:`;
    for (let i = 0; i < depth; i++) {
      key += path[i] ? '1' : '0';
    }
    return key;
  }

  // Get the hash at a given position, returning default if absent
  private getNode(depth: number, path: boolean[]): string {
    const key = this.nodeKey(depth, path);
    return this.nodes.get(key) ?? getSparseDefaultHash(this.depth - depth);
  }

  // Set the hash at a given position
  private setNode(depth: number, path: boolean[], hash: string): void {
    const key = this.nodeKey(depth, path);
    const defaultHash = getSparseDefaultHash(this.depth - depth);
    if (hash === defaultHash) {
      this.nodes.delete(key);
    } else {
      this.nodes.set(key, hash);
    }
  }

  /** Recompute hashes from a leaf up to the root. */
  private updatePath(path: boolean[]): void {
    for (let d = this.depth - 1; d >= 0; d--) {
      const leftPath = [...path.slice(0, d), false];
      const rightPath = [...path.slice(0, d), true];
      const left = this.getNode(d + 1, leftPath);
      const right = this.getNode(d + 1, rightPath);
      this.setNode(d, path, hashInner(left, right));
    }
  }

  /** Insert or update a key-value pair. */
  insert(key: string, value: string): void {
    const path = this.getPathBits(key);
    const leafHash = hashLeaf(value);
    this.setNode(this.depth, path, leafHash);
    this.values.set(key, value);
    this.updatePath(path);
  }

  /** Retrieve the value for a key, or null if not present. */
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  // Delete a key from the tree
  delete(key: string): boolean {
    if (!this.values.has(key)) return false;
    const path = this.getPathBits(key);
    const defaultLeaf = getSparseDefaultHash(0);
    this.setNode(this.depth, path, defaultLeaf);
    this.values.delete(key);
    this.updatePath(path);
    return true;
  }

  /** Get the root hash of the sparse Merkle tree. */
  get root(): string {
    return this.getNode(0, []);
  }

  /** Number of non-empty leaves. */
  get size(): number {
    return this.values.size;
  }

  /** Generate a proof (membership or non-membership) for a key. */
  generateProof(key: string): SparseMerkleProof {
    const path = this.getPathBits(key);
    const siblings: string[] = [];

    for (let d = 0; d < this.depth; d++) {
      // Sibling is on the opposite side at this depth.
      const siblingPath = [...path.slice(0, d), !path[d]];
      siblings.push(this.getNode(d + 1, siblingPath));
    }

    const exists = this.values.has(key);
    return {
      key,
      value: exists ? this.values.get(key)! : null,
      siblings,
      root: this.root,
      exists,
    };
  }

  /** Verify a sparse Merkle proof. */
  static verifyProof(proof: SparseMerkleProof, depth: number): boolean {
    if (proof.siblings.length !== depth) return false;

    // Recompute the root from the leaf.
    const smt = new SparseMerkleTree(depth);
    const path = smt.getPathBits(proof.key);

    let current: string;
    if (proof.exists && proof.value !== null) {
      current = hashLeaf(proof.value);
    } else {
      current = getSparseDefaultHash(0);
    }

    for (let d = depth - 1; d >= 0; d--) {
      const sibling = proof.siblings[d]!;
      if (path[d]) {
        current = hashInner(sibling, current);
      } else {
        current = hashInner(current, sibling);
      }
    }

    return current === proof.root;
  }
}
