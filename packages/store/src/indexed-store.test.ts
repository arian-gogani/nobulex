import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './index';
import { IndexedStore } from './indexed-store';
import type { CovenantStore, StoreEvent, StoreEventCallback } from './types';
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

// ---------------------------------------------------------------------------
// IndexedStore — basic MemoryStore behaviors work through IndexedStore
// ---------------------------------------------------------------------------
describe('IndexedStore - basic CRUD (like MemoryStore)', () => {
  let backing: MemoryStore;
  let store: IndexedStore;

  beforeEach(() => {
    backing = new MemoryStore();
    store = new IndexedStore(backing);
  });

  it('implements CovenantStore interface', () => {
    const s: CovenantStore = store;
    expect(typeof s.put).toBe('function');
    expect(typeof s.get).toBe('function');
    expect(typeof s.has).toBe('function');
    expect(typeof s.delete).toBe('function');
    expect(typeof s.list).toBe('function');
    expect(typeof s.count).toBe('function');
    expect(typeof s.putBatch).toBe('function');
    expect(typeof s.getBatch).toBe('function');
    expect(typeof s.deleteBatch).toBe('function');
    expect(typeof s.onEvent).toBe('function');
    expect(typeof s.offEvent).toBe('function');
  });

  it('put stores and get retrieves', async () => {
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);
    const retrieved = await store.get('doc-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('doc-1');
  });

  it('has returns true for existing document', async () => {
    await store.put(makeDoc({ id: 'doc-1' }));
    expect(await store.has('doc-1')).toBe(true);
  });

  it('has returns false for missing document', async () => {
    expect(await store.has('missing')).toBe(false);
  });

  it('delete removes and returns true', async () => {
    await store.put(makeDoc({ id: 'doc-1' }));
    const deleted = await store.delete('doc-1');
    expect(deleted).toBe(true);
    expect(await store.has('doc-1')).toBe(false);
  });

  it('delete returns false for missing document', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('list without filter returns all documents', async () => {
    await store.put(makeDoc({ id: 'a' }));
    await store.put(makeDoc({ id: 'b' }));
    await store.put(makeDoc({ id: 'c' }));
    const docs = await store.list();
    expect(docs.length).toBe(3);
  });

  it('count without filter returns total documents', async () => {
    await store.put(makeDoc({ id: 'a' }));
    await store.put(makeDoc({ id: 'b' }));
    expect(await store.count()).toBe(2);
  });

  it('putBatch stores multiple documents', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);
    expect(await store.has('a')).toBe(true);
    expect(await store.has('b')).toBe(true);
  });

  it('getBatch retrieves multiple documents', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);
    const results = await store.getBatch(['b', 'a', 'missing']);
    expect(results.length).toBe(3);
    expect(results[0]!.id).toBe('b');
    expect(results[1]!.id).toBe('a');
    expect(results[2]).toBeUndefined();
  });

  it('deleteBatch removes multiple documents', async () => {
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })]);
    const deleted = await store.deleteBatch(['a', 'c']);
    expect(deleted).toBe(2);
    expect(await store.has('a')).toBe(false);
    expect(await store.has('b')).toBe(true);
    expect(await store.has('c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — filtered queries use indexes
// ---------------------------------------------------------------------------
describe('IndexedStore - filtered queries use indexes', () => {
  let backing: MemoryStore;
  let store: IndexedStore;

  beforeEach(async () => {
    backing = new MemoryStore();
    store = new IndexedStore(backing);

    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-01-15T00:00:00.000Z',
      metadata: { tags: ['ai', 'safety'] },
    }));

    await store.put(makeDoc({
      id: 'doc-2',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'carol', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-06-15T00:00:00.000Z',
      metadata: { tags: ['ai', 'compliance'] },
    }));

    await store.put(makeDoc({
      id: 'doc-3',
      issuer: { id: 'dave', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-12-01T00:00:00.000Z',
      metadata: { tags: ['governance'] },
    }));
  });

  it('list filters by issuerId', async () => {
    const docs = await store.list({ issuerId: 'alice' });
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('list filters by beneficiaryId', async () => {
    const docs = await store.list({ beneficiaryId: 'bob' });
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-3']);
  });

  it('list filters by tags', async () => {
    const docs = await store.list({ tags: ['ai'] });
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('list filters by multiple tags (AND)', async () => {
    const docs = await store.list({ tags: ['ai', 'safety'] });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('doc-1');
  });

  it('list filters by createdAfter', async () => {
    const docs = await store.list({ createdAfter: '2025-06-01T00:00:00.000Z' });
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.id).sort()).toEqual(['doc-2', 'doc-3']);
  });

  it('list filters by createdBefore', async () => {
    const docs = await store.list({ createdBefore: '2025-06-30T00:00:00.000Z' });
    expect(docs.length).toBe(2);
    expect(docs.map((d) => d.id).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('list with compound filter (issuerId + beneficiaryId)', async () => {
    const docs = await store.list({ issuerId: 'alice', beneficiaryId: 'bob' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('doc-1');
  });

  it('list with no matches returns empty array', async () => {
    const docs = await store.list({ issuerId: 'nobody' });
    expect(docs.length).toBe(0);
  });

  it('count with filter returns correct count', async () => {
    expect(await store.count({ issuerId: 'alice' })).toBe(2);
    expect(await store.count({ issuerId: 'dave' })).toBe(1);
    expect(await store.count({ issuerId: 'nobody' })).toBe(0);
  });

  it('index stats show correct document count', () => {
    const stats = store.indexStats();
    expect(stats.documentCount).toBe(3);
  });

  it('index stats show correct index sizes', () => {
    const stats = store.indexStats();
    expect(stats.indexSizes['issuerId']).toBe(2); // alice, dave
    expect(stats.indexSizes['beneficiaryId']).toBe(2); // bob, carol
    expect(stats.indexSizes['tags']).toBe(4); // ai, safety, compliance, governance
    expect(stats.indexSizes['createdAt']).toBe(3); // 3 time entries
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — hasChain filter (not indexed, falls back to scan)
// ---------------------------------------------------------------------------
describe('IndexedStore - hasChain filter (not indexed)', () => {
  let store: IndexedStore;

  beforeEach(async () => {
    const backing = new MemoryStore();
    store = new IndexedStore(backing);

    await store.put(makeDoc({ id: 'root-1' }));
    await store.put(makeDoc({
      id: 'chained-1',
      chain: { parentId: 'parent-1' as any, relation: 'delegates' as any, depth: 1 },
    }));
  });

  it('list filters by hasChain = true', async () => {
    const docs = await store.list({ hasChain: true });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('chained-1');
  });

  it('list filters by hasChain = false', async () => {
    const docs = await store.list({ hasChain: false });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('root-1');
  });

  it('combined hasChain + indexed field', async () => {
    await store.put(makeDoc({
      id: 'chained-alice',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      chain: { parentId: 'parent-1' as any, relation: 'delegates' as any, depth: 1 },
    }));

    const docs = await store.list({ issuerId: 'alice', hasChain: true });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('chained-alice');
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — index consistency after put/delete
// ---------------------------------------------------------------------------
describe('IndexedStore - index consistency', () => {
  let backing: MemoryStore;
  let store: IndexedStore;

  beforeEach(async () => {
    backing = new MemoryStore();
    store = new IndexedStore(backing);
  });

  it('put updates the index', async () => {
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    expect(store.indexStats().documentCount).toBe(1);

    const docs = await store.list({ issuerId: 'alice' });
    expect(docs.length).toBe(1);
  });

  it('delete removes from index', async () => {
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    await store.delete('doc-1');

    expect(store.indexStats().documentCount).toBe(0);

    const docs = await store.list({ issuerId: 'alice' });
    expect(docs.length).toBe(0);
  });

  it('put overwrites updates the index correctly', async () => {
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    // Overwrite with different issuer
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    expect(store.indexStats().documentCount).toBe(1);

    const aliceDocs = await store.list({ issuerId: 'alice' });
    expect(aliceDocs.length).toBe(0);

    const bobDocs = await store.list({ issuerId: 'bob' });
    expect(bobDocs.length).toBe(1);
  });

  it('putBatch updates the index for all documents', async () => {
    await store.putBatch([
      makeDoc({
        id: 'a',
        issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      }),
      makeDoc({
        id: 'b',
        issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      }),
    ]);

    expect(store.indexStats().documentCount).toBe(2);

    const aliceDocs = await store.list({ issuerId: 'alice' });
    expect(aliceDocs.length).toBe(1);
    expect(aliceDocs[0]!.id).toBe('a');
  });

  it('deleteBatch removes all from index', async () => {
    await store.putBatch([
      makeDoc({ id: 'a' }),
      makeDoc({ id: 'b' }),
      makeDoc({ id: 'c' }),
    ]);
    await store.deleteBatch(['a', 'c']);

    expect(store.indexStats().documentCount).toBe(1);
  });

  it('index remains consistent through many operations', async () => {
    // Build up
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      metadata: { tags: ['ai'] },
    }));
    await store.put(makeDoc({
      id: 'doc-2',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      metadata: { tags: ['ai', 'safety'] },
    }));
    await store.put(makeDoc({
      id: 'doc-3',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      metadata: { tags: ['governance'] },
    }));

    // Delete one
    await store.delete('doc-2');

    // Overwrite one
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      metadata: { tags: ['governance'] },
    }));

    // Verify
    expect(store.indexStats().documentCount).toBe(2);

    const aliceDocs = await store.list({ issuerId: 'alice' });
    expect(aliceDocs.length).toBe(0);

    const bobDocs = await store.list({ issuerId: 'bob' });
    expect(bobDocs.length).toBe(2);

    const aiDocs = await store.list({ tags: ['ai'] });
    expect(aiDocs.length).toBe(0);

    const govDocs = await store.list({ tags: ['governance'] });
    expect(govDocs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — rebuildIndexes
// ---------------------------------------------------------------------------
describe('IndexedStore - rebuildIndexes', () => {
  it('rebuildIndexes re-creates indexes from backing store', async () => {
    const backing = new MemoryStore();
    const store = new IndexedStore(backing);

    // Put documents through the indexed store
    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    await store.put(makeDoc({
      id: 'doc-2',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    // Directly modify the backing store (bypassing the index)
    await backing.delete('doc-2');

    // Index thinks doc-2 still exists
    expect(store.indexStats().documentCount).toBe(2);

    // Rebuild
    await store.rebuildIndexes();

    // Now index should match backing store
    expect(store.indexStats().documentCount).toBe(1);
    const docs = await store.list({ issuerId: 'bob' });
    expect(docs.length).toBe(0);
  });

  it('rebuildIndexes works on a fresh store with existing data', async () => {
    const backing = new MemoryStore();
    // Pre-populate the backing store
    await backing.put(makeDoc({
      id: 'pre-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    await backing.put(makeDoc({
      id: 'pre-2',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    // Create indexed store on top of pre-populated backing
    const store = new IndexedStore(backing);

    // First query triggers lazy initialization
    const docs = await store.list({ issuerId: 'alice' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.id).toBe('pre-1');

    expect(store.indexStats().documentCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — events delegate to backing store
// ---------------------------------------------------------------------------
describe('IndexedStore - events', () => {
  it('onEvent/offEvent delegate to backing store', async () => {
    const backing = new MemoryStore();
    const store = new IndexedStore(backing);
    const events: StoreEvent[] = [];
    const listener: StoreEventCallback = (e) => events.push(e);

    store.onEvent(listener);
    await store.put(makeDoc({ id: 'doc-1' }));

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('put');
    expect(events[0]!.documentId).toBe('doc-1');

    store.offEvent(listener);
    await store.put(makeDoc({ id: 'doc-2' }));
    expect(events.length).toBe(1); // no new event
  });

  it('delete events fire correctly', async () => {
    const backing = new MemoryStore();
    const store = new IndexedStore(backing);
    const events: StoreEvent[] = [];

    await store.put(makeDoc({ id: 'doc-1' }));
    store.onEvent((e) => events.push(e));
    await store.delete('doc-1');

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('delete');
    expect(events[0]!.documentId).toBe('doc-1');
  });
});

// ---------------------------------------------------------------------------
// IndexedStore — custom index fields
// ---------------------------------------------------------------------------
describe('IndexedStore - custom index fields', () => {
  it('only indexes specified fields', async () => {
    const backing = new MemoryStore();
    const store = new IndexedStore(backing, ['issuerId']);

    await store.put(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      metadata: { tags: ['ai'] },
    }));

    const stats = store.indexStats();
    expect(stats.fields).toEqual(['issuerId']);
    expect('issuerId' in stats.indexSizes).toBe(true);
    expect('tags' in stats.indexSizes).toBe(false);
  });
});
