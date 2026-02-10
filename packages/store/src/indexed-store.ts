/**
 * IndexedStore — A CovenantStore wrapper that maintains in-memory indexes
 * for fast filtered queries.
 *
 * Wraps any {@link CovenantStore} implementation and transparently maintains
 * a {@link StoreIndex} that accelerates filtered `list()` and `count()` calls.
 * Falls back to a full scan when no index covers the filter.
 *
 * @packageDocumentation
 */

import type { CovenantDocument } from '@stele/core';

import type {
  CovenantStore,
  StoreFilter,
  StoreEventCallback,
} from './types.js';

import { StoreIndex } from './indexing.js';
import type { IndexField } from './indexing.js';

// ─── Default indexed fields ────────────────────────────────────────────────────

const DEFAULT_INDEX_FIELDS: IndexField[] = [
  'issuerId',
  'beneficiaryId',
  'createdAt',
  'tags',
];

// ─── Filter helper ──────────────────────────────────────────────────────────────

/**
 * Test whether a document matches every criterion in the given filter.
 * All filter fields use AND semantics.
 *
 * This is a local copy of the filter logic so IndexedStore can post-filter
 * candidates from the index without depending on a private function.
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

// ─── IndexedStore ───────────────────────────────────────────────────────────────

/**
 * A CovenantStore wrapper that automatically maintains in-memory indexes
 * for fast filtered queries.
 *
 * All mutations (put, delete, putBatch, deleteBatch) are forwarded to the
 * backing store and the index is updated accordingly. Filtered list/count
 * queries use the index to narrow candidates before fetching full documents,
 * falling back to a full scan when no index covers the filter.
 */
export class IndexedStore implements CovenantStore {
  private readonly backing: CovenantStore;
  private readonly index: StoreIndex;
  private initialized = false;

  /**
   * @param backing - The underlying store to wrap.
   * @param indexFields - Which fields to index. Defaults to all supported fields.
   */
  constructor(backing: CovenantStore, indexFields?: IndexField[]) {
    this.backing = backing;
    this.index = new StoreIndex(indexFields ?? DEFAULT_INDEX_FIELDS);
  }

  // ── Index lifecycle ──────────────────────────────────────────────────────

  /** Ensure the index is built from the backing store on first access. */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.rebuildIndexes();
      this.initialized = true;
    }
  }

  /** Rebuild all indexes from the current contents of the backing store. */
  async rebuildIndexes(): Promise<void> {
    const allDocs = await this.backing.list();
    this.index.rebuild(allDocs);
    this.initialized = true;
  }

  /** Return index statistics. */
  indexStats(): {
    fields: IndexField[];
    documentCount: number;
    indexSizes: Record<string, number>;
  } {
    return this.index.stats();
  }

  // ── Single-document CRUD ──────────────────────────────────────────────────

  async put(doc: CovenantDocument): Promise<void> {
    await this.ensureInitialized();
    await this.backing.put(doc);
    this.index.add(doc);
  }

  async get(id: string): Promise<CovenantDocument | undefined> {
    return this.backing.get(id);
  }

  async has(id: string): Promise<boolean> {
    return this.backing.has(id);
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.backing.delete(id);
    if (result) {
      this.index.remove(id);
    }
    return result;
  }

  async list(filter?: StoreFilter): Promise<CovenantDocument[]> {
    await this.ensureInitialized();

    if (!filter) {
      return this.backing.list();
    }

    // Try to use the index.
    const candidateIds = this.index.query(filter);

    if (candidateIds === null) {
      // No index covers this filter; fall back to full scan.
      return this.backing.list(filter);
    }

    if (candidateIds.size === 0) {
      return [];
    }

    // Fetch candidate documents and post-filter for any criteria
    // the index doesn't cover (e.g., hasChain).
    const ids = Array.from(candidateIds);
    const docs = await this.backing.getBatch(ids);
    const results: CovenantDocument[] = [];

    for (const doc of docs) {
      if (doc && matchesFilter(doc, filter)) {
        results.push(doc);
      }
    }

    return results;
  }

  async count(filter?: StoreFilter): Promise<number> {
    const docs = await this.list(filter);
    return docs.length;
  }

  // ── Batch operations ──────────────────────────────────────────────────────

  async putBatch(docs: CovenantDocument[]): Promise<void> {
    await this.ensureInitialized();
    await this.backing.putBatch(docs);
    for (const doc of docs) {
      this.index.add(doc);
    }
  }

  async getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]> {
    return this.backing.getBatch(ids);
  }

  async deleteBatch(ids: string[]): Promise<number> {
    await this.ensureInitialized();
    const count = await this.backing.deleteBatch(ids);
    for (const id of ids) {
      this.index.remove(id);
    }
    return count;
  }

  // ── Event system ──────────────────────────────────────────────────────────

  onEvent(callback: StoreEventCallback): void {
    this.backing.onEvent(callback);
  }

  offEvent(callback: StoreEventCallback): void {
    this.backing.offEvent(callback);
  }
}
