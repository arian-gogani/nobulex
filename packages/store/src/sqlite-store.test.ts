import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteStore } from './sqlite-store';
import type { SQLiteDriver } from './sqlite-store';
import type { CovenantStore, StoreEvent, StoreEventCallback } from './types';
import type { CovenantDocument } from '@nobulex/core';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal CovenantDocument factory for testing. */
function makeDoc(overrides: Partial<CovenantDocument> & { id: string }): CovenantDocument {
  return {
    version: '1.0',
    issuer: {
      id: 'issuer-1',
      publicKey: 'aa'.repeat(32),
      role: 'issuer' as const,
    },
    beneficiary: {
      id: 'beneficiary-1',
      publicKey: 'bb'.repeat(32),
      role: 'beneficiary' as const,
    },
    constraints: 'PERMIT read\nDENY write',
    nonce: 'cc'.repeat(32),
    createdAt: '2025-06-01T00:00:00.000Z',
    signature: 'dd'.repeat(64),
    ...overrides,
  } as CovenantDocument;
}

// ---------------------------------------------------------------------------
// Mock SQLite driver backed by an in-memory Map
// ---------------------------------------------------------------------------

interface MockRow {
  id: string;
  doc: string;
  issuer_id: string;
  beneficiary_id: string;
  created_at: string;
  has_chain: number;
  tags: string;
}

/**
 * Creates a mock SQLiteDriver that simulates SQLite behavior using
 * in-memory data structures. Supports the subset of SQL used by SqliteStore.
 */
function createMockDriver(): SQLiteDriver & { rows: Map<string, MockRow>; closed: boolean; inTransaction: boolean } {
  const rows = new Map<string, MockRow>();
  let closed = false;
  let inTransaction = false;

  /**
   * Build a filter function from a SQL query and its positional parameters.
   * Scans the SQL for known column patterns, consuming `?` placeholders
   * left-to-right to pair each condition with the correct parameter value.
   */
  function parseWhere(sql: string, params: unknown[]): (row: MockRow) => boolean {
    const whereIdx = sql.search(/WHERE\s/i);
    if (whereIdx === -1) return () => true;

    const whereClause = sql.slice(whereIdx);
    const filters: Array<(row: MockRow) => boolean> = [];
    let paramIdx = 0;

    // Scan for each known pattern in order of appearance.
    // We use a regex that finds ALL condition tokens and their operators.
    const tokenRegex = /(\w+)\s*=\s*\?|(\w+)\s*>=\s*\?|(\w+)\s*<=\s*\?|json_each\(tags\).*?je\.value\s*=\s*\?/gi;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(whereClause)) !== null) {
      const fullMatch = match[0]!;

      // json_each tag check
      if (fullMatch.includes('json_each(tags)')) {
        const tag = params[paramIdx++] as string;
        filters.push((row) => {
          const tagArr: string[] = JSON.parse(row.tags);
          return tagArr.includes(tag);
        });
        continue;
      }

      // column >= ?
      if (match[2]) {
        const col = match[2] as keyof MockRow;
        const val = params[paramIdx++] as string;
        filters.push((row) => String(row[col]) >= val);
        continue;
      }

      // column <= ?
      if (match[3]) {
        const col = match[3] as keyof MockRow;
        const val = params[paramIdx++] as string;
        filters.push((row) => String(row[col]) <= val);
        continue;
      }

      // column = ?
      if (match[1]) {
        const col = match[1] as keyof MockRow;
        const val = params[paramIdx++];
        filters.push((row) => row[col] === val);
        continue;
      }
    }

    return (row: MockRow) => filters.every((f) => f(row));
  }

  const driver: SQLiteDriver & { rows: Map<string, MockRow>; closed: boolean; inTransaction: boolean } = {
    rows,
    closed: false,
    inTransaction: false,

    async exec(sql: string): Promise<void> {
      if (closed) throw new Error('Database is closed');
      const normalized = sql.trim().toUpperCase();
      if (normalized === 'BEGIN') {
        inTransaction = true;
        driver.inTransaction = true;
        return;
      }
      if (normalized === 'COMMIT') {
        inTransaction = false;
        driver.inTransaction = false;
        return;
      }
      if (normalized === 'ROLLBACK') {
        inTransaction = false;
        driver.inTransaction = false;
        return;
      }
      // CREATE TABLE / CREATE INDEX - no-op for mock
    },

    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      if (closed) throw new Error('Database is closed');
      const normalized = sql.trim();

      // INSERT ... ON CONFLICT DO UPDATE (UPSERT)
      if (normalized.toUpperCase().startsWith('INSERT')) {
        const p = params ?? [];
        const id = p[0] as string;
        const row: MockRow = {
          id,
          doc: p[1] as string,
          issuer_id: p[2] as string,
          beneficiary_id: p[3] as string,
          created_at: p[4] as string,
          has_chain: p[5] as number,
          tags: p[6] as string,
        };
        rows.set(id, row);
        return { changes: 1 };
      }

      // DELETE FROM covenants WHERE id = ?
      if (normalized.toUpperCase().startsWith('DELETE')) {
        const id = (params ?? [])[0] as string;
        if (rows.has(id)) {
          rows.delete(id);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      return { changes: 0 };
    },

    async get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
      if (closed) throw new Error('Database is closed');
      const normalized = sql.trim().toUpperCase();

      // SELECT doc FROM covenants WHERE id = ?
      if (normalized.includes('SELECT DOC FROM') && normalized.includes('WHERE ID = ?')) {
        const id = (params ?? [])[0] as string;
        const row = rows.get(id);
        if (!row) return undefined;
        return { doc: row.doc } as unknown as T;
      }

      // SELECT 1 AS found FROM covenants WHERE id = ?
      if (normalized.includes('SELECT 1 AS FOUND') && normalized.includes('WHERE ID = ?')) {
        const id = (params ?? [])[0] as string;
        if (rows.has(id)) return { found: 1 } as unknown as T;
        return undefined;
      }

      // SELECT COUNT(*) AS cnt FROM covenants [WHERE ...]
      if (normalized.includes('COUNT(*)')) {
        const allRows = Array.from(rows.values());
        const filter = parseWhere(sql, params ?? []);
        const cnt = allRows.filter(filter).length;
        return { cnt } as unknown as T;
      }

      return undefined;
    },

    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (closed) throw new Error('Database is closed');
      const allRows = Array.from(rows.values());
      const filter = parseWhere(sql, params ?? []);
      return allRows.filter(filter).map((row) => ({ doc: row.doc })) as unknown as T[];
    },

    async close(): Promise<void> {
      closed = true;
      driver.closed = true;
    },
  };

  return driver;
}

// ---------------------------------------------------------------------------
// SqliteStore — instantiation
// ---------------------------------------------------------------------------
describe('SqliteStore - instantiation', () => {
  it('can be created via the static factory method', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    expect(store).toBeDefined();
  });

  it('implements CovenantStore interface', async () => {
    const driver = createMockDriver();
    const store: CovenantStore = await SqliteStore.create(driver);
    expect(typeof store.put).toBe('function');
    expect(typeof store.get).toBe('function');
    expect(typeof store.has).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(typeof store.list).toBe('function');
    expect(typeof store.count).toBe('function');
    expect(typeof store.putBatch).toBe('function');
    expect(typeof store.getBatch).toBe('function');
    expect(typeof store.deleteBatch).toBe('function');
    expect(typeof store.onEvent).toBe('function');
    expect(typeof store.offEvent).toBe('function');
  });

  it('can be constructed directly and used after manual schema init', async () => {
    const driver = createMockDriver();
    const store = new SqliteStore(driver);
    // Should work fine since our mock driver doesn't truly need schema
    await store.put(makeDoc({ id: 'doc-1' }));
    const doc = await store.get('doc-1');
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('doc-1');
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — put / get / has / delete
// ---------------------------------------------------------------------------
describe('SqliteStore - CRUD', () => {
  let store: SqliteStore;
  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(async () => {
    driver = createMockDriver();
    store = await SqliteStore.create(driver);
  });

  it('put stores a document and get retrieves it', async () => {
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);
    const retrieved = await store.get('doc-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('doc-1');
  });

  it('get returns undefined for a missing ID', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('has returns true for an existing document', async () => {
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);
    expect(await store.has('doc-1')).toBe(true);
  });

  it('has returns false for a missing document', async () => {
    expect(await store.has('missing')).toBe(false);
  });

  it('delete removes an existing document and returns true', async () => {
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);
    const deleted = await store.delete('doc-1');
    expect(deleted).toBe(true);
    expect(await store.has('doc-1')).toBe(false);
  });

  it('delete returns false for a missing document', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('put overwrites an existing document with the same ID', async () => {
    const doc1 = makeDoc({ id: 'doc-1', constraints: 'PERMIT read' });
    const doc2 = makeDoc({ id: 'doc-1', constraints: 'DENY write' });
    await store.put(doc1);
    await store.put(doc2);
    const retrieved = await store.get('doc-1');
    expect(retrieved!.constraints).toBe('DENY write');
    expect(await store.count()).toBe(1);
  });

  it('put and delete update the count', async () => {
    expect(await store.count()).toBe(0);
    await store.put(makeDoc({ id: 'a' }));
    expect(await store.count()).toBe(1);
    await store.put(makeDoc({ id: 'b' }));
    expect(await store.count()).toBe(2);
    await store.delete('a');
    expect(await store.count()).toBe(1);
    await store.delete('b');
    expect(await store.count()).toBe(0);
  });

  it('get retrieves the full document with all fields', async () => {
    const doc = makeDoc({
      id: 'full-doc',
      metadata: { name: 'test', tags: ['ai', 'safety'] },
      chain: { parentId: 'parent' as any, relation: 'delegates' as any, depth: 1 },
    });
    await store.put(doc);
    const retrieved = await store.get('full-doc');
    expect(retrieved!.id).toBe('full-doc');
    expect(retrieved!.issuer.id).toBe('issuer-1');
    expect(retrieved!.beneficiary.id).toBe('beneficiary-1');
    expect(retrieved!.metadata?.name).toBe('test');
    expect(retrieved!.metadata?.tags).toEqual(['ai', 'safety']);
    expect(retrieved!.chain?.parentId).toBe('parent');
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — list
// ---------------------------------------------------------------------------
describe('SqliteStore - list', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    const driver = createMockDriver();
    store = await SqliteStore.create(driver);
    await store.put(makeDoc({ id: 'doc-1' }));
    await store.put(makeDoc({ id: 'doc-2' }));
    await store.put(makeDoc({ id: 'doc-3' }));
  });

  it('list without filter returns all documents', async () => {
    const docs = await store.list();
    expect(docs.length).toBe(3);
  });

  it('list with empty filter returns all documents', async () => {
    const docs = await store.list({});
    expect(docs.length).toBe(3);
  });

  it('list filters by issuerId', async () => {
    await store.put(makeDoc({
      id: 'doc-special',
      issuer: { id: 'special-issuer', publicKey: 'aa'.repeat(32), role: 'issuer' },
    }));
    const docs = await store.list({ issuerId: 'special-issuer' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('doc-special');
  });

  it('list filters by beneficiaryId', async () => {
    await store.put(makeDoc({
      id: 'doc-special',
      beneficiary: { id: 'special-ben', publicKey: 'bb'.repeat(32), role: 'beneficiary' },
    }));
    const docs = await store.list({ beneficiaryId: 'special-ben' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('doc-special');
  });

  it('list filters by createdAfter', async () => {
    await store.put(makeDoc({ id: 'old', createdAt: '2020-01-01T00:00:00.000Z' }));
    await store.put(makeDoc({ id: 'new', createdAt: '2026-01-01T00:00:00.000Z' }));
    const docs = await store.list({ createdAfter: '2025-12-01T00:00:00.000Z' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('new');
  });

  it('list filters by createdBefore', async () => {
    await store.put(makeDoc({ id: 'old', createdAt: '2020-01-01T00:00:00.000Z' }));
    await store.put(makeDoc({ id: 'new', createdAt: '2026-01-01T00:00:00.000Z' }));
    const docs = await store.list({ createdBefore: '2021-01-01T00:00:00.000Z' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('old');
  });

  it('list filters by hasChain = true', async () => {
    await store.put(makeDoc({
      id: 'chained',
      chain: { parentId: 'parent-1' as any, relation: 'delegates' as any, depth: 1 },
    }));
    const docs = await store.list({ hasChain: true });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('chained');
  });

  it('list filters by hasChain = false', async () => {
    await store.put(makeDoc({
      id: 'chained',
      chain: { parentId: 'parent-1' as any, relation: 'delegates' as any, depth: 1 },
    }));
    // doc-1, doc-2, doc-3 have no chain
    const docs = await store.list({ hasChain: false });
    expect(docs.length).toBe(3);
    expect(docs.every((d) => d.chain === undefined)).toBe(true);
  });

  it('list filters by tags (AND semantics)', async () => {
    await store.put(makeDoc({
      id: 'tagged-1',
      metadata: { tags: ['ai', 'safety', 'governance'] },
    }));
    await store.put(makeDoc({
      id: 'tagged-2',
      metadata: { tags: ['ai', 'compliance'] },
    }));
    const docs = await store.list({ tags: ['ai', 'safety'] });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('tagged-1');
  });

  it('list returns empty when no documents match', async () => {
    const docs = await store.list({ issuerId: 'nobody' });
    expect(docs.length).toBe(0);
  });

  it('list with combined filters (AND)', async () => {
    await store.put(makeDoc({
      id: 'match',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' },
      createdAt: '2026-01-15T00:00:00.000Z',
    }));
    await store.put(makeDoc({
      id: 'no-match-issuer',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' },
      createdAt: '2026-01-15T00:00:00.000Z',
    }));
    await store.put(makeDoc({
      id: 'no-match-date',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' },
      createdAt: '2020-01-01T00:00:00.000Z',
    }));
    const docs = await store.list({
      issuerId: 'alice',
      createdAfter: '2026-01-01T00:00:00.000Z',
    });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('match');
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — count
// ---------------------------------------------------------------------------
describe('SqliteStore - count', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    const driver = createMockDriver();
    store = await SqliteStore.create(driver);
    await store.put(makeDoc({ id: 'doc-1' }));
    await store.put(makeDoc({ id: 'doc-2' }));
  });

  it('count without filter returns total documents', async () => {
    expect(await store.count()).toBe(2);
  });

  it('count with filter returns matching count', async () => {
    await store.put(makeDoc({
      id: 'special',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' },
    }));
    expect(await store.count({ issuerId: 'alice' })).toBe(1);
    expect(await store.count({ issuerId: 'issuer-1' })).toBe(2);
  });

  it('count returns 0 for empty store', async () => {
    const emptyDriver = createMockDriver();
    const emptyStore = await SqliteStore.create(emptyDriver);
    expect(await emptyStore.count()).toBe(0);
  });

  it('count returns 0 when no documents match', async () => {
    expect(await store.count({ issuerId: 'nonexistent' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — batch operations
// ---------------------------------------------------------------------------
describe('SqliteStore - batch operations', () => {
  let store: SqliteStore;
  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(async () => {
    driver = createMockDriver();
    store = await SqliteStore.create(driver);
  });

  it('putBatch stores multiple documents', async () => {
    const docs = [makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })];
    await store.putBatch(docs);
    expect(await store.count()).toBe(3);
    expect(await store.has('a')).toBe(true);
    expect(await store.has('b')).toBe(true);
    expect(await store.has('c')).toBe(true);
  });

  it('putBatch with empty array does nothing', async () => {
    await store.putBatch([]);
    expect(await store.count()).toBe(0);
  });

  it('getBatch retrieves multiple documents in order', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })]);
    const results = await store.getBatch(['c', 'a', 'b']);
    expect(results.length).toBe(3);
    expect(results[0]!.id).toBe('c');
    expect(results[1]!.id).toBe('a');
    expect(results[2]!.id).toBe('b');
  });

  it('getBatch returns undefined for missing IDs', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const results = await store.getBatch(['a', 'missing', 'a']);
    expect(results.length).toBe(3);
    expect(results[0]!.id).toBe('a');
    expect(results[1]).toBeUndefined();
    expect(results[2]!.id).toBe('a');
  });

  it('getBatch with empty array returns empty array', async () => {
    const results = await store.getBatch([]);
    expect(results).toEqual([]);
  });

  it('deleteBatch removes multiple documents', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })]);
    const deleted = await store.deleteBatch(['a', 'c']);
    expect(deleted).toBe(2);
    expect(await store.count()).toBe(1);
    expect(await store.has('b')).toBe(true);
  });

  it('deleteBatch returns count of actually deleted documents', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const deleted = await store.deleteBatch(['a', 'nonexistent1', 'nonexistent2']);
    expect(deleted).toBe(1);
  });

  it('deleteBatch with empty array deletes nothing', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const deleted = await store.deleteBatch([]);
    expect(deleted).toBe(0);
    expect(await store.count()).toBe(1);
  });

  it('putBatch uses transactions (BEGIN/COMMIT)', async () => {
    const execCalls: string[] = [];
    const origExec = driver.exec.bind(driver);
    driver.exec = async (sql: string) => {
      execCalls.push(sql.trim().toUpperCase());
      return origExec(sql);
    };

    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);

    expect(execCalls).toContain('BEGIN');
    expect(execCalls).toContain('COMMIT');
  });

  it('deleteBatch uses transactions (BEGIN/COMMIT)', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);

    const execCalls: string[] = [];
    const origExec = driver.exec.bind(driver);
    driver.exec = async (sql: string) => {
      execCalls.push(sql.trim().toUpperCase());
      return origExec(sql);
    };

    await store.deleteBatch(['a', 'b']);

    expect(execCalls).toContain('BEGIN');
    expect(execCalls).toContain('COMMIT');
  });

  it('putBatch with duplicate IDs keeps last version', async () => {
    const doc1 = makeDoc({ id: 'dup', constraints: 'first' });
    const doc2 = makeDoc({ id: 'dup', constraints: 'second' });
    await store.putBatch([doc1, doc2]);
    expect(await store.count()).toBe(1);
    const retrieved = await store.get('dup');
    expect(retrieved!.constraints).toBe('second');
  });

  it('getBatch handles duplicate IDs', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const results = await store.getBatch(['a', 'a', 'a']);
    expect(results.length).toBe(3);
    expect(results.every((r) => r?.id === 'a')).toBe(true);
  });

  it('deleteBatch with duplicate IDs only deletes once', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const deleted = await store.deleteBatch(['a', 'a', 'a']);
    // Second and third attempts find nothing to delete
    expect(deleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — event system
// ---------------------------------------------------------------------------
describe('SqliteStore - events', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    const driver = createMockDriver();
    store = await SqliteStore.create(driver);
  });

  it('onEvent registers a listener that receives put events', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('put');
    expect(events[0]!.documentId).toBe('doc-1');
    expect(events[0]!.document).toBeDefined();
    expect(events[0]!.document!.id).toBe('doc-1');
  });

  it('onEvent registers a listener that receives delete events', async () => {
    const events: StoreEvent[] = [];
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);

    store.onEvent((e) => events.push(e));
    await store.delete('doc-1');

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('delete');
    expect(events[0]!.documentId).toBe('doc-1');
    expect(events[0]!.document).toBeUndefined();
  });

  it('delete of non-existent document does not emit event', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));
    await store.delete('nonexistent');
    expect(events.length).toBe(0);
  });

  it('offEvent unregisters a listener', async () => {
    const events: StoreEvent[] = [];
    const listener: StoreEventCallback = (e) => events.push(e);
    store.onEvent(listener);

    await store.put(makeDoc({ id: 'a' }));
    expect(events.length).toBe(1);

    store.offEvent(listener);
    await store.put(makeDoc({ id: 'b' }));
    expect(events.length).toBe(1); // no new events
  });

  it('multiple listeners receive the same event', async () => {
    const events1: StoreEvent[] = [];
    const events2: StoreEvent[] = [];
    store.onEvent((e) => events1.push(e));
    store.onEvent((e) => events2.push(e));

    await store.put(makeDoc({ id: 'doc-1' }));

    expect(events1.length).toBe(1);
    expect(events2.length).toBe(1);
  });

  it('putBatch emits one event per document', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })]);

    expect(events.length).toBe(3);
    expect(events.map((e) => e.documentId)).toEqual(['a', 'b', 'c']);
    expect(events.every((e) => e.type === 'put')).toBe(true);
  });

  it('deleteBatch emits one event per actually deleted document', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);

    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    await store.deleteBatch(['a', 'nonexistent', 'b']);

    expect(events.length).toBe(2);
    expect(events.every((e) => e.type === 'delete')).toBe(true);
  });

  it('event timestamps are valid ISO 8601', async () => {
    const events: StoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    await store.put(makeDoc({ id: 'doc-1' }));

    expect(events.length).toBe(1);
    const ts = events[0]!.timestamp;
    expect(typeof ts).toBe('string');
    const parsed = new Date(ts);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — close
// ---------------------------------------------------------------------------
describe('SqliteStore - close', () => {
  it('close delegates to the driver', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    expect(driver.closed).toBe(false);
    await store.close();
    expect(driver.closed).toBe(true);
  });

  it('operations throw after close', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    await store.close();
    await expect(store.put(makeDoc({ id: 'x' }))).rejects.toThrow('Database is closed');
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — error handling
// ---------------------------------------------------------------------------
describe('SqliteStore - error handling', () => {
  it('put rejects when document is null', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    await expect(store.put(null as any)).rejects.toThrow('put(): document is required');
  });

  it('put rejects when document.id is empty', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    await expect(store.put(makeDoc({ id: '' }))).rejects.toThrow('put(): document.id is required');
  });

  it('put rejects when document.id is whitespace only', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    await expect(store.put(makeDoc({ id: '   ' }))).rejects.toThrow('put(): document.id is required');
  });

  it('putBatch rolls back on driver error', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);

    let callCount = 0;
    const origRun = driver.run.bind(driver);
    driver.run = async (sql: string, params?: unknown[]) => {
      if (sql.trim().toUpperCase().startsWith('INSERT')) {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated write failure');
        }
      }
      return origRun(sql, params);
    };

    await expect(
      store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]),
    ).rejects.toThrow('Simulated write failure');
  });

  it('deleteBatch rolls back on driver error', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);
    await store.put(makeDoc({ id: 'a' }));
    await store.put(makeDoc({ id: 'b' }));

    const origRun = driver.run.bind(driver);
    let deleteCount = 0;
    driver.run = async (sql: string, params?: unknown[]) => {
      if (sql.trim().toUpperCase().startsWith('DELETE')) {
        deleteCount++;
        if (deleteCount === 2) {
          throw new Error('Simulated delete failure');
        }
      }
      return origRun(sql, params);
    };

    await expect(
      store.deleteBatch(['a', 'b']),
    ).rejects.toThrow('Simulated delete failure');
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — edge cases
// ---------------------------------------------------------------------------
describe('SqliteStore - edge cases', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    const driver = createMockDriver();
    store = await SqliteStore.create(driver);
  });

  it('handles documents with no metadata', async () => {
    const doc = makeDoc({ id: 'no-meta' });
    delete (doc as any).metadata;
    await store.put(doc);
    const docs = await store.list({ tags: ['anything'] });
    expect(docs.length).toBe(0);
  });

  it('handles documents with empty tags array', async () => {
    const doc = makeDoc({ id: 'empty-tags', metadata: { tags: [] } });
    await store.put(doc);
    const docs = await store.list({ tags: ['anything'] });
    expect(docs.length).toBe(0);
  });

  it('createdAfter is inclusive (equal timestamps match)', async () => {
    const doc = makeDoc({ id: 'exact', createdAt: '2025-06-01T00:00:00.000Z' });
    await store.put(doc);
    const docs = await store.list({ createdAfter: '2025-06-01T00:00:00.000Z' });
    expect(docs.length).toBe(1);
  });

  it('createdBefore is inclusive (equal timestamps match)', async () => {
    const doc = makeDoc({ id: 'exact', createdAt: '2025-06-01T00:00:00.000Z' });
    await store.put(doc);
    const docs = await store.list({ createdBefore: '2025-06-01T00:00:00.000Z' });
    expect(docs.length).toBe(1);
  });

  it('list returns different array references on each call', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const list1 = await store.list();
    const list2 = await store.list();
    expect(list1).not.toBe(list2);
  });

  it('documents are serialized as JSON and deserialized correctly', async () => {
    const doc = makeDoc({
      id: 'json-test',
      constraints: 'PERMIT read\nDENY "special chars: \'quotes\' & <brackets>"',
      metadata: { tags: ['tag-1', 'tag-2'], name: 'test doc' },
    });
    await store.put(doc);
    const retrieved = await store.get('json-test');
    expect(retrieved).toEqual(doc);
  });
});

// ---------------------------------------------------------------------------
// SqliteStore — driver interaction
// ---------------------------------------------------------------------------
describe('SqliteStore - driver interaction', () => {
  it('uses parameterized queries (no SQL injection)', async () => {
    const driver = createMockDriver();
    const store = await SqliteStore.create(driver);

    const runCalls: { sql: string; params: unknown[] }[] = [];
    const origRun = driver.run.bind(driver);
    driver.run = async (sql: string, params?: unknown[]) => {
      runCalls.push({ sql, params: params ?? [] });
      return origRun(sql, params);
    };

    const maliciousId = "'; DROP TABLE covenants; --";
    const doc = makeDoc({ id: maliciousId });
    await store.put(doc);

    // Verify the ID was passed as a parameter, not interpolated into SQL
    const insertCall = runCalls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params[0]).toBe(maliciousId);
    // SQL should use ? placeholders, not contain the malicious string
    expect(insertCall!.sql).not.toContain(maliciousId);
  });

  it('schema initialization creates table and indexes', async () => {
    const execCalls: string[] = [];
    const driver = createMockDriver();
    const origExec = driver.exec.bind(driver);
    driver.exec = async (sql: string) => {
      execCalls.push(sql);
      return origExec(sql);
    };

    await SqliteStore.create(driver);

    expect(execCalls.some((s) => s.includes('CREATE TABLE'))).toBe(true);
    expect(execCalls.some((s) => s.includes('idx_covenants_issuer_id'))).toBe(true);
    expect(execCalls.some((s) => s.includes('idx_covenants_beneficiary_id'))).toBe(true);
    expect(execCalls.some((s) => s.includes('idx_covenants_created_at'))).toBe(true);
  });
});
