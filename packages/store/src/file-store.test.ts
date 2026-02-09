import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from './file-store';
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

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stele-filestore-test-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// FileStore — instantiation
// ---------------------------------------------------------------------------
describe('FileStore - instantiation', () => {
  it('can be constructed with a directory path', () => {
    const store = new FileStore(testDir);
    expect(store).toBeDefined();
  });

  it('implements CovenantStore interface', () => {
    const store: CovenantStore = new FileStore(testDir);
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

  it('auto-creates directory on first put', async () => {
    const nestedDir = path.join(testDir, 'deeply', 'nested', 'store');
    const store = new FileStore(nestedDir);
    await store.put(makeDoc({ id: 'doc-1' }));
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FileStore — put / get / has / delete
// ---------------------------------------------------------------------------
describe('FileStore - CRUD', () => {
  let store: FileStore;

  beforeEach(() => {
    store = new FileStore(testDir);
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
    expect(await store.get('doc-1')).toBeUndefined();
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

  it('delete removes the document file from disk', async () => {
    const doc = makeDoc({ id: 'doc-1' });
    await store.put(doc);
    const filePath = path.join(testDir, 'doc-1.json');
    const existsBefore = await fs.stat(filePath).then(() => true).catch(() => false);
    expect(existsBefore).toBe(true);

    await store.delete('doc-1');
    const existsAfter = await fs.stat(filePath).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FileStore — list
// ---------------------------------------------------------------------------
describe('FileStore - list', () => {
  let store: FileStore;

  beforeEach(async () => {
    store = new FileStore(testDir);
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
// FileStore — count
// ---------------------------------------------------------------------------
describe('FileStore - count', () => {
  let store: FileStore;

  beforeEach(async () => {
    store = new FileStore(testDir);
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
    const emptyStore = new FileStore(path.join(testDir, 'empty'));
    expect(await emptyStore.count()).toBe(0);
  });

  it('count returns 0 when no documents match', async () => {
    expect(await store.count({ issuerId: 'nonexistent' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FileStore — batch operations
// ---------------------------------------------------------------------------
describe('FileStore - batch operations', () => {
  let store: FileStore;

  beforeEach(() => {
    store = new FileStore(testDir);
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
});

// ---------------------------------------------------------------------------
// FileStore — event system
// ---------------------------------------------------------------------------
describe('FileStore - events', () => {
  let store: FileStore;

  beforeEach(() => {
    store = new FileStore(testDir);
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
// FileStore — persistence
// ---------------------------------------------------------------------------
describe('FileStore - persistence', () => {
  it('data survives creating a new store instance', async () => {
    const store1 = new FileStore(testDir);
    await store1.put(makeDoc({ id: 'doc-1', constraints: 'PERMIT all' }));
    await store1.put(makeDoc({ id: 'doc-2', constraints: 'DENY all' }));

    // Create a completely new instance pointing to the same directory
    const store2 = new FileStore(testDir);
    const doc1 = await store2.get('doc-1');
    const doc2 = await store2.get('doc-2');
    expect(doc1).toBeDefined();
    expect(doc1!.constraints).toBe('PERMIT all');
    expect(doc2).toBeDefined();
    expect(doc2!.constraints).toBe('DENY all');
  });

  it('index survives creating a new store instance', async () => {
    const store1 = new FileStore(testDir);
    await store1.put(makeDoc({ id: 'doc-1' }));
    await store1.put(makeDoc({ id: 'doc-2' }));

    const store2 = new FileStore(testDir);
    expect(await store2.count()).toBe(2);
    expect(await store2.has('doc-1')).toBe(true);
    expect(await store2.has('doc-2')).toBe(true);
  });

  it('deletions persist across instances', async () => {
    const store1 = new FileStore(testDir);
    await store1.put(makeDoc({ id: 'doc-1' }));
    await store1.put(makeDoc({ id: 'doc-2' }));
    await store1.delete('doc-1');

    const store2 = new FileStore(testDir);
    expect(await store2.count()).toBe(1);
    expect(await store2.has('doc-1')).toBe(false);
    expect(await store2.has('doc-2')).toBe(true);
  });

  it('batch operations persist across instances', async () => {
    const store1 = new FileStore(testDir);
    await store1.putBatch([
      makeDoc({ id: 'a' }),
      makeDoc({ id: 'b' }),
      makeDoc({ id: 'c' }),
    ]);
    await store1.deleteBatch(['b']);

    const store2 = new FileStore(testDir);
    expect(await store2.count()).toBe(2);
    const docs = await store2.list();
    const ids = docs.map((d) => d.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });

  it('filters work on a fresh store instance with persisted data', async () => {
    const store1 = new FileStore(testDir);
    await store1.put(makeDoc({
      id: 'doc-alice',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' },
    }));
    await store1.put(makeDoc({
      id: 'doc-bob',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' },
    }));

    const store2 = new FileStore(testDir);
    const aliceDocs = await store2.list({ issuerId: 'alice' });
    expect(aliceDocs.length).toBe(1);
    expect(aliceDocs[0]!.id).toBe('doc-alice');
    expect(await store2.count({ issuerId: 'bob' })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FileStore — error handling
// ---------------------------------------------------------------------------
describe('FileStore - error handling', () => {
  it('get returns undefined when base directory does not exist', async () => {
    const store = new FileStore(path.join(testDir, 'nonexistent'));
    const result = await store.get('anything');
    expect(result).toBeUndefined();
  });

  it('has returns false when base directory does not exist', async () => {
    const store = new FileStore(path.join(testDir, 'nonexistent'));
    const result = await store.has('anything');
    expect(result).toBe(false);
  });

  it('list returns empty array when base directory does not exist', async () => {
    const store = new FileStore(path.join(testDir, 'nonexistent'));
    const docs = await store.list();
    expect(docs).toEqual([]);
  });

  it('count returns 0 when base directory does not exist', async () => {
    const store = new FileStore(path.join(testDir, 'nonexistent'));
    expect(await store.count()).toBe(0);
  });

  it('get throws on corrupted document file (invalid JSON)', async () => {
    const store = new FileStore(testDir);
    await store.put(makeDoc({ id: 'doc-1' }));

    // Corrupt the document file
    const docFilePath = path.join(testDir, 'doc-1.json');
    await fs.writeFile(docFilePath, '{invalid json!!!', 'utf-8');

    await expect(store.get('doc-1')).rejects.toThrow();
  });

  it('operations throw on corrupted index file (invalid JSON)', async () => {
    const store = new FileStore(testDir);
    await store.put(makeDoc({ id: 'doc-1' }));

    // Corrupt the index file
    const indexPath = path.join(testDir, '_index.json');
    await fs.writeFile(indexPath, 'not valid json {{{', 'utf-8');

    await expect(store.has('doc-1')).rejects.toThrow();
  });

  it('creates missing directories on put', async () => {
    const deepDir = path.join(testDir, 'level1', 'level2', 'level3');
    const store = new FileStore(deepDir);
    await store.put(makeDoc({ id: 'doc-1' }));
    expect(await store.get('doc-1')).toBeDefined();
  });

  it('creates missing directories on putBatch', async () => {
    const deepDir = path.join(testDir, 'batch', 'nested');
    const store = new FileStore(deepDir);
    await store.putBatch([makeDoc({ id: 'a' }), makeDoc({ id: 'b' })]);
    expect(await store.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FileStore — concurrent operations
// ---------------------------------------------------------------------------
describe('FileStore - concurrent operations', () => {
  let store: FileStore;

  beforeEach(() => {
    store = new FileStore(testDir);
  });

  it('handles concurrent puts without losing data', async () => {
    const docs = Array.from({ length: 20 }, (_, i) => makeDoc({ id: `concurrent-${i}` }));
    await Promise.all(docs.map((doc) => store.put(doc)));
    expect(await store.count()).toBe(20);
    for (const doc of docs) {
      expect(await store.has(doc.id)).toBe(true);
    }
  });

  it('handles concurrent put and delete correctly', async () => {
    // First put some docs
    await store.putBatch([
      makeDoc({ id: 'keep-1' }),
      makeDoc({ id: 'keep-2' }),
      makeDoc({ id: 'remove-1' }),
      makeDoc({ id: 'remove-2' }),
    ]);

    // Concurrently put new and delete old
    await Promise.all([
      store.put(makeDoc({ id: 'new-1' })),
      store.put(makeDoc({ id: 'new-2' })),
      store.delete('remove-1'),
      store.delete('remove-2'),
    ]);

    expect(await store.has('keep-1')).toBe(true);
    expect(await store.has('keep-2')).toBe(true);
    expect(await store.has('new-1')).toBe(true);
    expect(await store.has('new-2')).toBe(true);
    expect(await store.has('remove-1')).toBe(false);
    expect(await store.has('remove-2')).toBe(false);
    expect(await store.count()).toBe(4);
  });

  it('handles concurrent batch operations', async () => {
    const batch1 = Array.from({ length: 5 }, (_, i) => makeDoc({ id: `batch1-${i}` }));
    const batch2 = Array.from({ length: 5 }, (_, i) => makeDoc({ id: `batch2-${i}` }));

    await Promise.all([store.putBatch(batch1), store.putBatch(batch2)]);

    expect(await store.count()).toBe(10);
    for (const doc of [...batch1, ...batch2]) {
      expect(await store.has(doc.id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// FileStore — edge cases
// ---------------------------------------------------------------------------
describe('FileStore - edge cases', () => {
  let store: FileStore;

  beforeEach(() => {
    store = new FileStore(testDir);
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
    expect(deleted).toBe(1);
  });

  it('stores documents as individual JSON files on disk', async () => {
    await store.put(makeDoc({ id: 'check-file' }));
    const filePath = path.join(testDir, 'check-file.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe('check-file');
  });

  it('maintains an index file on disk', async () => {
    await store.put(makeDoc({ id: 'indexed' }));
    const indexPath = path.join(testDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.entries).toBeDefined();
    expect(parsed.entries['indexed']).toBeDefined();
    expect(parsed.entries['indexed'].issuerId).toBe('issuer-1');
  });

  it('list returns different array references on each call', async () => {
    await store.put(makeDoc({ id: 'a' }));
    const list1 = await store.list();
    const list2 = await store.list();
    expect(list1).not.toBe(list2);
  });

  it('atomic writes do not leave temp files on success', async () => {
    await store.put(makeDoc({ id: 'clean' }));
    const files = await fs.readdir(testDir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles.length).toBe(0);
  });
});
