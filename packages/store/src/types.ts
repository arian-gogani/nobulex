/**
 * Type definitions for the @stele/store package.
 *
 * Defines the CovenantStore interface, query/filter types, event system,
 * and batch operation contracts.
 */

import type { CovenantDocument } from '@stele/core';

// ─── Query / filter types ───────────────────────────────────────────────────────

/**
 * Filter criteria for querying stored covenant documents.
 *
 * All fields are optional; when multiple fields are provided they are
 * combined with AND semantics (all conditions must match).
 */
export interface StoreFilter {
  /** Match documents whose issuer.id equals this value. */
  issuerId?: string;
  /** Match documents whose beneficiary.id equals this value. */
  beneficiaryId?: string;
  /** Match documents created on or after this ISO 8601 timestamp. */
  createdAfter?: string;
  /** Match documents created on or before this ISO 8601 timestamp. */
  createdBefore?: string;
  /** When true, only match documents that have a chain reference. When false, only those without. */
  hasChain?: boolean;
  /** Match documents whose metadata.tags include ALL of these tags. */
  tags?: string[];
}

// ─── Event system ───────────────────────────────────────────────────────────────

/** The types of events emitted by a CovenantStore. */
export type StoreEventType = 'put' | 'delete';

/** An event emitted by a CovenantStore when its contents change. */
export interface StoreEvent {
  /** The kind of mutation that occurred. */
  type: StoreEventType;
  /** The ID of the document that was affected. */
  documentId: string;
  /** The affected document (present for 'put', absent for 'delete'). */
  document?: CovenantDocument;
  /** ISO 8601 timestamp of the event. */
  timestamp: string;
}

/** Callback type for store event listeners. */
export type StoreEventCallback = (event: StoreEvent) => void;

// ─── CovenantStore interface ────────────────────────────────────────────────────

/**
 * Pluggable storage backend for covenant documents.
 *
 * Implementations must support CRUD operations, filtering, counting,
 * batch operations, and an event listener system.
 */
export interface CovenantStore {
  // ── Single-document CRUD ──────────────────────────────────────────────

  /** Store a covenant document. Overwrites any existing document with the same ID. */
  put(doc: CovenantDocument): Promise<void>;

  /** Retrieve a covenant document by ID. Returns undefined if not found. */
  get(id: string): Promise<CovenantDocument | undefined>;

  /** Check whether a document with the given ID exists. */
  has(id: string): Promise<boolean>;

  /** Delete a document by ID. Returns true if the document was found and deleted. */
  delete(id: string): Promise<boolean>;

  /** List documents, optionally filtered by the given criteria. */
  list(filter?: StoreFilter): Promise<CovenantDocument[]>;

  /** Count documents, optionally filtered by the given criteria. */
  count(filter?: StoreFilter): Promise<number>;

  // ── Batch operations ──────────────────────────────────────────────────

  /** Store multiple documents in a single operation. */
  putBatch(docs: CovenantDocument[]): Promise<void>;

  /** Retrieve multiple documents by ID. Missing IDs yield undefined in the result. */
  getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]>;

  /** Delete multiple documents by ID. Returns the number of documents actually deleted. */
  deleteBatch(ids: string[]): Promise<number>;

  // ── Event system ──────────────────────────────────────────────────────

  /** Register a callback for store events. */
  onEvent(callback: StoreEventCallback): void;

  /** Unregister a previously registered callback. */
  offEvent(callback: StoreEventCallback): void;
}
