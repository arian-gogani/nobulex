import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './index';
import { QueryBuilder, createQuery } from './query';
import type { PaginationOptions, PaginatedResult, SortField, SortOrder } from './query';
import type { CovenantDocument } from '@stele/core';

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

/** Create N documents with sequential IDs and timestamps. */
function makeDocs(n: number, base?: Partial<CovenantDocument>): CovenantDocument[] {
  const docs: CovenantDocument[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0');
    docs.push(
      makeDoc({
        id: `doc-${String(i + 1).padStart(3, '0')}`,
        createdAt: `2025-06-${day}T00:00:00.000Z`,
        ...base,
      }),
    );
  }
  return docs;
}

// ---------------------------------------------------------------------------
// QueryBuilder — instantiation & factory
// ---------------------------------------------------------------------------
describe('QueryBuilder - instantiation', () => {
  it('can be constructed with a CovenantStore', () => {
    const store = new MemoryStore();
    const qb = new QueryBuilder(store);
    expect(qb).toBeInstanceOf(QueryBuilder);
  });

  it('createQuery factory returns a QueryBuilder', () => {
    const store = new MemoryStore();
    const qb = createQuery(store);
    expect(qb).toBeInstanceOf(QueryBuilder);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — execute() basics
// ---------------------------------------------------------------------------
describe('QueryBuilder - execute()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch(makeDocs(5));
  });

  it('returns all documents when no filters are set', async () => {
    const results = await createQuery(store).execute();
    expect(results).toHaveLength(5);
  });

  it('returns empty array from an empty store', async () => {
    const empty = new MemoryStore();
    const results = await createQuery(empty).execute();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — fluent filter chaining
// ---------------------------------------------------------------------------
describe('QueryBuilder - issuedBy()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'a1', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
      makeDoc({ id: 'a2', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
      makeDoc({ id: 'b1', issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
    ]);
  });

  it('filters documents by issuer', async () => {
    const results = await createQuery(store).issuedBy('alice').execute();
    expect(results).toHaveLength(2);
    expect(results.every((d) => d.issuer.id === 'alice')).toBe(true);
  });

  it('returns empty when no issuer matches', async () => {
    const results = await createQuery(store).issuedBy('charlie').execute();
    expect(results).toHaveLength(0);
  });
});

describe('QueryBuilder - forBeneficiary()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'x1', beneficiary: { id: 'ben-a', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const } }),
      makeDoc({ id: 'x2', beneficiary: { id: 'ben-b', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const } }),
    ]);
  });

  it('filters documents by beneficiary', async () => {
    const results = await createQuery(store).forBeneficiary('ben-a').execute();
    expect(results).toHaveLength(1);
    expect(results[0].beneficiary.id).toBe('ben-a');
  });
});

describe('QueryBuilder - createdAfter() and createdBefore()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'd1', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeDoc({ id: 'd2', createdAt: '2025-06-15T00:00:00.000Z' }),
      makeDoc({ id: 'd3', createdAt: '2025-12-31T00:00:00.000Z' }),
    ]);
  });

  it('filters documents created after a date', async () => {
    const results = await createQuery(store).createdAfter('2025-06-01T00:00:00.000Z').execute();
    expect(results).toHaveLength(2);
  });

  it('filters documents created before a date', async () => {
    const results = await createQuery(store).createdBefore('2025-07-01T00:00:00.000Z').execute();
    expect(results).toHaveLength(2);
  });

  it('combines createdAfter and createdBefore as a date range', async () => {
    const results = await createQuery(store)
      .createdAfter('2025-03-01T00:00:00.000Z')
      .createdBefore('2025-09-01T00:00:00.000Z')
      .execute();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('d2');
  });
});

describe('QueryBuilder - withChain() and withoutChain()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'root-1' }),
      makeDoc({ id: 'root-2' }),
      makeDoc({ id: 'chained-1', chain: { parentId: 'root-1', depth: 1 } } as any),
    ]);
  });

  it('withChain() returns only documents with chain references', async () => {
    const results = await createQuery(store).withChain().execute();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('chained-1');
  });

  it('withoutChain() returns only root documents', async () => {
    const results = await createQuery(store).withoutChain().execute();
    expect(results).toHaveLength(2);
    expect(results.every((d) => d.chain === undefined)).toBe(true);
  });
});

describe('QueryBuilder - withTags()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 't1', metadata: { tags: ['alpha', 'beta'] } }),
      makeDoc({ id: 't2', metadata: { tags: ['beta', 'gamma'] } }),
      makeDoc({ id: 't3', metadata: { tags: ['alpha'] } }),
      makeDoc({ id: 't4' }), // no metadata
    ]);
  });

  it('filters by a single tag', async () => {
    const results = await createQuery(store).withTags('alpha').execute();
    expect(results).toHaveLength(2);
  });

  it('filters by multiple tags (AND semantics)', async () => {
    const results = await createQuery(store).withTags('alpha', 'beta').execute();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('t1');
  });

  it('returns empty when no documents have the tag', async () => {
    const results = await createQuery(store).withTags('nonexistent').execute();
    expect(results).toHaveLength(0);
  });
});

describe('QueryBuilder - where()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'w1', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const }, createdAt: '2025-01-01T00:00:00.000Z' }),
      makeDoc({ id: 'w2', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const }, createdAt: '2025-12-01T00:00:00.000Z' }),
      makeDoc({ id: 'w3', issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const }, createdAt: '2025-06-01T00:00:00.000Z' }),
    ]);
  });

  it('applies a StoreFilter via where()', async () => {
    const results = await createQuery(store)
      .where({ issuerId: 'alice' })
      .execute();
    expect(results).toHaveLength(2);
  });

  it('where() merges with other filter methods', async () => {
    const results = await createQuery(store)
      .where({ issuerId: 'alice' })
      .createdAfter('2025-06-01T00:00:00.000Z')
      .execute();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('w2');
  });

  it('where() with tags merges tags arrays', async () => {
    const tagStore = new MemoryStore();
    await tagStore.putBatch([
      makeDoc({ id: 'wt1', metadata: { tags: ['a', 'b', 'c'] } }),
      makeDoc({ id: 'wt2', metadata: { tags: ['a', 'b'] } }),
      makeDoc({ id: 'wt3', metadata: { tags: ['a'] } }),
    ]);
    const results = await createQuery(tagStore)
      .where({ tags: ['a'] })
      .withTags('b')
      .execute();
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — combining multiple filters
// ---------------------------------------------------------------------------
describe('QueryBuilder - combined filters', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({
        id: 'combo-1',
        issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
        beneficiary: { id: 'ben-x', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
        createdAt: '2025-06-15T00:00:00.000Z',
        metadata: { tags: ['important'] },
      }),
      makeDoc({
        id: 'combo-2',
        issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
        beneficiary: { id: 'ben-y', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
        createdAt: '2025-03-01T00:00:00.000Z',
        metadata: { tags: ['important'] },
      }),
      makeDoc({
        id: 'combo-3',
        issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
        beneficiary: { id: 'ben-x', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
        createdAt: '2025-06-15T00:00:00.000Z',
        metadata: { tags: ['important'] },
      }),
    ]);
  });

  it('combines issuer + beneficiary + date + tag filters', async () => {
    const results = await createQuery(store)
      .issuedBy('alice')
      .forBeneficiary('ben-x')
      .createdAfter('2025-06-01T00:00:00.000Z')
      .withTags('important')
      .execute();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('combo-1');
  });

  it('returns empty when combined filters are too restrictive', async () => {
    const results = await createQuery(store)
      .issuedBy('alice')
      .forBeneficiary('ben-x')
      .createdBefore('2025-01-01T00:00:00.000Z')
      .execute();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — sorting
// ---------------------------------------------------------------------------
describe('QueryBuilder - sortBy()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'c-doc', createdAt: '2025-03-01T00:00:00.000Z' }),
      makeDoc({ id: 'a-doc', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeDoc({ id: 'b-doc', createdAt: '2025-02-01T00:00:00.000Z' }),
    ]);
  });

  it('sorts by createdAt ascending', async () => {
    const results = await createQuery(store).sortBy('createdAt', 'asc').execute();
    expect(results.map((d) => d.id)).toEqual(['a-doc', 'b-doc', 'c-doc']);
  });

  it('sorts by createdAt descending', async () => {
    const results = await createQuery(store).sortBy('createdAt', 'desc').execute();
    expect(results.map((d) => d.id)).toEqual(['c-doc', 'b-doc', 'a-doc']);
  });

  it('sorts by id ascending', async () => {
    const results = await createQuery(store).sortBy('id', 'asc').execute();
    expect(results.map((d) => d.id)).toEqual(['a-doc', 'b-doc', 'c-doc']);
  });

  it('sorts by id descending', async () => {
    const results = await createQuery(store).sortBy('id', 'desc').execute();
    expect(results.map((d) => d.id)).toEqual(['c-doc', 'b-doc', 'a-doc']);
  });

  it('defaults to ascending when order is not specified', async () => {
    const results = await createQuery(store).sortBy('createdAt').execute();
    expect(results.map((d) => d.id)).toEqual(['a-doc', 'b-doc', 'c-doc']);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — limit() and offset()
// ---------------------------------------------------------------------------
describe('QueryBuilder - limit() and offset()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch(makeDocs(10));
  });

  it('limit() restricts result count', async () => {
    const results = await createQuery(store)
      .sortBy('id')
      .limit(3)
      .execute();
    expect(results).toHaveLength(3);
  });

  it('offset() skips initial results', async () => {
    const results = await createQuery(store)
      .sortBy('id')
      .offset(7)
      .execute();
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('doc-008');
  });

  it('limit() + offset() returns a window', async () => {
    const results = await createQuery(store)
      .sortBy('id')
      .offset(2)
      .limit(3)
      .execute();
    expect(results).toHaveLength(3);
    expect(results.map((d) => d.id)).toEqual(['doc-003', 'doc-004', 'doc-005']);
  });

  it('limit larger than result set returns all', async () => {
    const results = await createQuery(store).limit(100).execute();
    expect(results).toHaveLength(10);
  });

  it('offset beyond result set returns empty', async () => {
    const results = await createQuery(store)
      .sortBy('id')
      .offset(100)
      .execute();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — count()
// ---------------------------------------------------------------------------
describe('QueryBuilder - count()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'c1', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
      makeDoc({ id: 'c2', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
      makeDoc({ id: 'c3', issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }),
    ]);
  });

  it('counts all documents without filters', async () => {
    const n = await createQuery(store).count();
    expect(n).toBe(3);
  });

  it('counts filtered documents', async () => {
    const n = await createQuery(store).issuedBy('alice').count();
    expect(n).toBe(2);
  });

  it('returns 0 on empty store', async () => {
    const empty = new MemoryStore();
    const n = await createQuery(empty).count();
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — first()
// ---------------------------------------------------------------------------
describe('QueryBuilder - first()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'f-beta', createdAt: '2025-02-01T00:00:00.000Z' }),
      makeDoc({ id: 'f-alpha', createdAt: '2025-01-01T00:00:00.000Z' }),
    ]);
  });

  it('returns the first document matching the query', async () => {
    const doc = await createQuery(store).sortBy('createdAt', 'asc').first();
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('f-alpha');
  });

  it('returns undefined when no documents match', async () => {
    const doc = await createQuery(store).issuedBy('nobody').first();
    expect(doc).toBeUndefined();
  });

  it('returns the first when sorted descending', async () => {
    const doc = await createQuery(store).sortBy('createdAt', 'desc').first();
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('f-beta');
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — exists()
// ---------------------------------------------------------------------------
describe('QueryBuilder - exists()', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.put(makeDoc({ id: 'e1', issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const } }));
  });

  it('returns true when matching documents exist', async () => {
    expect(await createQuery(store).issuedBy('alice').exists()).toBe(true);
  });

  it('returns false when no documents match', async () => {
    expect(await createQuery(store).issuedBy('nobody').exists()).toBe(false);
  });

  it('returns false on empty store', async () => {
    const empty = new MemoryStore();
    expect(await createQuery(empty).exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — paginate() with offset
// ---------------------------------------------------------------------------
describe('QueryBuilder - paginate() offset-based', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch(makeDocs(10));
  });

  it('returns the first page with correct metadata', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(10);
    expect(page.hasMore).toBe(true);
    expect(page.items.map((d) => d.id)).toEqual(['doc-001', 'doc-002', 'doc-003']);
  });

  it('returns a middle page via offset', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3, offset: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.items.map((d) => d.id)).toEqual(['doc-004', 'doc-005', 'doc-006']);
    expect(page.hasMore).toBe(true);
  });

  it('returns the last page with hasMore=false', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3, offset: 9 });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('returns empty page when offset is beyond total', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3, offset: 100 });
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(10);
  });

  it('returns all items when limit >= total', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 100 });
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('provides nextCursor when hasMore is true', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3 });
    expect(page.nextCursor).toBeDefined();
    expect(page.nextCursor).toBe('doc-003');
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — paginate() cursor-based
// ---------------------------------------------------------------------------
describe('QueryBuilder - paginate() cursor-based', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch(makeDocs(10));
  });

  it('resumes from a cursor', async () => {
    const page1 = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3 });
    expect(page1.nextCursor).toBe('doc-003');

    const page2 = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3, cursor: page1.nextCursor });
    expect(page2.items.map((d) => d.id)).toEqual(['doc-004', 'doc-005', 'doc-006']);
    expect(page2.hasMore).toBe(true);
  });

  it('iterates through all pages with cursors', async () => {
    const allIds: string[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < 10; i++) {
      const page = await createQuery(store)
        .sortBy('id')
        .paginate({ limit: 3, cursor });
      allIds.push(...page.items.map((d) => d.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(allIds).toHaveLength(10);
    expect(allIds[0]).toBe('doc-001');
    expect(allIds[9]).toBe('doc-010');
  });

  it('returns from beginning when cursor is not found', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 3, cursor: 'nonexistent-cursor' });
    expect(page.items.map((d) => d.id)).toEqual(['doc-001', 'doc-002', 'doc-003']);
  });

  it('returns the last page correctly via cursor', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 5, cursor: 'doc-008' });
    expect(page.items.map((d) => d.id)).toEqual(['doc-009', 'doc-010']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — sort + paginate combined
// ---------------------------------------------------------------------------
describe('QueryBuilder - sort + paginate', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.putBatch([
      makeDoc({ id: 'z-oldest', createdAt: '2025-01-01T00:00:00.000Z' }),
      makeDoc({ id: 'a-newest', createdAt: '2025-12-01T00:00:00.000Z' }),
      makeDoc({ id: 'm-middle', createdAt: '2025-06-01T00:00:00.000Z' }),
    ]);
  });

  it('paginates with createdAt desc sorting', async () => {
    const page = await createQuery(store)
      .sortBy('createdAt', 'desc')
      .paginate({ limit: 2 });
    expect(page.items.map((d) => d.id)).toEqual(['a-newest', 'm-middle']);
    expect(page.hasMore).toBe(true);
  });

  it('cursor works with non-id sort', async () => {
    const page1 = await createQuery(store)
      .sortBy('createdAt', 'asc')
      .paginate({ limit: 2 });
    expect(page1.items.map((d) => d.id)).toEqual(['z-oldest', 'm-middle']);
    expect(page1.nextCursor).toBe('m-middle');

    const page2 = await createQuery(store)
      .sortBy('createdAt', 'asc')
      .paginate({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((d) => d.id)).toEqual(['a-newest']);
    expect(page2.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — sort + filter + paginate
// ---------------------------------------------------------------------------
describe('QueryBuilder - filter + sort + paginate', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 8; i++) {
      const day = String(i + 1).padStart(2, '0');
      docs.push(
        makeDoc({
          id: `fp-${String(i + 1).padStart(2, '0')}`,
          issuer: {
            id: i < 5 ? 'alice' : 'bob',
            publicKey: 'aa'.repeat(32),
            role: 'issuer' as const,
          },
          createdAt: `2025-06-${day}T00:00:00.000Z`,
        }),
      );
    }
    await store.putBatch(docs);
  });

  it('filters then paginates correctly', async () => {
    const page = await createQuery(store)
      .issuedBy('alice')
      .sortBy('id')
      .paginate({ limit: 2 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('filter + sort + cursor traversal yields correct total items', async () => {
    const allIds: string[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < 10; i++) {
      const page = await createQuery(store)
        .issuedBy('alice')
        .sortBy('createdAt', 'asc')
        .paginate({ limit: 2, cursor });
      allIds.push(...page.items.map((d) => d.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(allIds).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — large dataset pagination
// ---------------------------------------------------------------------------
describe('QueryBuilder - large dataset (100 docs)', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    const docs: CovenantDocument[] = [];
    for (let i = 0; i < 100; i++) {
      const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      docs.push(
        makeDoc({
          id: `large-${String(i).padStart(3, '0')}`,
          createdAt: `2025-${month}-${day}T00:00:00.000Z`,
        }),
      );
    }
    await store.putBatch(docs);
  });

  it('paginates through all 100 docs in pages of 10', async () => {
    const allIds: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    for (let i = 0; i < 20; i++) {
      const page = await createQuery(store)
        .sortBy('id')
        .paginate({ limit: 10, cursor });
      allIds.push(...page.items.map((d) => d.id));
      pageCount++;
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(allIds).toHaveLength(100);
    expect(pageCount).toBe(10);
    // Verify sorted order
    expect(allIds[0]).toBe('large-000');
    expect(allIds[99]).toBe('large-099');
  });

  it('offset-based pagination also works at scale', async () => {
    const page = await createQuery(store)
      .sortBy('id')
      .paginate({ limit: 10, offset: 90 });
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(false);
    expect(page.items[0].id).toBe('large-090');
    expect(page.items[9].id).toBe('large-099');
  });

  it('count returns 100', async () => {
    const n = await createQuery(store).count();
    expect(n).toBe(100);
  });

  it('first() on sorted large dataset returns correct doc', async () => {
    const doc = await createQuery(store).sortBy('id', 'desc').first();
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('large-099');
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — empty results edge cases
// ---------------------------------------------------------------------------
describe('QueryBuilder - empty results', () => {
  it('execute() on empty store returns empty array', async () => {
    const store = new MemoryStore();
    const results = await createQuery(store).execute();
    expect(results).toEqual([]);
  });

  it('paginate() on empty store returns correct structure', async () => {
    const store = new MemoryStore();
    const page = await createQuery(store).paginate({ limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('count() on empty store returns 0', async () => {
    const store = new MemoryStore();
    expect(await createQuery(store).count()).toBe(0);
  });

  it('first() on empty store returns undefined', async () => {
    const store = new MemoryStore();
    expect(await createQuery(store).first()).toBeUndefined();
  });

  it('exists() on empty store returns false', async () => {
    const store = new MemoryStore();
    expect(await createQuery(store).exists()).toBe(false);
  });

  it('paginate() with filter matching nothing returns correct structure', async () => {
    const store = new MemoryStore();
    await store.put(makeDoc({ id: 'only-one' }));
    const page = await createQuery(store)
      .issuedBy('nobody')
      .paginate({ limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QueryBuilder — method chaining returns this
// ---------------------------------------------------------------------------
describe('QueryBuilder - fluent chaining returns this', () => {
  it('all filter/sort/limit methods return the same builder', () => {
    const store = new MemoryStore();
    const qb = createQuery(store);
    expect(qb.issuedBy('x')).toBe(qb);
    expect(qb.forBeneficiary('y')).toBe(qb);
    expect(qb.createdAfter('2025-01-01')).toBe(qb);
    expect(qb.createdBefore('2025-12-31')).toBe(qb);
    expect(qb.withChain()).toBe(qb);
    expect(qb.withoutChain()).toBe(qb);
    expect(qb.withTags('a')).toBe(qb);
    expect(qb.where({ issuerId: 'z' })).toBe(qb);
    expect(qb.sortBy('id')).toBe(qb);
    expect(qb.limit(10)).toBe(qb);
    expect(qb.offset(5)).toBe(qb);
  });
});
