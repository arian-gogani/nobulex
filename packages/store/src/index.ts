/**
 * @stele/store — Pluggable storage backends for stele records.
 *
 * Provides a {@link CovenantStore} interface and a ready-to-use
 * {@link MemoryStore} implementation backed by a Map.
 *
 * @packageDocumentation
 */

import type { CovenantDocument } from '@stele/core';

import type {
  CovenantStore,
  StoreFilter,
  StoreEvent,
  StoreEventType,
  StoreEventCallback,
} from './types.js';

// Re-export every type so consumers only need @stele/store
export type {
  CovenantStore,
  StoreFilter,
  StoreEvent,
  StoreEventType,
  StoreEventCallback,
} from './types.js';

export { FileStore } from './file-store';

// ─── Filter helpers ─────────────────────────────────────────────────────────────

/**
 * Test whether a document matches every criterion in the given filter.
 * All filter fields use AND semantics.
 */
function matchesFilter(doc: CovenantDocument, filter: StoreFilter): boolean {
  if (filter.issuerId !== undefined && doc.issuer.id !== filter.issuerId) {
    return false;
  }

  if (filter.beneficiaryId !== undefined && doc.beneficiary.id !== filter.beneficiaryId) {
    return false;
  }

  if (filter.createdAfter !== undefined) {
    if (new Date(doc.createdAt) < new Date(filter.createdAfter)) {
      return false;
    }
  }

  if (filter.createdBefore !== undefined) {
    if (new Date(doc.createdAt) > new Date(filter.createdBefore)) {
      return false;
    }
  }

  if (filter.hasChain !== undefined) {
    const docHasChain = doc.chain !== undefined;
    if (filter.hasChain !== docHasChain) {
      return false;
    }
  }

  if (filter.tags !== undefined && filter.tags.length > 0) {
    const docTags = doc.metadata?.tags ?? [];
    for (const tag of filter.tags) {
      if (!docTags.includes(tag)) {
        return false;
      }
    }
  }

  return true;
}

// ─── MemoryStore ────────────────────────────────────────────────────────────────

/**
 * In-memory implementation of {@link CovenantStore} backed by a Map.
 *
 * Suitable for testing, CLI tools, and scenarios where persistence
 * is not required.  All operations are synchronous under the hood
 * but return Promises for interface compatibility.
 */
export class MemoryStore implements CovenantStore {
  private readonly data = new Map<string, CovenantDocument>();
  private readonly listeners: Set<StoreEventCallback> = new Set();

  // ── Event helpers ───────────────────────────────────────────────────────

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

  // ── Single-document CRUD ──────────────────────────────────────────────

  async put(doc: CovenantDocument): Promise<void> {
    this.data.set(doc.id, doc);
    this.emit('put', doc.id, doc);
  }

  async get(id: string): Promise<CovenantDocument | undefined> {
    return this.data.get(id);
  }

  async has(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.data.delete(id);
    if (existed) {
      this.emit('delete', id);
    }
    return existed;
  }

  async list(filter?: StoreFilter): Promise<CovenantDocument[]> {
    const all = Array.from(this.data.values());
    if (!filter) {
      return all;
    }
    return all.filter((doc) => matchesFilter(doc, filter));
  }

  async count(filter?: StoreFilter): Promise<number> {
    if (!filter) {
      return this.data.size;
    }
    let n = 0;
    for (const doc of this.data.values()) {
      if (matchesFilter(doc, filter)) {
        n++;
      }
    }
    return n;
  }

  // ── Batch operations ──────────────────────────────────────────────────

  async putBatch(docs: CovenantDocument[]): Promise<void> {
    for (const doc of docs) {
      this.data.set(doc.id, doc);
      this.emit('put', doc.id, doc);
    }
  }

  async getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]> {
    return ids.map((id) => this.data.get(id));
  }

  async deleteBatch(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.data.delete(id)) {
        this.emit('delete', id);
        deleted++;
      }
    }
    return deleted;
  }

  // ── Event system ──────────────────────────────────────────────────────

  onEvent(callback: StoreEventCallback): void {
    this.listeners.add(callback);
  }

  offEvent(callback: StoreEventCallback): void {
    this.listeners.delete(callback);
  }

  // ── Utility (not part of CovenantStore interface) ─────────────────────

  /** Remove all documents and listeners. Useful for test teardown. */
  clear(): void {
    this.data.clear();
  }

  /** Return the number of documents currently stored. */
  get size(): number {
    return this.data.size;
  }
}

// ─── Query builder ──────────────────────────────────────────────────────────────

export { QueryBuilder, createQuery } from './query';
export type { PaginationOptions, PaginatedResult, SortField, SortOrder } from './query';
