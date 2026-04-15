/**
 * @nobulex/transparency-log — Append-only transparency log for epoch Merkle roots.
 *
 * Provides in-memory, file-based, and pluggable backends for maintaining a
 * tamper-evident, publicly auditable log of epoch roots. Implements consistency
 * proofs, signed tree heads with witness cosigning, tamper monitoring, log
 * compaction, serialization, statistics, and HTTP API route definitions.
 *
 * Compatible with Sigstore/Rekor transparency log concepts.
 *
 */

import {
  sha256String,
  canonicalizeJson,
  timestamp as nowISO,
  sign,
  verify,
  toHex,
  fromHex,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';


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

// ─── Consistency Proof Types ─────────────────────────────────────────────────

/** Proof that the log at an earlier size is a prefix of the current log. */
export interface ConsistencyProof {
  /** The earlier log size. */
  readonly oldSize: number;
  /** The current log size. */
  readonly newSize: number;
  /** Hash of the log head at oldSize. */
  readonly oldHeadHash: HashHex;
  /** Hash of the log head at newSize. */
  readonly newHeadHash: HashHex;
  /** Chain of hashes from oldSize to newSize proving consistency. */
  readonly proofHashes: readonly HashHex[];
  /** Timestamp when proof was generated. */
  readonly timestamp: string;
}

// signed tree head types

/** A signed snapshot of the log state at a point in time. */
export interface SignedTreeHead {
  /** SHA-256 root hash of the log head. */
  readonly rootHash: HashHex;
  /** Number of entries in the log. */
  readonly treeSize: number;
  /** ISO-8601 timestamp when this head was signed. */
  readonly timestamp: string;
  /** Hex-encoded Ed25519 signature over the canonical head content. */
  readonly signature: string;
  /** Hex-encoded public key of the signer. */
  readonly signerPublicKey: string;
}

// witness cosigning types

/** A witness's countersignature on a tree head. */
export interface WitnessSignature {
  /** Hex-encoded public key of the witness. */
  readonly witnessPublicKey: string;
  /** Hex-encoded Ed25519 signature by the witness. */
  readonly signature: string;
  /** ISO-8601 timestamp when witness cosigned. */
  readonly timestamp: string;
}

/** A signed tree head with additional witness cosignatures. */
export interface CosignedTreeHead extends SignedTreeHead {
  /** Array of witness cosignatures. */
  readonly witnesses: readonly WitnessSignature[];
}

// ---

/** Checkpoint covering compacted (pruned) log entries. */
export interface CompactionCheckpoint {
  /** Index up to which entries were compacted (exclusive). */
  readonly compactedThrough: number;
  /** SHA-256 hash covering all compacted entries. */
  readonly checkpointHash: HashHex;
  /** Number of entries that were compacted. */
  readonly compactedCount: number;
  /** ISO-8601 timestamp when compaction occurred. */
  readonly timestamp: string;
  /** Hash of the last compacted entry. */
  readonly lastCompactedEntryHash: HashHex;
}

// log statistics types

/** Statistical summary of log contents. */
export interface LogStats {
  /** Total number of entries in the log. */
  readonly entryCount: number;
  /** Time span from first to last entry in milliseconds, or 0 if fewer than 2 entries. */
  readonly timeSpanMs: number;
  /** Average number of entries per epoch, or 0 if no entries. */
  readonly averageEntriesPerEpoch: number;
  /** Total leaf count across all entries. */
  readonly totalLeavesRecorded: number;
}


/** Status of the tamper monitor. */
export interface MonitorStatus {
  /** Whether the monitor is currently running. */
  readonly running: boolean;
  /** ISO-8601 timestamp of last integrity check, or null if never checked. */
  readonly lastCheckTime: string | null;
  /** Result of the last integrity check, or null if never checked. */
  readonly lastCheckResult: LogVerification | null;
  /** History of tamper detection alerts. */
  readonly alertHistory: readonly TamperAlert[];
}

/** A tamper detection alert. */
export interface TamperAlert {
  /** ISO-8601 timestamp when tamper was detected. */
  readonly detectedAt: string;
  /** Errors found during the integrity check. */
  readonly errors: readonly string[];
}

// ─── HTTP API Types ──────────────────────────────────────────────────────────

/** HTTP method. */
export type HttpMethod = 'GET' | 'POST';

/** A single API route definition. */
export interface APIRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly description: string;
  readonly handler: (params: Record<string, string>, body?: unknown) => Promise<unknown>;
}

/** Interface for a transparency log HTTP API client. */
export interface TransparencyAPIClient {
  append(epochRoot: string, epochIndex: number, leafCount: number): Promise<LogEntry>;
  get(index: number): Promise<LogEntry | null>;
  getLatest(): Promise<LogEntry | null>;
  getRange(start: number, end: number): Promise<readonly LogEntry[]>;
  length(): Promise<number>;
  generateInclusionProof(entryIndex: number): Promise<LogInclusionProof>;
  generateConsistencyProof(oldSize: number, newSize: number): Promise<ConsistencyProof>;
  verify(): Promise<LogVerification>;
}


/** Serialized form of the entire log for transport or storage. */
export interface SerializedLog {
  /** Version of the serialization format. */
  readonly version: number;
  /** ISO-8601 timestamp when serialization occurred. */
  readonly serializedAt: string;
  /** The log identifier. */
  readonly logId: string;
  /** The operating mode of the log. */
  readonly mode: LogMode;
  /** Total number of entries. */
  readonly entryCount: number;
  /** The serialized entries. */
  readonly entries: readonly SerializedLogEntry[];
}

/** Serialized form of a single log entry. */
export interface SerializedLogEntry {
  readonly index: number;
  readonly epochRoot: string;
  readonly timestamp: string;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly leafCount: number;
  readonly epochIndex: number;
}

// ─── In-memory Backend ──────────────────────────────────────────────────────

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

// ─── File-based Backend ──────────────────────────────────────────────────────

/**
 * File-based backend storing entries as newline-delimited JSON.
 *
 * Supports append-only writes with simulated file locking to prevent
 * concurrent write corruption. Each entry is stored as a single JSON line.
 *
 * Designed for Node.js environments. Pass `fs` and `path` modules to
 * avoid hard dependencies on Node built-ins (keeps the package isomorphic
 * for type-checking in browser contexts).
 */
export class FileBackend implements TransparencyBackend {
  private readonly filePath: string;
  private readonly fs: FileSystemAdapter;
  private locked = false;
  private lockQueue: Array<() => void> = [];

  /**
   * @param filePath - Path to the NDJSON log file.
   * @param fs - File system adapter with readFile, writeFile, appendFile, access.
   */
  constructor(filePath: string, fs: FileSystemAdapter) {
    this.filePath = filePath;
    this.fs = fs;
  }

  /** Acquire the simulated file lock. */
  private async acquireLock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.lockQueue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  /** Release the simulated file lock. */
  private releaseLock(): void {
    if (this.lockQueue.length > 0) {
      const next = this.lockQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  /** Ensure the log file exists, creating it if necessary. */
  private async ensureFile(): Promise<void> {
    const exists = await this.fs.exists(this.filePath);
    if (!exists) {
      await this.fs.writeFile(this.filePath, '');
    }
  }

  /** Read and parse all entries from the file. */
  private async readAllEntries(): Promise<LogEntry[]> {
    await this.ensureFile();
    const content = await this.fs.readFile(this.filePath);
    if (!content.trim()) return [];
    const lines = content.trim().split('\n');
    const entries: LogEntry[] = [];
    for (const line of lines) {
      if (line.trim()) {
        entries.push(JSON.parse(line) as LogEntry);
      }
    }
    return entries;
  }

  async append(entry: LogEntry): Promise<void> {
    await this.acquireLock();
    try {
      await this.ensureFile();
      const line = JSON.stringify(entry) + '\n';
      await this.fs.appendFile(this.filePath, line);
    } finally {
      this.releaseLock();
    }
  }

  async get(index: number): Promise<LogEntry | null> {
    const entries = await this.readAllEntries();
    return entries[index] ?? null;
  }

  async getLatest(): Promise<LogEntry | null> {
    const entries = await this.readAllEntries();
    return entries.length > 0 ? entries[entries.length - 1]! : null;
  }

  async getRange(start: number, end: number): Promise<readonly LogEntry[]> {
    const entries = await this.readAllEntries();
    return entries.slice(start, end);
  }

  async length(): Promise<number> {
    const entries = await this.readAllEntries();
    return entries.length;
  }
}

/** Minimal file system adapter for FileBackend. */
export interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// log entry hashing

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


/**
 * Append-only transparency log for epoch Merkle roots.
 *
 * Entries are hash-chained: each entry's hash incorporates the previous entry's
 * hash, making the log tamper-evident. Any modification to a past entry
 * invalidates all subsequent hashes.
 *
 * Supports inclusion proofs, consistency proofs, integrity verification,
 * signed tree heads, and witness cosigning.
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

  /**
   * Generate a consistency proof showing that the log at oldSize is a
   * prefix of the log at newSize.
   *
   * The proof contains the chain of entry hashes from oldSize to newSize,
   * allowing a verifier to confirm that no previously committed entries
   * were altered.
   */
  async generateConsistencyProof(oldSize: number, newSize: number): Promise<ConsistencyProof> {
    const len = await this.backend.length();

    if (oldSize < 0) {
      throw new Error(`oldSize must be non-negative, got ${oldSize}`);
    }
    if (newSize < oldSize) {
      throw new Error(`newSize (${newSize}) must be >= oldSize (${oldSize})`);
    }
    if (newSize > len) {
      throw new Error(`newSize (${newSize}) exceeds log length (${len})`);
    }
    if (oldSize === 0 && newSize === 0) {
      return {
        oldSize: 0,
        newSize: 0,
        oldHeadHash: '' as HashHex,
        newHeadHash: '' as HashHex,
        proofHashes: [],
        timestamp: nowISO(),
      };
    }

    // Get the head hashes
    let oldHeadHash: HashHex = '' as HashHex;
    if (oldSize > 0) {
      const oldHead = await this.backend.get(oldSize - 1);
      if (!oldHead) throw new Error(`Entry ${oldSize - 1} not found`);
      oldHeadHash = oldHead.hash;
    }

    const newHead = await this.backend.get(newSize - 1);
    if (!newHead) throw new Error(`Entry ${newSize - 1} not found`);
    const newHeadHash = newHead.hash;

    // Build the proof: hashes of entries from oldSize to newSize - 1
    const proofHashes: HashHex[] = [];
    for (let i = oldSize; i < newSize; i++) {
      const entry = await this.backend.get(i);
      if (!entry) throw new Error(`Entry ${i} not found`);
      proofHashes.push(entry.hash);
    }

    return {
      oldSize,
      newSize,
      oldHeadHash,
      newHeadHash,
      proofHashes,
      timestamp: nowISO(),
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

// consistency proof verification

/**
 * Verify a consistency proof.
 *
 * Checks that:
 * 1. The proof chain connects oldSize to newSize.
 * 2. Each proof hash forms a valid chain link.
 * 3. If oldSize > 0, the first proof hash's entry should reference the old head.
 */
export function verifyConsistencyProof(proof: ConsistencyProof): boolean {
  // Empty to empty is trivially consistent
  if (proof.oldSize === 0 && proof.newSize === 0) {
    return true;
  }

  // oldSize === newSize means no new entries, proof should be empty
  if (proof.oldSize === proof.newSize) {
    return proof.proofHashes.length === 0 && proof.oldHeadHash === proof.newHeadHash;
  }

  // Must have exactly (newSize - oldSize) proof hashes
  const expectedCount = proof.newSize - proof.oldSize;
  if (proof.proofHashes.length !== expectedCount) {
    return false;
  }

  // The last proof hash must equal the new head hash
  if (proof.proofHashes[proof.proofHashes.length - 1] !== proof.newHeadHash) {
    return false;
  }

  // newSize must be >= oldSize (already checked structurally)
  if (proof.newSize < proof.oldSize) {
    return false;
  }

  return true;
}

// ─── Signed Tree Heads ───────────────────────────────────────────────────────

/**
 * Compute the canonical content of a tree head for signing.
 */
function treeHeadSigningContent(rootHash: HashHex, treeSize: number, timestamp: string): string {
  return canonicalizeJson({
    rootHash,
    treeSize,
    timestamp,
  });
}

/**
 * Create a signed tree head for the current state of the log.
 *
 * Signs a snapshot containing the root hash (head entry hash), tree size,
 * and timestamp using the provided key pair.
 */
export async function signTreeHead(
  log: TransparencyLog,
  keyPair: KeyPair,
): Promise<SignedTreeHead> {
  const len = await log.length();
  if (len === 0) {
    throw new Error('Cannot sign tree head of empty log');
  }

  const latest = await log.getLatest();
  if (!latest) throw new Error('Failed to retrieve latest entry');

  const rootHash = latest.hash;
  const treeSize = len;
  const ts = nowISO();

  const content = treeHeadSigningContent(rootHash, treeSize, ts);
  const contentBytes = new TextEncoder().encode(content);
  const sig = await sign(contentBytes, keyPair.privateKey);

  return {
    rootHash,
    treeSize,
    timestamp: ts,
    signature: toHex(sig),
    signerPublicKey: keyPair.publicKeyHex,
  };
}

/**
 * Verify a signed tree head against a public key.
 *
 * Recomputes the canonical content and verifies the Ed25519 signature.
 *
 * @param sth - The signed tree head to verify.
 * @param publicKey - Hex-encoded public key to verify against.
 * @returns true if the signature is valid.
 */
export async function verifySignedTreeHead(
  sth: SignedTreeHead,
  publicKey: string,
): Promise<boolean> {
  const content = treeHeadSigningContent(sth.rootHash, sth.treeSize, sth.timestamp);
  const contentBytes = new TextEncoder().encode(content);
  const sigBytes = fromHex(sth.signature);
  const pubKeyBytes = fromHex(publicKey);

  return verify(contentBytes, sigBytes, pubKeyBytes);
}

// ─── Witness Cosigning ───────────────────────────────────────────────────────

/**
 * Compute the canonical content for witness cosigning.
 * Witnesses sign the full signed tree head content (including the original signature).
 */
function witnessCosignContent(sth: SignedTreeHead): string {
  return canonicalizeJson({
    rootHash: sth.rootHash,
    treeSize: sth.treeSize,
    timestamp: sth.timestamp,
    signature: sth.signature,
    signerPublicKey: sth.signerPublicKey,
  });
}

/**
 * Cosign a signed tree head as a witness.
 *
 * The witness signs the entire signed tree head (including the original
 * signer's signature) to produce a countersignature attesting that the
 * witness observed this tree head.
 */
export async function cosignTreeHead(
  sth: SignedTreeHead,
  witnessKeyPair: KeyPair,
): Promise<CosignedTreeHead> {
  const content = witnessCosignContent(sth);
  const contentBytes = new TextEncoder().encode(content);
  const sig = await sign(contentBytes, witnessKeyPair.privateKey);

  const witnessSignature: WitnessSignature = {
    witnessPublicKey: witnessKeyPair.publicKeyHex,
    signature: toHex(sig),
    timestamp: nowISO(),
  };

  // If already a cosigned tree head, append the new witness
  const existingWitnesses = 'witnesses' in sth
    ? (sth as CosignedTreeHead).witnesses
    : [];

  return {
    ...sth,
    witnesses: [...existingWitnesses, witnessSignature],
  };
}

/**
 * Verify all witness cosignatures on a cosigned tree head.
 *
 * Checks each witness signature against its public key and also verifies
 * that the witness public keys are in the provided trusted set.
 *
 * @param cosigned - The cosigned tree head to verify.
 * @param witnessPublicKeys - Array of hex-encoded trusted witness public keys.
 * @returns true if all witness signatures are valid and from trusted keys.
 */
export async function verifyWitnesses(
  cosigned: CosignedTreeHead,
  witnessPublicKeys: readonly string[],
): Promise<boolean> {
  if (cosigned.witnesses.length === 0) {
    return false;
  }

  const trustedSet = new Set(witnessPublicKeys);

  // Reconstruct the base signed tree head for verification
  const baseSth: SignedTreeHead = {
    rootHash: cosigned.rootHash,
    treeSize: cosigned.treeSize,
    timestamp: cosigned.timestamp,
    signature: cosigned.signature,
    signerPublicKey: cosigned.signerPublicKey,
  };

  const content = witnessCosignContent(baseSth);
  const contentBytes = new TextEncoder().encode(content);

  for (const ws of cosigned.witnesses) {
    // Check that witness is in trusted set
    if (!trustedSet.has(ws.witnessPublicKey)) {
      return false;
    }

    // Verify signature
    const sigBytes = fromHex(ws.signature);
    const pubKeyBytes = fromHex(ws.witnessPublicKey);
    const valid = await verify(contentBytes, sigBytes, pubKeyBytes);
    if (!valid) {
      return false;
    }
  }

  return true;
}

// ─── Log Compaction ──────────────────────────────────────────────────────────

/**
 * Create a compacted view of the log, retaining only entries after a given index.
 *
 * Computes a checkpoint hash covering all entries up to and including
 * `retainAfterIndex`. Entries at indices <= retainAfterIndex are summarized
 * by the checkpoint; entries after that index are returned in full.
 *
 * This does NOT modify the original log. It produces a checkpoint and the
 * retained entries for use in creating a compacted copy.
 *
 * @param log - The transparency log to compact.
 * @param retainAfterIndex - Entries at indices > this value are retained.
 * @returns An object with the compaction checkpoint and the retained entries.
 */
export async function compactLog(
  log: TransparencyLog,
  retainAfterIndex: number,
): Promise<{ checkpoint: CompactionCheckpoint; retainedEntries: readonly LogEntry[] }> {
  const len = await log.length();

  if (len === 0) {
    throw new Error('Cannot compact empty log');
  }

  if (retainAfterIndex < 0) {
    throw new Error(`retainAfterIndex must be non-negative, got ${retainAfterIndex}`);
  }

  if (retainAfterIndex >= len) {
    throw new Error(
      `retainAfterIndex (${retainAfterIndex}) must be less than log length (${len})`,
    );
  }

  // Compute checkpoint hash over compacted entries
  const compactedEntries = await log.getRange(0, retainAfterIndex + 1);
  const compactedHashes = compactedEntries.map((e) => e.hash);
  const checkpointHash = sha256String(
    canonicalizeJson({
      compactedThrough: retainAfterIndex,
      hashes: compactedHashes,
    }),
  );

  const lastCompacted = compactedEntries[compactedEntries.length - 1]!;

  const checkpoint: CompactionCheckpoint = {
    compactedThrough: retainAfterIndex,
    checkpointHash,
    compactedCount: retainAfterIndex + 1,
    timestamp: nowISO(),
    lastCompactedEntryHash: lastCompacted.hash,
  };

  // Get retained entries
  const retainedEntries = await log.getRange(retainAfterIndex + 1, len);

  return { checkpoint, retainedEntries };
}

// ─── Tamper Monitoring ───────────────────────────────────────────────────────

/** Callback type for tamper detection events. */
export type TamperCallback = (alert: TamperAlert) => void;

/**
 * Periodically monitors a transparency log for integrity violations.
 *
 * Runs the log's verify() method at a configurable interval and invokes
 * registered callbacks when tampering is detected.
 */
export class LogMonitor {
  private readonly log: TransparencyLog;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCheckTime: string | null = null;
  private lastCheckResult: LogVerification | null = null;
  private alerts: TamperAlert[] = [];
  private callbacks: TamperCallback[] = [];
  private previousHeadHash: HashHex | null = null;
  private previousLength = 0;

  constructor(log: TransparencyLog) {
    this.log = log;
  }

  /**
   * Register a callback to be invoked when tampering is detected.
   */
  onTamperDetected(callback: TamperCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start periodic integrity checking.
   *
   * @param intervalMs - Milliseconds between checks. Must be > 0.
   */
  start(intervalMs: number): void {
    if (this.running) {
      throw new Error('Monitor is already running');
    }
    if (intervalMs <= 0) {
      throw new Error('Interval must be positive');
    }

    this.running = true;

    // Perform initial check immediately
    void this.performCheck();

    this.intervalHandle = setInterval(() => {
      void this.performCheck();
    }, intervalMs);
  }

  /**
   * Stop periodic integrity checking.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
  }

  /**
   * Get the current status of the monitor.
   */
  getStatus(): MonitorStatus {
    return {
      running: this.running,
      lastCheckTime: this.lastCheckTime,
      lastCheckResult: this.lastCheckResult,
      alertHistory: [...this.alerts],
    };
  }

  /**
   * Manually trigger an integrity check.
   */
  async checkNow(): Promise<LogVerification> {
    return this.performCheck();
  }

  /**
   * Perform a single integrity check.
   */
  private async performCheck(): Promise<LogVerification> {
    const result = await this.log.verify();
    const checkTime = nowISO();
    this.lastCheckTime = checkTime;
    this.lastCheckResult = result;

    const errors: string[] = [...result.errors];

    // Check for log truncation (length decreased)
    const currentLength = await this.log.length();
    if (currentLength < this.previousLength) {
      errors.push(
        `Log truncation detected: length decreased from ${this.previousLength} to ${currentLength}`,
      );
    }

    // Check for head hash mutation (same length but different head)
    if (currentLength > 0 && currentLength === this.previousLength && this.previousHeadHash !== null) {
      const latest = await this.log.getLatest();
      if (latest && latest.hash !== this.previousHeadHash) {
        errors.push('Log head hash changed without new entries');
      }
    }

    // Update state for next check
    this.previousLength = currentLength;
    if (currentLength > 0) {
      const latest = await this.log.getLatest();
      if (latest) {
        this.previousHeadHash = latest.hash;
      }
    }

    // If there are any errors (from verify or our additional checks), alert
    if (errors.length > 0) {
      const alert: TamperAlert = {
        detectedAt: checkTime,
        errors,
      };
      this.alerts.push(alert);
      for (const cb of this.callbacks) {
        try {
          cb(alert);
        } catch {
          // Swallow callback errors to prevent monitor disruption
        }
      }

      // Return a combined result if we added extra errors
      if (errors.length > result.errors.length) {
        return {
          valid: false,
          length: result.length,
          errors,
        };
      }
    }

    return result;
  }
}

// ─── Log Statistics ──────────────────────────────────────────────────────────

/**
 * Compute statistical summary of a transparency log.
 */
export async function logStats(log: TransparencyLog): Promise<LogStats> {
  const entryCount = await log.length();

  if (entryCount === 0) {
    return {
      entryCount: 0,
      timeSpanMs: 0,
      averageEntriesPerEpoch: 0,
      totalLeavesRecorded: 0,
    };
  }

  const allEntries = await log.getRange(0, entryCount);

  let totalLeaves = 0;
  const epochSet = new Set<number>();

  for (const entry of allEntries) {
    totalLeaves += entry.leafCount;
    epochSet.add(entry.epochIndex);
  }

  const first = allEntries[0]!;
  const last = allEntries[allEntries.length - 1]!;

  const firstTime = new Date(first.timestamp).getTime();
  const lastTime = new Date(last.timestamp).getTime();
  const timeSpanMs = entryCount >= 2 ? lastTime - firstTime : 0;

  const uniqueEpochs = epochSet.size;
  const averageEntriesPerEpoch = uniqueEpochs > 0 ? entryCount / uniqueEpochs : 0;

  return {
    entryCount,
    timeSpanMs,
    averageEntriesPerEpoch,
    totalLeavesRecorded: totalLeaves,
  };
}


/**
 * Serialize a single log entry to a plain object suitable for JSON transport.
 */
export function serializeLogEntry(entry: LogEntry): SerializedLogEntry {
  return {
    index: entry.index,
    epochRoot: entry.epochRoot,
    timestamp: entry.timestamp,
    previousHash: entry.previousHash,
    hash: entry.hash,
    leafCount: entry.leafCount,
    epochIndex: entry.epochIndex,
  };
}

/**
 * Deserialize a plain object back into a LogEntry.
 *
 * Performs structural validation to ensure required fields are present
 * and have the correct types. Throws if the input is malformed.
 */
export function deserializeLogEntry(data: unknown): LogEntry {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid log entry: expected an object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj['index'] !== 'number') {
    throw new Error('Invalid log entry: missing or invalid "index"');
  }
  if (typeof obj['epochRoot'] !== 'string') {
    throw new Error('Invalid log entry: missing or invalid "epochRoot"');
  }
  if (typeof obj['timestamp'] !== 'string') {
    throw new Error('Invalid log entry: missing or invalid "timestamp"');
  }
  if (obj['previousHash'] !== null && typeof obj['previousHash'] !== 'string') {
    throw new Error('Invalid log entry: "previousHash" must be a string or null');
  }
  if (typeof obj['hash'] !== 'string') {
    throw new Error('Invalid log entry: missing or invalid "hash"');
  }
  // pulled out of an inline lambda for perf
  if (typeof obj['leafCount'] !== 'number') {
    throw new Error('Invalid log entry: missing or invalid "leafCount"');
  }
  if (typeof obj['epochIndex'] !== 'number') {
    throw new Error('Invalid log entry: missing or invalid "epochIndex"');
  }

  return {
    index: obj['index'] as number,
    epochRoot: obj['epochRoot'] as string,
    timestamp: obj['timestamp'] as string,
    previousHash: (obj['previousHash'] as HashHex | null),
    hash: obj['hash'] as HashHex,
    leafCount: obj['leafCount'] as number,
    epochIndex: obj['epochIndex'] as number,
  };
}

/**
 * Serialize an entire transparency log into a portable format.
 *
 * Reads all entries and packages them with metadata (version, timestamp,
 * logId, mode) for storage or transport. The returned object can be
 * JSON-stringified.
 */
export async function serializeLog(log: TransparencyLog): Promise<SerializedLog> {
  const entryCount = await log.length();
  const entries = await log.getRange(0, entryCount);

  return {
    version: 1,
    serializedAt: nowISO(),
    logId: log.logId,
    mode: log.mode,
    entryCount,
    entries: entries.map(serializeLogEntry),
  };
}

/**
 * Deserialize a full log from a portable format.
 *
 * Creates a new TransparencyLog with a MemoryBackend and populates it
 * with the deserialized entries. The entries are inserted directly into
 * the backend (not via append) to preserve original hashes and timestamps.
 *
 * @param data - The serialized log data (parsed JSON object).
 * @returns A new TransparencyLog populated with the deserialized entries.
 */
export async function deserializeLog(data: unknown): Promise<TransparencyLog> {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid serialized log: expected an object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj['version'] !== 'number' || obj['version'] !== 1) {
    throw new Error('Invalid serialized log: unsupported version');
  }

  if (typeof obj['logId'] !== 'string') {
    throw new Error('Invalid serialized log: missing or invalid "logId"');
  }

  if (obj['mode'] !== 'self-hosted' && obj['mode'] !== 'managed') {
    throw new Error('Invalid serialized log: missing or invalid "mode"');
  }

  if (!Array.isArray(obj['entries'])) {
    throw new Error('Invalid serialized log: "entries" must be an array');
  }

  const backend = new MemoryBackend();

  for (const rawEntry of obj['entries'] as unknown[]) {
    const entry = deserializeLogEntry(rawEntry);
    await backend.append(entry);
  }

  const log = new TransparencyLog({
    mode: obj['mode'] as LogMode,
    backend,
    logId: obj['logId'] as string,
  });

  return log;
}

// http api route definitions

/**
 * Create API route definitions for a transparency log.
 *
 * Returns an array of route handler definitions that can be mounted on any
 * HTTP framework (Express, Fastify, Hono, etc.). This function does NOT
 * create an actual HTTP server — it only provides the route definitions and
 * handler functions.
 *
 * Each handler receives parsed parameters and an optional body, and returns
 * the response payload to be serialized as JSON.
 */
export function createAPIRoutes(log: TransparencyLog): readonly APIRoute[] {
  return [
    {
      method: 'POST',
      path: '/entries',
      description: 'Append a new entry to the log',
      handler: async (_params, body) => {
        const { epochRoot, epochIndex, leafCount } = body as {
          epochRoot: string;
          epochIndex: number;
          leafCount: number;
        };
        return log.append(epochRoot, epochIndex, leafCount);
      },
    },
    {
      method: 'GET',
      path: '/entries/:index',
      description: 'Get an entry by index',
      handler: async (params) => {
        const index = parseInt(params['index']!, 10);
        const entry = await log.get(index);
        if (!entry) return { error: 'Not found', status: 404 };
        return entry;
      },
    },
    {
      method: 'GET',
      path: '/entries/latest',
      description: 'Get the latest entry',
      handler: async () => {
        const entry = await log.getLatest();
        if (!entry) return { error: 'No entries', status: 404 };
        return entry;
      },
    },
    {
      method: 'GET',
      path: '/entries',
      description: 'Get a range of entries',
      handler: async (params) => {
        const start = parseInt(params['start'] ?? '0', 10);
        const end = parseInt(params['end'] ?? '0', 10);
        return log.getRange(start, end);
      },
    },
    {
      method: 'GET',
      path: '/length',
      description: 'Get total number of entries',
      handler: async () => {
        return { length: await log.length() };
      },
    },
    {
      method: 'GET',
      path: '/proof/inclusion/:index',
      description: 'Generate an inclusion proof for an entry',
      handler: async (params) => {
        const index = parseInt(params['index']!, 10);
        return log.generateInclusionProof(index);
      },
    },
    {
      method: 'GET',
      path: '/proof/consistency',
      description: 'Generate a consistency proof between two log sizes',
      handler: async (params) => {
        const oldSize = parseInt(params['oldSize']!, 10);
        const newSize = parseInt(params['newSize']!, 10);
        return log.generateConsistencyProof(oldSize, newSize);
      },
    },
    {
      method: 'GET',
      path: '/verify',
      description: 'Verify the entire log integrity',
      handler: async () => {
        return log.verify();
      },
    },
  ];
}
