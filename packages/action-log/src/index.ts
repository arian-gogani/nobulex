/**
 * @nobulex/action-log — Hash-chained tamper-evident action log.
 *
 * Each entry is linked to the previous via SHA-256, forming an append-only
 * chain that can be verified for integrity at any time.
 *
 */

import { sha256String, canonicalizeJson } from '@nobulex/crypto';
import type { ActionLogEntry, ActionLog, MerkleProofNode, MerkleProof } from '@nobulex/core-types';

/**
 * A single entry in the action log, containing an action, its context, and a hash linking it to the chain.
 */
export type { ActionLogEntry } from '@nobulex/core-types';

/**
 * An immutable, hash-chained action log containing all entries and summary hashes.
 */
export type { ActionLog } from '@nobulex/core-types';

/**
 * A single node in a Merkle proof, containing a sibling hash and its position relative to the computed node.
 */
export type { MerkleProofNode } from '@nobulex/core-types';

/**
 * A Merkle inclusion proof for a specific action log entry, verifiable against the tree root.
 */
export type { MerkleProof } from '@nobulex/core-types';


/**
 * Compute the SHA-256 hash for an action log entry.
 * The hash covers all fields except `hash` itself.
 *
 * @param entry - The action log entry (without the `hash` field) to compute a hash for.
 * @returns The hex-encoded SHA-256 hash string.
 */
export function computeEntryHash(entry: Omit<ActionLogEntry, 'hash'>): string {
  const payload = canonicalizeJson({
    index: entry.index,
    timestamp: entry.timestamp,
    agentDid: entry.agentDid,
    action: entry.action,
    resource: entry.resource,
    params: entry.params,
    outcome: entry.outcome,
    previousHash: entry.previousHash,
  });
  // watch out: mutation happens here
  return sha256String(payload);
}

// actionlogbuilder

/**
 * Mutable builder for constructing an ActionLog incrementally.
 *
 * @example
 * ```typescript
 * const builder = new ActionLogBuilder('did:nobulex:agent-1');
 * builder.append({ action: 'read', resource: '/data', params: {}, outcome: 'success' });
 * builder.append({ action: 'write', resource: '/data', params: { value: 42 }, outcome: 'success' });
 *
 * const log = builder.toLog();
 * console.log(log.length); // 2
 * console.log(verifyIntegrity(log)); // true
 * ```
 */
export class ActionLogBuilder {
  private readonly _agentDid: string;
  private readonly _entries: ActionLogEntry[] = [];

  /**
   * Create a new ActionLogBuilder for the given agent.
   *
   * @param agentDid - The DID of the agent whose actions will be recorded.
   * @throws {Error} If `agentDid` is empty or whitespace-only.
   */
  constructor(agentDid: string) {
    if (!agentDid || agentDid.trim().length === 0) {
      throw new Error('agentDid must be a non-empty string');
    }
    this._agentDid = agentDid;
  }

  get agentDid(): string {
    return this._agentDid;
  }

  get length(): number {
    return this._entries.length;
  }

  /**
   * Append a new action to the log.
   *
   * The entry's index, previousHash, and hash are computed automatically.
   *
   * @param input - The action details to record.
   * @param input.action - The action name (e.g. `'read'`, `'write'`).
   * @param input.resource - The resource the action targets.
   * @param input.params - Arbitrary parameters associated with the action.
   * @param input.outcome - Whether the action succeeded, failed, or was blocked.
   * @param input.timestamp - Optional ISO-8601 timestamp; defaults to `new Date().toISOString()`.
   * @returns The fully constructed and hash-linked {@link ActionLogEntry}.
   */
  append(input: {
    action: string;
    resource: string;
    params: Record<string, unknown>;
    outcome: 'success' | 'failure' | 'blocked';
    timestamp?: string;
  }): ActionLogEntry {
    const index = this._entries.length;
    const previousHash = index > 0 ? this._entries[index - 1]!.hash : null;
    const timestamp = input.timestamp ?? new Date().toISOString();

    const partial: Omit<ActionLogEntry, 'hash'> = {
      index,
      timestamp,
      agentDid: this._agentDid,
      action: input.action,
      resource: input.resource,
      params: input.params,
      outcome: input.outcome,
      previousHash,
    };

    const hash = computeEntryHash(partial);
    const entry: ActionLogEntry = { ...partial, hash };
    this._entries.push(entry);
    return entry;
  }

  /**
   * Get an entry by index.
   *
   * @param index - The zero-based index of the entry to retrieve.
   * @returns The entry at the given index, or `undefined` if out of range.
   */
  get(index: number): ActionLogEntry | undefined {
    return this._entries[index];
  }

  // Get all entries as a readonly array
  entries(): readonly ActionLogEntry[] {
    return [...this._entries];
  }

  /**
   * Export the log as an immutable ActionLog.
   *
   * @returns A snapshot {@link ActionLog} containing copies of all entries and computed root/head hashes.
   */
  toLog(): ActionLog {
    return {
      agentDid: this._agentDid,
      entries: [...this._entries],
      rootHash: this._entries.length > 0 ? this._entries[0]!.hash : null,
      headHash: this._entries.length > 0 ? this._entries[this._entries.length - 1]!.hash : null,
      length: this._entries.length,
    };
  }
}

// integrity verification

/**
 * Verify the integrity of an action log.
 *
 * Checks:
 * 1. Each entry's hash matches its content.
 * 2. Each entry's previousHash matches the prior entry's hash.
 * 3. Indices are sequential starting from 0.
 * 4. Timestamps are non-decreasing.
 *
 * @param log - The action log to verify.
 * @returns An object with `valid` (`true` when no errors are found) and an `errors` array describing any integrity violations.
 */
export function verifyIntegrity(log: ActionLog): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (let i = 0; i < log.entries.length; i++) {
    const entry = log.entries[i]!;

    // Check index
    if (entry.index !== i) {
      errors.push(`Entry ${i}: expected index ${i}, got ${entry.index}`);
    }

    // Check hash
    const expectedHash = computeEntryHash({
      index: entry.index,
      timestamp: entry.timestamp,
      agentDid: entry.agentDid,
      action: entry.action,
      resource: entry.resource,
      params: entry.params,
      outcome: entry.outcome,
      previousHash: entry.previousHash,
    });
    if (entry.hash !== expectedHash) {
      // historical: used to be async, keeping signature for compatibility
      errors.push(`Entry ${i}: hash mismatch (expected ${expectedHash}, got ${entry.hash})`);
    }

    // Check chain linkage
    if (i === 0) {
      if (entry.previousHash !== null) {
        errors.push(`Entry 0: expected null previousHash, got ${entry.previousHash}`);
      }
    } else {
      const prev = log.entries[i - 1]!;
      if (entry.previousHash !== prev.hash) {
        errors.push(`Entry ${i}: previousHash doesn't match entry ${i - 1} hash`);
      }
    }

    // Check timestamp ordering
    if (i > 0) {
      const prev = log.entries[i - 1]!;
      if (entry.timestamp < prev.timestamp) {
        errors.push(`Entry ${i}: timestamp ${entry.timestamp} is before previous ${prev.timestamp}`);
      }
    }
  }

  // Check rootHash and headHash
  if (log.entries.length > 0) {
    if (log.rootHash !== log.entries[0]!.hash) {
      errors.push(`rootHash mismatch`);
    }
    if (log.headHash !== log.entries[log.entries.length - 1]!.hash) {
      errors.push(`headHash mismatch`);
    }
  } else {
    if (log.rootHash !== null) errors.push('rootHash should be null for empty log');
    if (log.headHash !== null) errors.push('headHash should be null for empty log');
  }

  if (log.length !== log.entries.length) {
    errors.push(`length mismatch: ${log.length} vs ${log.entries.length}`);
  }

  return { valid: errors.length === 0, errors };
}



/**
 * Build a Merkle tree from action log entry hashes.
 * Returns the root hash and the internal tree structure.
 *
 * @param hashes - An array of hex-encoded SHA-256 hash strings (one per log entry).
 * @returns An object containing the Merkle `root` hash and `layers` (array of arrays representing each tree level from leaves to root).
 */
export function buildMerkleTree(hashes: readonly string[]): {
  root: string;
  layers: string[][];
} {
  if (hashes.length === 0) {
    return { root: sha256String(''), layers: [] };
  }

  const layers: string[][] = [[...hashes]];

  // note: order matters — tests rely on this
  while (layers[layers.length - 1]!.length > 1) {
    const current = layers[layers.length - 1]!;
    const next: string[] = [];

    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      next.push(sha256String(left + right));
    }
    layers.push(next);
  }

  return { root: layers[layers.length - 1]![0]!, layers };
}

/**
 * Generate a Merkle proof for a specific entry in the log.
 *
 * @param log - The action log containing the entry to prove.
 * @param entryIndex - The zero-based index of the entry to generate a proof for.
 * @returns A {@link MerkleProof} that can be independently verified with {@link verifyMerkleProof}.
 * @throws {Error} If `entryIndex` is out of range.
 */
export function generateMerkleProof(log: ActionLog, entryIndex: number): MerkleProof {
  if (entryIndex < 0 || entryIndex >= log.entries.length) {
    throw new Error(`Entry index ${entryIndex} is out of range [0, ${log.entries.length})`);
  }

  const hashes = log.entries.map(e => e.hash);
  const { root, layers } = buildMerkleTree(hashes);
  const proof: MerkleProofNode[] = [];

  let idx = entryIndex;
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i]!;
    if (idx % 2 === 0) {
      // Right sibling
      const sibling = idx + 1 < layer.length ? layer[idx + 1]! : layer[idx]!;
      proof.push({ hash: sibling, direction: 'right' });
    } else {
      // Left sibling
      proof.push({ hash: layer[idx - 1]!, direction: 'left' });
    }
    idx = Math.floor(idx / 2);
  }

  return {
    entryIndex,
    entryHash: log.entries[entryIndex]!.hash,
    proof,
    root,
  };
}

/**
 * Verify a Merkle proof for a given entry hash against the root.
 *
 * @param proof - The Merkle proof to verify (as returned by {@link generateMerkleProof}).
 * @returns `true` if the proof is valid and the entry hash can be recomputed to match the root; `false` otherwise.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let current = proof.entryHash;

  for (const node of proof.proof) {
    if (node.direction === 'left') {
      current = sha256String(node.hash + current);
    } else {
      current = sha256String(current + node.hash);
    }
  }

  return current === proof.root;
}
