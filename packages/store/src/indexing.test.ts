import { describe, it, expect, beforeEach } from 'vitest';
import { StoreIndex } from './indexing';
import type { IndexField } from './indexing';
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
// StoreIndex — build, add, remove
// ---------------------------------------------------------------------------
describe('StoreIndex - build, add, remove', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['issuerId', 'beneficiaryId', 'createdAt', 'tags']);
  });

  it('starts with zero documents', () => {
    const s = index.stats();
    expect(s.documentCount).toBe(0);
  });

  it('add increases document count', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    expect(index.stats().documentCount).toBe(1);
  });

  it('add multiple documents increases count correctly', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    index.add(makeDoc({ id: 'doc-2' }));
    index.add(makeDoc({ id: 'doc-3' }));
    expect(index.stats().documentCount).toBe(3);
  });

  it('adding the same document ID twice does not duplicate', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    index.add(makeDoc({ id: 'doc-1' }));
    expect(index.stats().documentCount).toBe(1);
  });

  it('adding the same ID with updated fields updates the index', () => {
    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    // Now update the issuer
    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    // Should find it under bob, not alice
    const aliceResult = index.query({ issuerId: 'alice' });
    const bobResult = index.query({ issuerId: 'bob' });
    expect(aliceResult!.size).toBe(0);
    expect(bobResult!.size).toBe(1);
  });

  it('remove decreases document count', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    index.add(makeDoc({ id: 'doc-2' }));
    index.remove('doc-1');
    expect(index.stats().documentCount).toBe(1);
  });

  it('remove of non-existent ID is a no-op', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    index.remove('nonexistent');
    expect(index.stats().documentCount).toBe(1);
  });

  it('remove cleans up issuer index entries', () => {
    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    index.remove('doc-1');

    const result = index.query({ issuerId: 'alice' });
    expect(result!.size).toBe(0);
  });

  it('remove cleans up beneficiary index entries', () => {
    index.add(makeDoc({
      id: 'doc-1',
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
    }));
    index.remove('doc-1');

    const result = index.query({ beneficiaryId: 'bob' });
    expect(result!.size).toBe(0);
  });

  it('remove cleans up tag index entries', () => {
    index.add(makeDoc({
      id: 'doc-1',
      metadata: { tags: ['ai', 'safety'] },
    }));
    index.remove('doc-1');

    const result = index.query({ tags: ['ai'] });
    expect(result!.size).toBe(0);
  });

  it('remove cleans up createdAt index entries', () => {
    index.add(makeDoc({ id: 'doc-1', createdAt: '2025-06-01T00:00:00.000Z' }));
    index.remove('doc-1');

    const result = index.query({
      createdAfter: '2025-01-01T00:00:00.000Z',
      createdBefore: '2025-12-31T00:00:00.000Z',
    });
    expect(result!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — query with single field filter
// ---------------------------------------------------------------------------
describe('StoreIndex - single field queries', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['issuerId', 'beneficiaryId', 'createdAt', 'tags']);

    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-01-15T00:00:00.000Z',
      metadata: { tags: ['ai', 'safety'] },
    }));

    index.add(makeDoc({
      id: 'doc-2',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'carol', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-06-15T00:00:00.000Z',
      metadata: { tags: ['ai', 'compliance'] },
    }));

    index.add(makeDoc({
      id: 'doc-3',
      issuer: { id: 'dave', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      createdAt: '2025-12-01T00:00:00.000Z',
      metadata: { tags: ['governance'] },
    }));
  });

  it('query by issuerId returns correct candidates', () => {
    const result = index.query({ issuerId: 'alice' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('doc-1')).toBe(true);
    expect(result!.has('doc-2')).toBe(true);
  });

  it('query by issuerId with no matches returns empty set', () => {
    const result = index.query({ issuerId: 'nobody' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it('query by beneficiaryId returns correct candidates', () => {
    const result = index.query({ beneficiaryId: 'bob' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('doc-1')).toBe(true);
    expect(result!.has('doc-3')).toBe(true);
  });

  it('query by beneficiaryId with no matches returns empty set', () => {
    const result = index.query({ beneficiaryId: 'nobody' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — query with multiple field filters (intersection)
// ---------------------------------------------------------------------------
describe('StoreIndex - compound queries (intersection)', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['issuerId', 'beneficiaryId', 'createdAt', 'tags']);

    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      metadata: { tags: ['ai'] },
    }));

    index.add(makeDoc({
      id: 'doc-2',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'carol', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      metadata: { tags: ['ai'] },
    }));

    index.add(makeDoc({
      id: 'doc-3',
      issuer: { id: 'dave', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
      beneficiary: { id: 'bob', publicKey: 'bb'.repeat(32), role: 'beneficiary' as const },
      metadata: { tags: ['governance'] },
    }));
  });

  it('issuerId + beneficiaryId narrows results correctly', () => {
    const result = index.query({ issuerId: 'alice', beneficiaryId: 'bob' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.has('doc-1')).toBe(true);
  });

  it('issuerId + tags narrows results correctly', () => {
    const result = index.query({ issuerId: 'alice', tags: ['ai'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('doc-1')).toBe(true);
    expect(result!.has('doc-2')).toBe(true);
  });

  it('compound query with no intersection returns empty set', () => {
    const result = index.query({ issuerId: 'alice', beneficiaryId: 'bob', tags: ['governance'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — range query on createdAt
// ---------------------------------------------------------------------------
describe('StoreIndex - createdAt range queries', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['createdAt']);

    index.add(makeDoc({ id: 'jan', createdAt: '2025-01-15T00:00:00.000Z' }));
    index.add(makeDoc({ id: 'jun', createdAt: '2025-06-15T00:00:00.000Z' }));
    index.add(makeDoc({ id: 'dec', createdAt: '2025-12-01T00:00:00.000Z' }));
  });

  it('createdAfter filters correctly', () => {
    const result = index.query({ createdAfter: '2025-06-01T00:00:00.000Z' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('jun')).toBe(true);
    expect(result!.has('dec')).toBe(true);
  });

  it('createdBefore filters correctly', () => {
    const result = index.query({ createdBefore: '2025-06-30T00:00:00.000Z' });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('jan')).toBe(true);
    expect(result!.has('jun')).toBe(true);
  });

  it('createdAfter + createdBefore defines a range', () => {
    const result = index.query({
      createdAfter: '2025-03-01T00:00:00.000Z',
      createdBefore: '2025-09-01T00:00:00.000Z',
    });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.has('jun')).toBe(true);
  });

  it('createdAfter equal to exact timestamp is inclusive', () => {
    const result = index.query({ createdAfter: '2025-06-15T00:00:00.000Z' });
    expect(result).not.toBeNull();
    expect(result!.has('jun')).toBe(true);
  });

  it('createdBefore equal to exact timestamp is inclusive', () => {
    const result = index.query({ createdBefore: '2025-06-15T00:00:00.000Z' });
    expect(result).not.toBeNull();
    expect(result!.has('jun')).toBe(true);
  });

  it('range with no matches returns empty set', () => {
    const result = index.query({
      createdAfter: '2026-01-01T00:00:00.000Z',
      createdBefore: '2026-12-31T00:00:00.000Z',
    });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — tag queries
// ---------------------------------------------------------------------------
describe('StoreIndex - tag queries', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['tags']);

    index.add(makeDoc({
      id: 'doc-1',
      metadata: { tags: ['ai', 'safety', 'governance'] },
    }));
    index.add(makeDoc({
      id: 'doc-2',
      metadata: { tags: ['ai', 'compliance'] },
    }));
    index.add(makeDoc({
      id: 'doc-3',
      metadata: { tags: ['governance'] },
    }));
    index.add(makeDoc({
      id: 'doc-4',
      // No tags
    }));
  });

  it('single tag query returns all documents with that tag', () => {
    const result = index.query({ tags: ['ai'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.has('doc-1')).toBe(true);
    expect(result!.has('doc-2')).toBe(true);
  });

  it('multiple tags query uses AND semantics', () => {
    const result = index.query({ tags: ['ai', 'safety'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.has('doc-1')).toBe(true);
  });

  it('tag query with no matches returns empty set', () => {
    const result = index.query({ tags: ['nonexistent'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it('tag query with one matching and one non-matching tag returns empty', () => {
    const result = index.query({ tags: ['ai', 'nonexistent'] });
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it('empty tags array in filter returns null (no index query needed)', () => {
    const result = index.query({ tags: [] });
    // Empty tags array doesn't trigger any index lookup
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — rebuild
// ---------------------------------------------------------------------------
describe('StoreIndex - rebuild', () => {
  let index: StoreIndex;

  beforeEach(() => {
    index = new StoreIndex(['issuerId', 'beneficiaryId', 'createdAt', 'tags']);
  });

  it('rebuild clears existing data and reindexes', () => {
    index.add(makeDoc({ id: 'old-doc' }));
    expect(index.stats().documentCount).toBe(1);

    const newDocs = [
      makeDoc({ id: 'new-1' }),
      makeDoc({ id: 'new-2' }),
    ];

    index.rebuild(newDocs);

    expect(index.stats().documentCount).toBe(2);
    // Old doc should not be findable
    const result = index.query({ issuerId: 'issuer-1' });
    expect(result).not.toBeNull();
    expect(result!.has('old-doc')).toBe(false);
    expect(result!.has('new-1')).toBe(true);
    expect(result!.has('new-2')).toBe(true);
  });

  it('rebuild with empty array clears the index', () => {
    index.add(makeDoc({ id: 'doc-1' }));
    index.add(makeDoc({ id: 'doc-2' }));
    index.rebuild([]);
    expect(index.stats().documentCount).toBe(0);
  });

  it('rebuild produces correct index sizes', () => {
    const docs = [
      makeDoc({
        id: 'doc-1',
        issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
        metadata: { tags: ['ai', 'safety'] },
      }),
      makeDoc({
        id: 'doc-2',
        issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
        metadata: { tags: ['ai'] },
      }),
    ];

    index.rebuild(docs);

    const stats = index.stats();
    expect(stats.indexSizes['issuerId']).toBe(2); // alice, bob
    expect(stats.indexSizes['tags']).toBe(2); // ai, safety
    expect(stats.indexSizes['createdAt']).toBe(2); // 2 time entries
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — stats
// ---------------------------------------------------------------------------
describe('StoreIndex - stats', () => {
  it('reports fields correctly', () => {
    const index = new StoreIndex(['issuerId', 'tags']);
    const stats = index.stats();
    expect(stats.fields).toContain('issuerId');
    expect(stats.fields).toContain('tags');
    expect(stats.fields).not.toContain('beneficiaryId');
    expect(stats.fields).not.toContain('createdAt');
  });

  it('reports document count correctly', () => {
    const index = new StoreIndex(['issuerId']);
    index.add(makeDoc({ id: 'a' }));
    index.add(makeDoc({ id: 'b' }));
    expect(index.stats().documentCount).toBe(2);
  });

  it('reports index sizes correctly for issuerId', () => {
    const index = new StoreIndex(['issuerId']);
    index.add(makeDoc({
      id: 'doc-1',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    index.add(makeDoc({
      id: 'doc-2',
      issuer: { id: 'alice', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));
    index.add(makeDoc({
      id: 'doc-3',
      issuer: { id: 'bob', publicKey: 'aa'.repeat(32), role: 'issuer' as const },
    }));

    const stats = index.stats();
    // 2 unique issuer IDs (alice, bob)
    expect(stats.indexSizes['issuerId']).toBe(2);
  });

  it('only reports sizes for indexed fields', () => {
    const index = new StoreIndex(['issuerId']);
    const stats = index.stats();
    expect('issuerId' in stats.indexSizes).toBe(true);
    expect('beneficiaryId' in stats.indexSizes).toBe(false);
    expect('tags' in stats.indexSizes).toBe(false);
    expect('createdAt' in stats.indexSizes).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StoreIndex — null return (no index available)
// ---------------------------------------------------------------------------
describe('StoreIndex - no index available', () => {
  it('returns null when querying a field not covered by any index', () => {
    const index = new StoreIndex(['issuerId']); // only issuerId indexed
    index.add(makeDoc({ id: 'doc-1' }));

    // hasChain is never indexed
    const result = index.query({ hasChain: true });
    expect(result).toBeNull();
  });

  it('returns null for an empty filter', () => {
    const index = new StoreIndex(['issuerId', 'tags']);
    index.add(makeDoc({ id: 'doc-1' }));

    const result = index.query({});
    expect(result).toBeNull();
  });

  it('returns null when querying beneficiaryId but only issuerId is indexed', () => {
    const index = new StoreIndex(['issuerId']);
    index.add(makeDoc({ id: 'doc-1' }));

    const result = index.query({ beneficiaryId: 'someone' });
    expect(result).toBeNull();
  });
});
