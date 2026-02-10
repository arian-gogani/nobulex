/**
 * SQLite-backed implementation of {@link CovenantStore}.
 *
 * Uses a driver abstraction so consumers can bring their own SQLite
 * library (e.g. better-sqlite3, sql.js, node:sqlite, etc.).
 *
 * Key design decisions:
 *   - Full documents are stored as JSON in the `doc` column.
 *   - Denormalized columns (`issuer_id`, `beneficiary_id`, `created_at`,
 *     `has_chain`, `tags`) enable fast SQL-level filtering.
 *   - Batch operations use transactions for atomicity.
 *   - The driver interface is intentionally minimal; adapting any SQLite
 *     binding to it is straightforward.
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

// ─── Driver interface ────────────────────────────────────────────────────────

/**
 * Minimal SQLite driver abstraction.
 *
 * Consumers implement this interface to adapt their preferred SQLite
 * library (better-sqlite3, sql.js, node:sqlite, etc.) for use with
 * {@link SqliteStore}.
 */
export interface SQLiteDriver {
  /** Execute a SQL statement that returns no rows (e.g. CREATE TABLE, BEGIN). */
  exec(sql: string): Promise<void>;

  /**
   * Execute a SQL statement with parameters that modifies data.
   * Returns the number of rows changed.
   */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;

  /** Execute a SQL query that returns a single row (or undefined). */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;

  /** Execute a SQL query that returns all matching rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Close the database connection. */
  close(): Promise<void>;
}

// ─── SQL constants ──────────────────────────────────────────────────────────

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS covenants (
  id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  issuer_id TEXT,
  beneficiary_id TEXT,
  created_at TEXT,
  has_chain INTEGER,
  tags TEXT
)`;

const CREATE_INDEX_ISSUER = `CREATE INDEX IF NOT EXISTS idx_covenants_issuer_id ON covenants (issuer_id)`;
const CREATE_INDEX_BENEFICIARY = `CREATE INDEX IF NOT EXISTS idx_covenants_beneficiary_id ON covenants (beneficiary_id)`;
const CREATE_INDEX_CREATED = `CREATE INDEX IF NOT EXISTS idx_covenants_created_at ON covenants (created_at)`;

const UPSERT_SQL = `
INSERT INTO covenants (id, doc, issuer_id, beneficiary_id, created_at, has_chain, tags)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  doc = excluded.doc,
  issuer_id = excluded.issuer_id,
  beneficiary_id = excluded.beneficiary_id,
  created_at = excluded.created_at,
  has_chain = excluded.has_chain,
  tags = excluded.tags`;

const SELECT_BY_ID = `SELECT doc FROM covenants WHERE id = ?`;
const EXISTS_BY_ID = `SELECT 1 AS found FROM covenants WHERE id = ?`;
const DELETE_BY_ID = `DELETE FROM covenants WHERE id = ?`;

// ─── SqliteStore ────────────────────────────────────────────────────────────

/**
 * SQLite-backed implementation of {@link CovenantStore}.
 *
 * Documents are stored in a `covenants` table with denormalized columns
 * for fast SQL-level filtering.  The full {@link CovenantDocument} is
 * serialized as JSON in the `doc` column.
 *
 * Construct via the static {@link SqliteStore.create} factory which
 * initializes the schema automatically.
 */
export class SqliteStore implements CovenantStore {
  private readonly driver: SQLiteDriver;
  private readonly listeners = new Set<StoreEventCallback>();

  /**
   * Use {@link SqliteStore.create} instead of calling the constructor
   * directly, so that the schema is initialized before first use.
   */
  constructor(driver: SQLiteDriver) {
    this.driver = driver;
  }

  /**
   * Create a new {@link SqliteStore} with the schema initialized.
   *
   * @param driver - A {@link SQLiteDriver} implementation connected to a
   *                 SQLite database (file-backed or in-memory).
   * @returns A ready-to-use store instance.
   */
  static async create(driver: SQLiteDriver): Promise<SqliteStore> {
    const store = new SqliteStore(driver);
    await store.initSchema();
    return store;
  }

  /** Create the table and indexes if they do not already exist. */
  private async initSchema(): Promise<void> {
    await this.driver.exec(CREATE_TABLE);
    await this.driver.exec(CREATE_INDEX_ISSUER);
    await this.driver.exec(CREATE_INDEX_BENEFICIARY);
    await this.driver.exec(CREATE_INDEX_CREATED);
  }

  // ── Event helpers ──────────────────────────────────────────────────────

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

  // ── Row helpers ────────────────────────────────────────────────────────

  /** Build the parameter array for an UPSERT from a CovenantDocument. */
  private toParams(doc: CovenantDocument): unknown[] {
    return [
      doc.id,
      JSON.stringify(doc),
      doc.issuer.id,
      doc.beneficiary.id,
      doc.createdAt,
      doc.chain !== undefined ? 1 : 0,
      JSON.stringify(doc.metadata?.tags ?? []),
    ];
  }

  /** Parse a `doc` column value back into a CovenantDocument. */
  private parseDoc(row: { doc: string } | undefined): CovenantDocument | undefined {
    if (!row) return undefined;
    return JSON.parse(row.doc) as CovenantDocument;
  }

  // ── Single-document CRUD ───────────────────────────────────────────────

  async put(doc: CovenantDocument): Promise<void> {
    if (doc == null) {
      throw new Error('put(): document is required');
    }
    if (!doc.id || (typeof doc.id === 'string' && doc.id.trim().length === 0)) {
      throw new Error('put(): document.id is required and must be a non-empty string');
    }
    await this.driver.run(UPSERT_SQL, this.toParams(doc));
    this.emit('put', doc.id, doc);
  }

  async get(id: string): Promise<CovenantDocument | undefined> {
    const row = await this.driver.get<{ doc: string }>(SELECT_BY_ID, [id]);
    return this.parseDoc(row);
  }

  async has(id: string): Promise<boolean> {
    const row = await this.driver.get<{ found: number }>(EXISTS_BY_ID, [id]);
    return row !== undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.driver.run(DELETE_BY_ID, [id]);
    if (result.changes > 0) {
      this.emit('delete', id);
      return true;
    }
    return false;
  }

  async list(filter?: StoreFilter): Promise<CovenantDocument[]> {
    const { sql, params } = this.buildSelectQuery('doc', filter);
    const rows = await this.driver.all<{ doc: string }>(sql, params);
    return rows.map((row) => JSON.parse(row.doc) as CovenantDocument);
  }

  async count(filter?: StoreFilter): Promise<number> {
    const { sql, params } = this.buildSelectQuery('COUNT(*) AS cnt', filter);
    const row = await this.driver.get<{ cnt: number }>(sql, params);
    return row?.cnt ?? 0;
  }

  // ── Batch operations ───────────────────────────────────────────────────

  async putBatch(docs: CovenantDocument[]): Promise<void> {
    if (docs.length === 0) return;
    await this.driver.exec('BEGIN');
    try {
      for (const doc of docs) {
        await this.driver.run(UPSERT_SQL, this.toParams(doc));
      }
      await this.driver.exec('COMMIT');
    } catch (err) {
      await this.driver.exec('ROLLBACK');
      throw err;
    }
    for (const doc of docs) {
      this.emit('put', doc.id, doc);
    }
  }

  async getBatch(ids: string[]): Promise<(CovenantDocument | undefined)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async deleteBatch(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let totalDeleted = 0;
    const deletedIds: string[] = [];

    await this.driver.exec('BEGIN');
    try {
      for (const id of ids) {
        const result = await this.driver.run(DELETE_BY_ID, [id]);
        if (result.changes > 0) {
          totalDeleted += result.changes;
          deletedIds.push(id);
        }
      }
      await this.driver.exec('COMMIT');
    } catch (err) {
      await this.driver.exec('ROLLBACK');
      throw err;
    }

    for (const id of deletedIds) {
      this.emit('delete', id);
    }

    return totalDeleted;
  }

  // ── Event system ───────────────────────────────────────────────────────

  onEvent(callback: StoreEventCallback): void {
    this.listeners.add(callback);
  }

  offEvent(callback: StoreEventCallback): void {
    this.listeners.delete(callback);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /** Close the underlying database connection. */
  async close(): Promise<void> {
    await this.driver.close();
  }

  // ── Query builder ──────────────────────────────────────────────────────

  /**
   * Build a SELECT query with optional WHERE clauses derived from a
   * {@link StoreFilter}.  All parameters are positional (`?`) to prevent
   * SQL injection.
   */
  private buildSelectQuery(
    columns: string,
    filter?: StoreFilter,
  ): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter) {
      if (filter.issuerId !== undefined) {
        clauses.push('issuer_id = ?');
        params.push(filter.issuerId);
      }

      if (filter.beneficiaryId !== undefined) {
        clauses.push('beneficiary_id = ?');
        params.push(filter.beneficiaryId);
      }

      if (filter.createdAfter !== undefined) {
        clauses.push('created_at >= ?');
        params.push(filter.createdAfter);
      }

      if (filter.createdBefore !== undefined) {
        clauses.push('created_at <= ?');
        params.push(filter.createdBefore);
      }

      if (filter.hasChain !== undefined) {
        clauses.push('has_chain = ?');
        params.push(filter.hasChain ? 1 : 0);
      }

      if (filter.tags !== undefined && filter.tags.length > 0) {
        // For each required tag, add a JSON-based check.
        // tags column stores a JSON array, so we use instr() on the
        // serialized form. For exact matching we check each tag individually.
        for (const tag of filter.tags) {
          clauses.push(`EXISTS (
            SELECT 1 FROM json_each(tags) AS je WHERE je.value = ?
          )`);
          params.push(tag);
        }
      }
    }

    let sql = `SELECT ${columns} FROM covenants`;
    if (clauses.length > 0) {
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    return { sql, params };
  }
}
