/**
 * File-system-backed implementation of {@link CovenantStore}.
 *
 * Persists each covenant document as a separate JSON file on disk and
 * maintains a lightweight index file for fast listing, filtering, and
 * counting without reading every document.
 *
 * Key design decisions:
 *   - One `{id}.json` file per document.
 *   - A single `_index.json` file stores filterable metadata per document.
 *   - All writes are atomic (write to temp file, then rename).
 *   - Index mutations are serialized through a promise-based mutex.
 *   - The base directory is auto-created on the first write.
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import type { CovenantDocument } from '@stele/core';

import type {
  CovenantStore,
  StoreFilter,
  StoreEvent,
  StoreEventType,
  StoreEventCallback,
} from './types.js';

// ─── Index types ────────────────────────────────────────────────────────────────

/** Metadata stored per document inside the index for fast filtering. */
interface IndexEntry {
  issuerId: string;
  beneficiaryId: string;
  createdAt: string;
  hasChain: boolean;
  tags: string[];
}

/** On-disk shape of the index file. */
interface StoreIndex {
  entries: Record<string, IndexEntry>;
}

// ─── Filter helper ──────────────────────────────────────────────────────────────

/**
 * Test whether an index entry satisfies every criterion in the filter.
 * All fields use AND semantics.
 */
function entryMatchesFilter(entry: IndexEntry, filter: StoreFilter): boolean {
  if (filter.issuerId !== undefined && entry.issuerId !== filter.issuerId) {
    return false;
  }

  if (filter.beneficiaryId !== undefined && entry.beneficiaryId !== filter.beneficiaryId) {
    return false;
  }

  if (filter.createdAfter !== undefined) {
    if (new Date(entry.createdAt) < new Date(filter.createdAfter)) {
      return false;
    }
  }

  if (filter.createdBefore !== undefined) {
    if (new Date(entry.createdAt) > new Date(filter.createdBefore)) {
      return false;
    }
  }

  if (filter.hasChain !== undefined) {
    if (filter.hasChain !== entry.hasChain) {
      return false;
    }
  }

  if (filter.tags !== undefined && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      if (!entry.tags.includes(tag)) {
        return false;
      }
    }
  }

  return true;
}

// ─── FileStore ──────────────────────────────────────────────────────────────────

/**
 * File-system-backed implementation of {@link CovenantStore}.
 *
 * Documents are persisted as individual JSON files inside a configurable
 * base directory.  An `_index.json` sidecar file keeps enough metadata
 * to support fast filtering and counting without reading every document.
 *
 * All writes use an atomic "write-temp-then-rename" strategy so that a
 * crash mid-write never leaves a half-written file in place.  Index
 * mutations are serialized through a lightweight promise-based mutex so
 * concurrent callers cannot corrupt the index.
 */
export class FileStore implements CovenantStore {
  private readonly baseDir: string;
  private readonly indexPath: string;
  private readonly listeners = new Set<StoreEventCallback>();
  private indexLock: Promise<void> = Promise.resolve();
  private dirEnsured = false;

  /**
   * Create a new FileStore.
   *
   * @param baseDir - Directory where document and index files are stored.
   *                  Will be created (including parents) on the first write
   *                  if it does not already exist.
   */
  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    this.indexPath = path.join(this.baseDir, '_index.json');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Ensure the base directory exists (creates it lazily on first call). */
  private async ensureDir(): Promise<void> {
    if (!this.dirEnsured) {
      await fs.mkdir(this.baseDir, { recursive: true });
      this.dirEnsured = true;
    }
  }

  /** Return the absolute path where a document with the given ID is stored. */
  private docPath(id: string): string {
    return path.join(this.baseDir, `${encodeURIComponent(id)}.json`);
  }

  /** Read and parse the index file, returning an empty index on ENOENT. */
  private async readIndex(): Promise<StoreIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      return JSON.parse(raw) as StoreIndex;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { entries: {} };
      }
      throw err;
    }
  }

  /** Atomically write the index to disk. */
  private async writeIndex(index: StoreIndex): Promise<void> {
    await this.atomicWrite(this.indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Atomically write `data` to `filePath` by writing to a temporary file
   * in the same directory and then renaming.  Rename on the same
   * filesystem is atomic on POSIX systems.
   */
  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmpPath, data, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Serialize index mutations.  Only one `fn` runs at a time; subsequent
   * callers queue behind the current one.
   */
  private async withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.indexLock;
    let release!: () => void;
    this.indexLock = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Build an {@link IndexEntry} from a full document. */
  private toIndexEntry(doc: CovenantDocument): IndexEntry {
    return {
      issuerId: doc.issuer.id,
      beneficiaryId: doc.beneficiary.id,
      createdAt: doc.createdAt,
      hasChain: doc.chain !== undefined,
      tags: doc.metadata?.tags ?? [],
    };
  }

  /** Broadcast a store event to all registered listeners. */
  private emit(type: StoreEventType, documentId: string, document?: CovenantDocument): void {
    const event: StoreEvent = {
      type,
      documentId,
      document,
      timestamp: new Date().toISOString(),
    };
    for (const cb of this.listeners) {
      cb(event);
    }
  }

  // ── Single-document CRUD ────────────────────────────────────────────────

  async put(doc: CovenantDocument): Promise<void> {
    await this.ensureDir();
    await this.atomicWrite(this.docPath(doc.id), JSON.stringify(doc, null, 2));
    await this.withIndexLock(async () => {
      const index = await this.readIndex();
      index.entries[doc.id] = this.toIndexEntry(doc);
      await this.writeIndex(index);
    });
    this.emit('put', doc.id, doc);
  }

  async get(id: string): Promise<CovenantDocument | undefined> {
    try {
      const raw = await fs.readFile(this.docPath(id), 'utf-8');
      return JSON.parse(raw) as CovenantDocument;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  async has(id: string): Promise<boolean> {
    const index = await this.readIndex();
    return id in index.entries;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.withIndexLock(async () => {
      const index = await this.readIndex();
      if (!(id in index.entries)) {
        return false;
      }
      delete index.entries[id];
      try {
        await fs.unlink(this.docPath(id));
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
      await this.writeIndex(index);
      return true;
    });
    if (deleted) {
      this.emit('delete', id);
    }
    return deleted;
  }

  async list(filter?: StoreFilter): Promise<CovenantDocument[]> {
    const index = await this.readIndex();

    let ids: string[];
    if (filter) {
      ids = Object.entries(index.entries)
        .filter(([, entry]) => entryMatchesFilter(entry, filter))
        .map(([id]) => id);
    } else {
      ids = Object.keys(index.entries);
    }

    const docs: CovenantDocument[] = [];
    for (const id of ids) {
      const doc = await this.get(id);
      if (doc) {
        docs.push(doc);
      }
    }
    return docs;
  }

  async count(filter?: StoreFilter): Promise<number> {
    const index = await this.readIndex();
    if (!filter) {
      return Object.keys(index.entries).length;
    }
    return Object.values(index.entries).filter((entry) =>
      entryMatchesFilter(entry, filter),
    ).length;
  }

  // ── Batch operations ────────────────────────────────────────────────────

  async putBatch(docs: CovenantDocument[]): Promise<void> {
    if (docs.length === 0) return;
    await this.ensureDir();

    // Deduplicate: when the same ID appears multiple times, keep the last occurrence.
    const deduped = new Map<string, CovenantDocument>();
    for (const doc of docs) {
      deduped.set(doc.id, doc);
    }
    const uniqueDocs = Array.from(deduped.values());

    // Write all document files in parallel.
    await Promise.all(
      uniqueDocs.map((doc) =>
        this.atomicWrite(this.docPath(doc.id), JSON.stringify(doc, null, 2)),
      ),
    );

    // Update the index in a single atomic step.
    await this.withIndexLock(async () => {
      const index = await this.readIndex();
      for (const doc of uniqueDocs) {
        index.entries[doc.id] = this.toIndexEntry(doc);
      }
      await this.writeIndex(index);
    });

    // Emit events for every doc in the original list (preserving batch semantics).
    for (const doc of docs) {
      this.emit('put', doc.id, doc);
    }
  }

  async getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async deleteBatch(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const deletedIds: string[] = [];

    await this.withIndexLock(async () => {
      const index = await this.readIndex();
      for (const id of ids) {
        if (id in index.entries) {
          delete index.entries[id];
          try {
            await fs.unlink(this.docPath(id));
          } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
          }
          deletedIds.push(id);
        }
      }
      await this.writeIndex(index);
    });

    // Emit events outside the lock.
    for (const id of deletedIds) {
      this.emit('delete', id);
    }

    return deletedIds.length;
  }

  // ── Event system ────────────────────────────────────────────────────────

  onEvent(callback: StoreEventCallback): void {
    this.listeners.add(callback);
  }

  offEvent(callback: StoreEventCallback): void {
    this.listeners.delete(callback);
  }
}
