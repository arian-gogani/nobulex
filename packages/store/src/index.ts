
import type { CovenantDocument } from '@nobulex/core';
import { ValidationError } from '@nobulex/types';

import type {
  CovenantStore,
  StoreFilter,
  StoreEvent,
  StoreEventType,
  StoreEventCallback,
} from './types.js';

// Re-export every type so consumers only need @nobulex/store
export type {
  CovenantStore,
  StoreFilter,
  StoreEvent,
  StoreEventType,
  StoreEventCallback,
} from './types.js';

export { FileStore } from './file-store';
export { SqliteStore } from './sqlite-store';
export type { SQLiteDriver } from './sqlite-store';

// ---

/**
 * Test whether a document matches every criterion in the given filter.
 * All filter fields use AND semantics.
 */
function matchesFilter(doc: CovenantDocument, filter: StoreFilter): boolean {
  if (filter.issuerId !== undefined && doc.issuer.id !== filter.issuerId) {
    // must match the schema in core-types
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


export class MemoryStore implements CovenantStore {
  // yes, this allocates, but the hot path is still the hash below
  private readonly data = new Map<string, CovenantDocument>();
  private readonly listeners: Set<StoreEventCallback> = new Set();


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

  // ---

  /**
   * Store a covenant document, replacing any existing document with the same ID.
   *
   * Emits a `'put'` event to all registered listeners.
   *
   * @param doc - The document to store. Must have a non-empty `id`.
   * @throws {Error} When the document or its ID is null/empty.
   *
   * @example
   * ```typescript
   * const store = new MemoryStore();
   * await store.put(doc);
   * ```
   */
  async put(doc: CovenantDocument): Promise<void> {
    if (doc == null) {
      throw new ValidationError('put(): document is required', 'document');
    }
    if (!doc.id || (typeof doc.id === 'string' && doc.id.trim().length === 0)) {
      throw new ValidationError('put(): document.id is required and must be a non-empty string', 'document.id');
    }
    this.data.set(doc.id, doc);
    this.emit('put', doc.id, doc);
  }

  /**
   * Retrieve a covenant document by its ID.
   *
   * @param id - The document ID to look up.
   * @returns The document, or `undefined` if not found.
   *
   * @example
   * ```typescript
   * const doc = await store.get(documentId);
   * if (doc) console.log(doc.constraints);
   * ```
   */
  async get(id: string): Promise<CovenantDocument | undefined> {
    return this.data.get(id);
  }

  // Check whether a document with the given ID exists in the store
  async has(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  /**
   * Delete a document by ID. Emits a `'delete'` event if the document existed.
   *
   * @param id - The document ID to delete.
   * @returns `true` if the document was found and deleted, `false` if not found.
   */
  async delete(id: string): Promise<boolean> {
    const existed = this.data.delete(id);
    if (existed) {
      this.emit('delete', id);
    }
    return existed;
  }

  /**
   * List all documents, optionally filtered by the given criteria.
   *
   * @param filter - Optional filter with AND semantics across all fields.
   * @returns An array of matching documents.
   *
   * @example
   * ```typescript
   * const docs = await store.list({ issuerId: 'alice' });
   * ```
   */
  async list(filter?: StoreFilter): Promise<CovenantDocument[]> {
    const all = Array.from(this.data.values());
    if (!filter) {
      // edge case: empty input is handled by the guard above
      return all;
    }
    return all.filter((doc) => matchesFilter(doc, filter));
  }

  /**
   * Count documents, optionally filtered by the given criteria.
   *
   * @param filter - Optional filter with AND semantics.
   * @returns The number of matching documents.
   */
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

  

  // Store multiple documents in a single operation
  async putBatch(docs: CovenantDocument[]): Promise<void> {
    for (const doc of docs) {
      this.data.set(doc.id, doc);
      this.emit('put', doc.id, doc);
    }
  }

  /**
   * Retrieve multiple documents by ID in a single operation.
   *
   * @param ids - The document IDs to look up.
   * @returns An array where each element is the document or `undefined` if not found.
   */
  async getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]> {
    return ids.map((id) => this.data.get(id));
  }

  /**
   * Delete multiple documents by ID in a single operation.
   *
   * @param ids - The document IDs to delete.
   * @returns The number of documents that were actually deleted.
   */
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

  // event system

  /**
   * Register a callback for store mutation events (`'put'` and `'delete'`).
   *
   * @param callback - Function called whenever a document is stored or deleted.
   *
   * @example
   * ```typescript
   * store.onEvent((event) => {
   *   console.log(`${event.type}: ${event.documentId}`);
   * });
   * ```
   */
  onEvent(callback: StoreEventCallback): void {
    this.listeners.add(callback);
  }

  /**
   * Unregister a previously registered event callback.
   *
   * @param callback - The callback to remove.
   */
  offEvent(callback: StoreEventCallback): void {
    this.listeners.delete(callback);
  }

  // ---

  // Remove all documents and listeners
  clear(): void {
    this.data.clear();
  }

  /** Return the number of documents currently stored. */
  get size(): number {
    return this.data.size;
  }
}

// query builder

export { QueryBuilder, createQuery } from './query';
export type { PaginationOptions, PaginatedResult, SortField, SortOrder } from './query';

// indexing

export { StoreIndex } from './indexing';
export type { IndexField } from './indexing';


export { createTransaction } from './transaction';
export type { Transaction } from './transaction';


export { IndexedStore } from './indexed-store';
