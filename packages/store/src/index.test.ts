import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStore } from './index';
import type { CovenantStore, StoreEvent, StoreEventCallback } from './index';
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
// MemoryStore — basic instantiation
// ---------------------------------------------------------------------------
describe('MemoryStore - instantiation', () => {
  it('can be constructed with no arguments', () => {
    const store = new MemoryStore();
    expect(store).toBeDefined();
    expect(store.size).toBe(0);
  });

  it('implements CovenantStore interface', () => {
    const store: CovenantStore = new MemoryStore();
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
});

// ---------------------------------------------------------------------------
// MemoryStore — put / get / has / delete
// ---------------------------------------------------------------------------
describe('MemoryStore - CRUD', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
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
    expect(store.size).toBe(1);
  });

  it('put and delete update the size property', async () => {
    expect(store.size).toBe(0);
    await store.put(makeDoc({ id: 'a' }));
    expect(store.size).toBe(1);
    await store.put(makeDoc({ id: 'b' }));
    expect(store.size).toBe(2);
    await store.delete('a');
    expect(store.size).toBe(1);
    await store.delete('b');
    expect(store.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MemoryStore — list
// ---------------------------------------------------------------------------
describe('MemoryStore - list', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
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
// MemoryStore — count
// ---------------------------------------------------------------------------
describe('MemoryStore - count', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
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
    const emptyStore = new MemoryStore();
    expect(await emptyStore.count()).toBe(0);
  });

  it('count returns 0 when no documents match', async () => {
    expect(await store.count({ issuerId: 'nonexistent' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MemoryStore — batch operations
// ---------------------------------------------------------------------------
describe('MemoryStore - batch operations', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('putBatch stores multiple documents', async () => {
    const docs = [makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })];
    await store.putBatch(docs);
    expect(store.size).toBe(3);
    expect(await store.has('a')).toBe(true);
    expect(await store.has('b')).toBe(true);
    expect(await store.has('c')).toBe(true);
  });

  it('putBatch with empty array does nothing', async () => {
    await store.putBatch([]);
    expect(store.size).toBe(0);
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
    expect(store.size).toBe(1);
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
    expect(store.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MemoryStore — event system
// ---------------------------------------------------------------------------
describe('MemoryStore - events', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
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
// MemoryStore — clear utility
// ---------------------------------------------------------------------------
describe('MemoryStore - clear', () => {
  it('clear removes all documents', async () => {
    const store = new MemoryStore();
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);
    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
    expect(await store.has('a')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MemoryStore — edge cases
// ---------------------------------------------------------------------------
describe('MemoryStore - edge cases', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
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

  it('list returns copies (different array references)', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const list1 = await store.list();
    const list2 = await store.list();
    expect(list1).not.toBe(list2);
  });

  it('putBatch with duplicate IDs keeps last version', async () => {
    const doc1 = makeDoc({ id: 'dup', constraints: 'first' });
    const doc2 = makeDoc({ id: 'dup', constraints: 'second' });
    await store.putBatch([doc1, doc2]);
    expect(store.size).toBe(1);
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
    // Map.delete returns false for subsequent attempts on the same key
    expect(deleted).toBe(1);
  });
});
