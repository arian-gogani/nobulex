/**
 * @nobulex/merkle — Merkle tree with SHA-256 domain separation and epoch batching.
 *
 * Provides a general-purpose Merkle tree for batching evidence items into
 * time-bounded epochs. Each epoch produces a root that feeds into the next.
 * Supports O(log N) inclusion proofs.
 *
 * Domain separation:
 * - Leaf nodes: SHA-256(0x00 || data)
 * - Inner nodes: SHA-256(0x01 || left || right)
 *
 * @packageDocumentation
 */

import { sha256, toHex } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Direction hint for a proof sibling. */
export type ProofDirection = 'left' | 'right';

/** A single node in an inclusion proof. */
export interface MerkleProofNode {
  readonly hash: string;
  readonly direction: ProofDirection;
}

/** An inclusion proof for a leaf in the tree. */
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
  /** Maximum epoch duration in milliseconds before auto-sealing. */
  readonly maxDurationMs?: number;
}

// ─── Domain-separated hashing ───────────────────────────────────────────────

const LEAF_PREFIX = new Uint8Array([0x00]);
const INNER_PREFIX = new Uint8Array([0x01]);

/** Hash a leaf value with domain separation (0x00 || data). */
export function hashLeaf(data: string): string {
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

// ─── Tree construction ──────────────────────────────────────────────────────

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
  const layers: string[][] = [leaves];

  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1] ?? left; // duplicate last for odd count
      next.push(hashInner(left, right));
    }
    layers.push(next);
    current = next;
  }

  return {
    root: current[0]!,
    leaves,
    layers,
    leafCount: data.length,
  };
}

// ─── Inclusion proofs ───────────────────────────────────────────────────────

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

// ─── Epoch aggregator ───────────────────────────────────────────────────────

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

  /** Get the latest sealed epoch. */
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
