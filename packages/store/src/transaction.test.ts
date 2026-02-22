import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './index';
import { createTransaction } from './transaction';
import type { Transaction } from './transaction';
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
// Transaction — put + commit
// ---------------------------------------------------------------------------
describe('Transaction - put + commit', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('put + commit stores the document in the backing store', async () => {
    const tx = createTransaction(store);
    const doc = makeDoc({ id: 'doc-1' });
    tx.put(doc);
    await tx.commit();

    expect(await store.has('doc-1')).toBe(true);
    const retrieved = await store.get('doc-1');
    expect(retrieved!.id).toBe('doc-1');
  });

  it('put does not affect the backing store before commit', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'doc-1' }));

    // Before commit, the store should not have the document
    expect(await store.has('doc-1')).toBe(false);
  });

  it('put multiple documents and commit stores all', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'doc-1' }));
    tx.put(makeDoc({ id: 'doc-2' }));
    tx.put(makeDoc({ id: 'doc-3' }));
    await tx.commit();

    expect(await store.has('doc-1')).toBe(true);
    expect(await store.has('doc-2')).toBe(true);
    expect(await store.has('doc-3')).toBe(true);
    expect(store.size).toBe(3);
  });

  it('put with same ID overwrites previous staged put', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'doc-1', constraints: 'PERMIT read' }));
    tx.put(makeDoc({ id: 'doc-1', constraints: 'DENY write' }));
    await tx.commit();

    const retrieved = await store.get('doc-1');
    expect(retrieved!.constraints).toBe('DENY write');
  });
});

// ---------------------------------------------------------------------------
// Transaction — delete + commit
// ---------------------------------------------------------------------------
describe('Transaction - delete + commit', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.put(makeDoc({ id: 'existing-1' }));
    await store.put(makeDoc({ id: 'existing-2' }));
  });

  it('delete + commit removes the document from the backing store', async () => {
    const tx = createTransaction(store);
    tx.delete('existing-1');
    await tx.commit();

    expect(await store.has('existing-1')).toBe(false);
  });

  it('delete does not affect the backing store before commit', async () => {
    const tx = createTransaction(store);
    tx.delete('existing-1');

    // Before commit, the store should still have the document
    expect(await store.has('existing-1')).toBe(true);
  });

  it('delete of non-existent ID commits without error', async () => {
    const tx = createTransaction(store);
    tx.delete('nonexistent');
    await expect(tx.commit()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Transaction — rollback discards
// ---------------------------------------------------------------------------
describe('Transaction - rollback', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.put(makeDoc({ id: 'existing-1' }));
  });

  it('rollback discards staged puts', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'new-doc' }));
    tx.rollback();

    expect(await store.has('new-doc')).toBe(false);
  });

  it('rollback discards staged deletes', async () => {
    const tx = createTransaction(store);
    tx.delete('existing-1');
    tx.rollback();

    expect(await store.has('existing-1')).toBe(true);
  });

  it('rollback resets pending count to 0', () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    tx.put(makeDoc({ id: 'b' }));
    tx.delete('existing-1');
    expect(tx.pendingCount).toBe(3);

    tx.rollback();
    expect(tx.pendingCount).toBe(0);
  });

  it('commit after rollback throws', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    tx.rollback();

    expect(() => tx.put(makeDoc({ id: 'b' }))).toThrow();
    await expect(tx.commit()).rejects.toThrow();
  });

  it('rollback after commit throws', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    await tx.commit();

    expect(() => tx.rollback()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Transaction — multiple operations in one transaction
// ---------------------------------------------------------------------------
describe('Transaction - multiple operations', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.put(makeDoc({ id: 'keep' }));
    await store.put(makeDoc({ id: 'remove' }));
  });

  it('can mix puts and deletes in one transaction', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'new-1' }));
    tx.put(makeDoc({ id: 'new-2' }));
    tx.delete('remove');
    await tx.commit();

    expect(await store.has('keep')).toBe(true);
    expect(await store.has('new-1')).toBe(true);
    expect(await store.has('new-2')).toBe(true);
    expect(await store.has('remove')).toBe(false);
    expect(store.size).toBe(3); // keep + new-1 + new-2
  });

  it('delete then put on same ID results in document existing after commit', async () => {
    const tx = createTransaction(store);
    tx.delete('keep');
    tx.put(makeDoc({ id: 'keep', constraints: 'UPDATED' }));
    await tx.commit();

    expect(await store.has('keep')).toBe(true);
    const doc = await store.get('keep');
    expect(doc!.constraints).toBe('UPDATED');
  });

  it('put then delete on same ID results in document being removed after commit', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'brand-new' }));
    tx.delete('brand-new');
    await tx.commit();

    expect(await store.has('brand-new')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transaction — pendingCount tracking
// ---------------------------------------------------------------------------
describe('Transaction - pendingCount', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('starts at 0', () => {
    const tx = createTransaction(store);
    expect(tx.pendingCount).toBe(0);
  });

  it('increments with each unique put', () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    expect(tx.pendingCount).toBe(1);
    tx.put(makeDoc({ id: 'b' }));
    expect(tx.pendingCount).toBe(2);
  });

  it('increments with each unique delete', () => {
    const tx = createTransaction(store);
    tx.delete('a');
    expect(tx.pendingCount).toBe(1);
    tx.delete('b');
    expect(tx.pendingCount).toBe(2);
  });

  it('does not double-count put on the same ID', () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    tx.put(makeDoc({ id: 'a' })); // same ID, overwrites
    expect(tx.pendingCount).toBe(1);
  });

  it('delete overwrites a previous put on the same ID', () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    tx.delete('a');
    expect(tx.pendingCount).toBe(1); // now a delete op for 'a'
  });

  it('put overwrites a previous delete on the same ID', () => {
    const tx = createTransaction(store);
    tx.delete('a');
    tx.put(makeDoc({ id: 'a' }));
    expect(tx.pendingCount).toBe(1); // now a put op for 'a'
  });

  it('commit resets pending count to 0', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'a' }));
    tx.put(makeDoc({ id: 'b' }));
    tx.delete('c');
    expect(tx.pendingCount).toBe(3);

    await tx.commit();
    expect(tx.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transaction — has/get reflect staged operations
// ---------------------------------------------------------------------------
describe('Transaction - has/get reflect staged operations', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.put(makeDoc({ id: 'existing', constraints: 'ORIGINAL' }));
  });

  it('has returns true for staged put (new document)', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'new-doc' }));
    expect(await tx.has('new-doc')).toBe(true);
  });

  it('has returns false for staged delete (existing document)', async () => {
    const tx = createTransaction(store);
    tx.delete('existing');
    expect(await tx.has('existing')).toBe(false);
  });

  it('has falls through to backing store for unstaged documents', async () => {
    const tx = createTransaction(store);
    expect(await tx.has('existing')).toBe(true);
    expect(await tx.has('nonexistent')).toBe(false);
  });

  it('get returns staged document for put', async () => {
    const tx = createTransaction(store);
    const doc = makeDoc({ id: 'new-doc', constraints: 'STAGED' });
    tx.put(doc);
    const result = await tx.get('new-doc');
    expect(result).toBeDefined();
    expect(result!.constraints).toBe('STAGED');
  });

  it('get returns undefined for staged delete', async () => {
    const tx = createTransaction(store);
    tx.delete('existing');
    const result = await tx.get('existing');
    expect(result).toBeUndefined();
  });

  it('get falls through to backing store for unstaged documents', async () => {
    const tx = createTransaction(store);
    const result = await tx.get('existing');
    expect(result).toBeDefined();
    expect(result!.constraints).toBe('ORIGINAL');
  });

  it('get returns staged version even when document exists in store', async () => {
    const tx = createTransaction(store);
    tx.put(makeDoc({ id: 'existing', constraints: 'UPDATED' }));
    const result = await tx.get('existing');
    expect(result!.constraints).toBe('UPDATED');
  });
});

// ---------------------------------------------------------------------------
// Transaction — error after finalized
// ---------------------------------------------------------------------------
describe('Transaction - error on use after finalization', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('put throws after commit', async () => {
    const tx = createTransaction(store);
    await tx.commit();
    expect(() => tx.put(makeDoc({ id: 'a' }))).toThrow('committed');
  });

  it('delete throws after commit', async () => {
    const tx = createTransaction(store);
    await tx.commit();
    expect(() => tx.delete('a')).toThrow('committed');
  });

  it('put throws after rollback', () => {
    const tx = createTransaction(store);
    tx.rollback();
    expect(() => tx.put(makeDoc({ id: 'a' }))).toThrow('rolled back');
  });

  it('delete throws after rollback', () => {
    const tx = createTransaction(store);
    tx.rollback();
    expect(() => tx.delete('a')).toThrow('rolled back');
  });

  it('double commit throws', async () => {
    const tx = createTransaction(store);
    await tx.commit();
    await expect(tx.commit()).rejects.toThrow('committed');
  });

  it('double rollback throws', () => {
    const tx = createTransaction(store);
    tx.rollback();
    expect(() => tx.rollback()).toThrow('rolled back');
  });
});
