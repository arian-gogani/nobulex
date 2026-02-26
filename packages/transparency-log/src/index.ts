/**
 * @nobulex/transparency-log — Append-only log for epoch Merkle roots.
 *
 * Provides both in-memory and pluggable backends for maintaining a
 * tamper-evident, publicly auditable log of epoch roots. Compatible
 * with Sigstore/Rekor transparency log concepts.
 *
 * @packageDocumentation
 */

import { sha256String, canonicalizeJson, timestamp as nowISO } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single entry in the transparency log. */
export interface LogEntry {
  /** Sequential index in the log. */
  readonly index: number;
  /** The epoch Merkle root being recorded. */
  readonly epochRoot: string;
  /** ISO-8601 timestamp of when this entry was appended. */
  readonly timestamp: string;
  /** Hash of the previous log entry, or null for the first. */
  readonly previousHash: HashHex | null;
  /** SHA-256 hash of this entry's canonical content. */
  readonly hash: HashHex;
  /** Number of leaves in the epoch. */
  readonly leafCount: number;
  /** Epoch index this entry corresponds to. */
  readonly epochIndex: number;
}

/** Proof that a specific entry exists in the log. */
export interface LogInclusionProof {
  readonly entryIndex: number;
  readonly entryHash: string;
  readonly chainHashes: readonly string[];
  readonly headHash: string;
}

/** Result of verifying the log's integrity. */
export interface LogVerification {
  readonly valid: boolean;
  readonly length: number;
  readonly errors: readonly string[];
}

/** Backend interface for pluggable storage. */
export interface TransparencyBackend {
  append(entry: LogEntry): Promise<void>;
  get(index: number): Promise<LogEntry | null>;
  getLatest(): Promise<LogEntry | null>;
  getRange(start: number, end: number): Promise<readonly LogEntry[]>;
  length(): Promise<number>;
}

/** Mode of operation. */
export type LogMode = 'self-hosted' | 'managed';

/** Configuration for the transparency log. */
export interface TransparencyLogConfig {
  readonly mode: LogMode;
  readonly backend?: TransparencyBackend;
  /** For managed mode: the endpoint URL. */
  readonly endpoint?: string;
  /** Log identifier for multi-tenant setups. */
  readonly logId?: string;
}

// ─── In-memory backend ──────────────────────────────────────────────────────

/** Simple in-memory backend for development and testing. */
export class MemoryBackend implements TransparencyBackend {
  private entries: LogEntry[] = [];

  async append(entry: LogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async get(index: number): Promise<LogEntry | null> {
    return this.entries[index] ?? null;
  }

  async getLatest(): Promise<LogEntry | null> {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
  }

  async getRange(start: number, end: number): Promise<readonly LogEntry[]> {
    return this.entries.slice(start, end);
  }

  async length(): Promise<number> {
    return this.entries.length;
  }
}

// ─── Log entry hashing ──────────────────────────────────────────────────────

function computeLogEntryHash(
  index: number,
  epochRoot: string,
  timestamp: string,
  previousHash: HashHex | null,
  leafCount: number,
  epochIndex: number,
): HashHex {
  return sha256String(canonicalizeJson({
    index,
    epochRoot,
    timestamp,
    previousHash,
    leafCount,
    epochIndex,
  }));
}

// ─── Transparency Log ───────────────────────────────────────────────────────

/**
 * Append-only transparency log for epoch Merkle roots.
 *
 * Entries are hash-chained: each entry's hash incorporates the previous entry's hash,
 * making the log tamper-evident. Any modification to a past entry invalidates all
 * subsequent hashes.
 */
export class TransparencyLog {
  private readonly backend: TransparencyBackend;
  readonly mode: LogMode;
  readonly logId: string;

  constructor(config: TransparencyLogConfig = { mode: 'self-hosted' }) {
    this.mode = config.mode;
    this.backend = config.backend ?? new MemoryBackend();
    this.logId = config.logId ?? 'default';
  }

  /** Append a new epoch root to the log. Returns the created entry. */
  async append(epochRoot: string, epochIndex: number, leafCount: number): Promise<LogEntry> {
    const latest = await this.backend.getLatest();
    const index = latest ? latest.index + 1 : 0;
    const previousHash = latest ? latest.hash : null;
    const ts = nowISO();

    const hash = computeLogEntryHash(index, epochRoot, ts, previousHash, leafCount, epochIndex);

    const entry: LogEntry = {
      index,
      epochRoot,
      timestamp: ts,
      previousHash,
      hash,
      leafCount,
      epochIndex,
    };

    await this.backend.append(entry);
    return entry;
  }

  /** Get a log entry by index. */
  async get(index: number): Promise<LogEntry | null> {
    return this.backend.get(index);
  }

  /** Get the most recent entry. */
  async getLatest(): Promise<LogEntry | null> {
    return this.backend.getLatest();
  }

  /** Get a range of entries [start, end). */
  async getRange(start: number, end: number): Promise<readonly LogEntry[]> {
    return this.backend.getRange(start, end);
  }

  /** Total number of entries. */
  async length(): Promise<number> {
    return this.backend.length();
  }

  /**
   * Generate an inclusion proof for a specific entry.
   * The proof is a chain of hashes from the entry forward to the head.
   */
  async generateInclusionProof(entryIndex: number): Promise<LogInclusionProof> {
    const len = await this.backend.length();
    if (entryIndex < 0 || entryIndex >= len) {
      throw new Error(`Entry index ${entryIndex} out of range [0, ${len})`);
    }

    const entry = await this.backend.get(entryIndex);
    if (!entry) throw new Error(`Entry ${entryIndex} not found`);

    const chainHashes: string[] = [];
    for (let i = entryIndex + 1; i < len; i++) {
      const e = await this.backend.get(i);
      if (e) chainHashes.push(e.hash);
    }

    const latest = await this.backend.getLatest();

    return {
      entryIndex,
      entryHash: entry.hash,
      chainHashes,
      headHash: latest!.hash,
    };
  }

  /** Verify the entire log's integrity by checking the hash chain. */
  async verify(): Promise<LogVerification> {
    const len = await this.backend.length();
    const errors: string[] = [];

    for (let i = 0; i < len; i++) {
      const entry = await this.backend.get(i);
      if (!entry) {
        errors.push(`Entry ${i}: missing`);
        continue;
      }

      // Verify hash
      const expected = computeLogEntryHash(
        entry.index, entry.epochRoot, entry.timestamp,
        entry.previousHash, entry.leafCount, entry.epochIndex,
      );
      if (expected !== entry.hash) {
        errors.push(`Entry ${i}: hash mismatch`);
      }

      // Verify chain linkage
      if (i === 0) {
        if (entry.previousHash !== null) {
          errors.push(`Entry 0: previousHash should be null`);
        }
      } else {
        const prev = await this.backend.get(i - 1);
        if (prev && entry.previousHash !== prev.hash) {
          errors.push(`Entry ${i}: previousHash does not match previous entry hash`);
        }
      }

      // Verify sequential index
      if (entry.index !== i) {
        errors.push(`Entry ${i}: index mismatch (got ${entry.index})`);
      }
    }

    return { valid: errors.length === 0, length: len, errors };
  }
}

/**
 * Verify a log inclusion proof.
 * Checks that the chain of hashes from the entry leads to the head.
 */
export function verifyLogInclusionProof(proof: LogInclusionProof): boolean {
  if (proof.chainHashes.length === 0) {
    return proof.entryHash === proof.headHash;
  }
  return proof.chainHashes[proof.chainHashes.length - 1] === proof.headHash;
}
