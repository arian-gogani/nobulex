/**
 * Hash-chained audit log with tamper detection.
 *
 * Provides an append-only, cryptographically chained audit trail that
 * detects any modification to historical entries. Each entry's hash
 * includes the previous entry's hash, forming an immutable chain.
 *
 * @packageDocumentation
 */

import {
  sha256String,
  sha256Object,
  generateId,
  generateNonce,
  toHex,
  timestamp,
} from '@stele/crypto';

/**
 * A single entry in the audit chain.
 */
export interface ChainedAuditEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** ISO 8601 timestamp when the entry was created. */
  timestamp: string;
  /** The action that was performed or attempted. */
  action: string;
  /** The resource targeted by the action. */
  resource: string;
  /** The covenant ID governing the action. */
  covenantId: string;
  /** Whether the action was permitted, denied, or produced an error. */
  result: 'permitted' | 'denied' | 'error';
  /** Hash of the previous entry in the chain (genesis uses all zeros). */
  previousHash: string;
  /** SHA-256 hash of this entry's content including previousHash. */
  hash: string;
  /** Cryptographic nonce for uniqueness. */
  nonce: string;
}

/** The zero hash used as the previousHash for the first entry. */
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Compute the SHA-256 hash of an audit entry from its content fields.
 *
 * The hash covers all content fields except the hash itself, ensuring
 * that any modification to the entry can be detected.
 */
function computeChainedEntryHash(entry: Omit<ChainedAuditEntry, 'hash'> & { hash?: string }): string {
  const content = {
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    resource: entry.resource,
    covenantId: entry.covenantId,
    result: entry.result,
    previousHash: entry.previousHash,
    nonce: entry.nonce,
  };
  return sha256Object(content);
}

/**
 * An append-only, hash-chained audit log that provides tamper detection.
 *
 * Each entry in the chain contains the hash of the previous entry, creating
 * a cryptographic chain similar to a blockchain. Any modification to a
 * historical entry will break the chain and be detectable via verify().
 *
 * Usage:
 * ```ts
 * const chain = new AuditChain();
 * chain.append({
 *   timestamp: new Date().toISOString(),
 *   action: 'file.read',
 *   resource: '/data/users',
 *   covenantId: 'abc123',
 *   result: 'permitted',
 * });
 *
 * const integrity = chain.verify();
 * console.log(integrity.valid); // true
 * ```
 */
export class AuditChain {
  private chain: ChainedAuditEntry[] = [];

  constructor() {}

  /**
   * Append a new entry to the chain.
   *
   * Automatically generates the id, nonce, previousHash, and hash fields.
   * The previousHash is set to the hash of the last entry, or the genesis
   * hash if this is the first entry.
   *
   * @param entry - The entry content without chain metadata.
   * @returns The complete chained audit entry.
   */
  append(
    entry: Omit<ChainedAuditEntry, 'id' | 'previousHash' | 'hash' | 'nonce'>,
  ): ChainedAuditEntry {
    const id = generateId();
    const nonce = toHex(generateNonce());
    const previousHash =
      this.chain.length > 0
        ? this.chain[this.chain.length - 1]!.hash
        : GENESIS_HASH;

    const partial: Omit<ChainedAuditEntry, 'hash'> = {
      id,
      timestamp: entry.timestamp,
      action: entry.action,
      resource: entry.resource,
      covenantId: entry.covenantId,
      result: entry.result,
      previousHash,
      nonce,
    };

    const hash = computeChainedEntryHash(partial);

    const complete: ChainedAuditEntry = {
      ...partial,
      hash,
    };

    this.chain.push(complete);
    return complete;
  }

  /**
   * Verify the integrity of the entire audit chain.
   *
   * Checks that:
   * 1. Each entry's previousHash matches the hash of the preceding entry.
   * 2. Each entry's hash is correctly computed from its content fields.
   *
   * @returns An object with `valid`, the number of `entries`, and optionally
   *          `brokenAt` indicating the first index where tampering was detected.
   */
  verify(): { valid: boolean; brokenAt?: number; entries: number } {
    const rangeResult = this.verifyRange(0, this.chain.length - 1);
    return { ...rangeResult, entries: this.chain.length };
  }

  /**
   * Verify a specific range of entries in the chain.
   *
   * Checks the hash chain and entry integrity for entries in the range
   * [start, end] (inclusive).
   *
   * @param start - The start index (inclusive).
   * @param end - The end index (inclusive).
   * @returns An object with `valid` and optionally `brokenAt`.
   */
  verifyRange(
    start: number,
    end: number,
  ): { valid: boolean; brokenAt?: number } {
    if (this.chain.length === 0) {
      return { valid: true };
    }

    const effectiveStart = Math.max(0, start);
    const effectiveEnd = Math.min(this.chain.length - 1, end);

    for (let i = effectiveStart; i <= effectiveEnd; i++) {
      const entry = this.chain[i]!;

      // Verify previousHash linkage
      const expectedPreviousHash =
        i === 0 ? GENESIS_HASH : this.chain[i - 1]!.hash;

      if (entry.previousHash !== expectedPreviousHash) {
        return { valid: false, brokenAt: i };
      }

      // Verify the entry hash
      const recomputedHash = computeChainedEntryHash(entry);
      if (entry.hash !== recomputedHash) {
        return { valid: false, brokenAt: i };
      }
    }

    return { valid: true };
  }

  /**
   * Get all entries in the chain as a readonly array.
   *
   * @returns A frozen copy of the chain entries.
   */
  entries(): readonly ChainedAuditEntry[] {
    return Object.freeze([...this.chain]);
  }

  /**
   * Get the latest (most recent) entry in the chain.
   *
   * @returns The last entry, or undefined if the chain is empty.
   */
  latest(): ChainedAuditEntry | undefined {
    if (this.chain.length === 0) return undefined;
    return this.chain[this.chain.length - 1];
  }

  /**
   * Export the entire chain as a JSON string for persistence.
   *
   * @returns A JSON string representation of the chain.
   */
  export(): string {
    return JSON.stringify(this.chain);
  }

  /**
   * Import a chain from a JSON string.
   *
   * Parses the JSON, reconstructs the AuditChain, and verifies the
   * integrity of the imported chain. Throws if the chain is invalid.
   *
   * @param json - A JSON string produced by export().
   * @returns A new AuditChain instance with the imported entries.
   * @throws Error if the JSON is invalid or the chain integrity check fails.
   */
  static import(json: string): AuditChain {
    let entries: ChainedAuditEntry[];
    try {
      entries = JSON.parse(json);
    } catch {
      throw new Error('Invalid JSON: failed to parse audit chain');
    }

    if (!Array.isArray(entries)) {
      throw new Error('Invalid audit chain: expected an array');
    }

    const chain = new AuditChain();
    chain.chain = entries;

    // Verify integrity of the imported chain
    const result = chain.verify();
    if (!result.valid) {
      throw new Error(
        `Audit chain integrity check failed at entry ${result.brokenAt}`,
      );
    }

    return chain;
  }

  /**
   * Get statistics about the entries in the chain.
   *
   * @returns An object with counts of total, permitted, denied, and error entries.
   */
  stats(): { total: number; permitted: number; denied: number; errors: number } {
    let permitted = 0;
    let denied = 0;
    let errors = 0;

    for (const entry of this.chain) {
      switch (entry.result) {
        case 'permitted':
          permitted++;
          break;
        case 'denied':
          denied++;
          break;
        case 'error':
          errors++;
          break;
      }
    }

    return { total: this.chain.length, permitted, denied, errors };
  }
}
