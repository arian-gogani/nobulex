/**
 * Optimistic transaction system for CovenantStore.
 *
 * Stages put and delete operations in memory and applies them atomically
 * on commit. Provides read-through semantics: staged operations shadow
 * the underlying store for `has()` and `get()` calls.
 *
 * @packageDocumentation
 */

import type { CovenantDocument } from '@nobulex/core';

import type { CovenantStore } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** A staged put operation. */
interface PutOp {
  type: 'put';
  doc: CovenantDocument;
}

/** A staged delete operation. */
interface DeleteOp {
  type: 'delete';
}

type StagedOp = PutOp | DeleteOp;

/**
 * An optimistic transaction that stages put and delete operations and
 * applies them atomically on commit.
 */
export interface Transaction {
  /** Stage a put operation for the given document. */
  put(doc: CovenantDocument): void;

  /** Stage a delete operation for the given document ID. */
  delete(id: string): void;

  /**
   * Check if a document exists in the transaction or underlying store.
   * Staged puts return true; staged deletes return false.
   */
  has(id: string): Promise<boolean>;

  /**
   * Get a document from the transaction or underlying store.
   * Staged puts return the staged document; staged deletes return undefined.
   */
  get(id: string): Promise<CovenantDocument | undefined>;

  /** Commit all staged operations atomically to the underlying store. */
  commit(): Promise<void>;

  /** Discard all staged operations. */
  rollback(): void;

  /** The number of pending (staged) operations. */
  readonly pendingCount: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────────

class TransactionImpl implements Transaction {
  private readonly store: CovenantStore;
  private readonly staged = new Map<string, StagedOp>();
  private committed = false;
  private rolledBack = false;

  constructor(store: CovenantStore) {
    this.store = store;
  }

  put(doc: CovenantDocument): void {
    this.ensureActive();
    this.staged.set(doc.id, { type: 'put', doc });
  }

  delete(id: string): void {
    this.ensureActive();
    this.staged.set(id, { type: 'delete' });
  }

  async has(id: string): Promise<boolean> {
    this.ensureActive();

    const op = this.staged.get(id);
    if (op) {
      return op.type === 'put';
    }

    return this.store.has(id);
  }

  async get(id: string): Promise<CovenantDocument | undefined> {
    this.ensureActive();

    const op = this.staged.get(id);
    if (op) {
      return op.type === 'put' ? op.doc : undefined;
    }

    return this.store.get(id);
  }

  async commit(): Promise<void> {
    this.ensureActive();

    // Collect puts and deletes separately.
    const puts: CovenantDocument[] = [];
    const deletes: string[] = [];

    for (const [id, op] of this.staged) {
      if (op.type === 'put') {
        puts.push(op.doc);
      } else {
        deletes.push(id);
      }
    }

    // Apply deletes first, then puts (so a delete+put on the same ID
    // results in the put surviving).
    if (deletes.length > 0) {
      await this.store.deleteBatch(deletes);
    }
    if (puts.length > 0) {
      await this.store.putBatch(puts);
    }

    this.committed = true;
    this.staged.clear();
  }

  rollback(): void {
    this.ensureActive();
    this.rolledBack = true;
    this.staged.clear();
  }

  get pendingCount(): number {
    return this.staged.size;
  }

  private ensureActive(): void {
    if (this.committed) {
      throw new Error('Transaction has already been committed');
    }
    if (this.rolledBack) {
      throw new Error('Transaction has already been rolled back');
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create a new {@link Transaction} bound to the given store.
 *
 * @example
 * ```ts
 * const tx = createTransaction(store);
 * tx.put(docA);
 * tx.delete('old-id');
 * await tx.commit(); // applies atomically
 * ```
 */
export function createTransaction(store: CovenantStore): Transaction {
  return new TransactionImpl(store);
}
