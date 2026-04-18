import { describe, it, expect } from 'vitest';
import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import {
  generateProof,
  verifyCounterparty,
  verifyCounterpartyHardened,
  verifyCounterpartiesBatch,
  HandshakeCache,
  TRUST_PRESETS,
  resolveTrustLevel,
  withTrustLevel,
} from './handshake.js';
import type { ProofOfBehavior } from './handshake.js';

async function makeProof(
  covenantSrc: string,
  actions: Array<{ action: string; params: Record<string, unknown> }>,
): Promise<ProofOfBehavior> {
  const identity = await createDID();
  const spec = parseSource(covenantSrc);
  const mw = new EnforcementMiddleware({ agentDid: identity.did, spec });
  for (const a of actions) await mw.execute(a, async () => ({ ok: true }));
  return generateProof({ identity, covenant: spec, actionLog: mw.getLog() });
}

describe('handshake hardening', () => {
  // ── Trust presets ──────────────────────────────────────────────────────

  describe('trust presets', () => {
    it('presets have the expected shape', () => {
      expect(TRUST_PRESETS.strict.minActions).toBeGreaterThan(TRUST_PRESETS.normal.minActions);
      expect(TRUST_PRESETS.permissive.minActions).toBe(0);
      expect(TRUST_PRESETS.strict.maxViolations).toBe(0);
    });

    it('resolveTrustLevel returns the preset thresholds', () => {
      expect(resolveTrustLevel('strict')).toEqual(TRUST_PRESETS.strict);
    });

    it('withTrustLevel fills gaps without overriding explicit values', () => {
      const explicit = withTrustLevel('strict', { minActions: 5 });
      expect(explicit.minActions).toBe(5); // caller wins
      expect(explicit.maxViolations).toBe(0); // preset fills in
    });

    it('strict preset rejects an agent with insufficient history', async () => {
      const proof = await makeProof(
        'covenant X { permit read; }',
        [{ action: 'read', params: {} }],
      );
      const result = await verifyCounterpartyHardened(proof, { trustLevel: 'strict' });
      expect(result.trusted).toBe(false);
      expect(result.reason).toMatch(/minimum/);
    });

    it('permissive preset trusts a fresh agent', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const result = await verifyCounterpartyHardened(proof, { trustLevel: 'permissive' });
      expect(result.trusted).toBe(true);
    });
  });

  // ── Cache ──────────────────────────────────────────────────────────────

  describe('HandshakeCache', () => {
    it('returns a cached result on a second call with the same proof+options', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const cache = new HandshakeCache();
      const r1 = await verifyCounterpartyHardened(proof, { cache });
      const r2 = await verifyCounterpartyHardened(proof, { cache });
      // Cached results share identity with the stored object.
      expect(r2).toBe(r1);
      expect(cache.stats().hits).toBe(1);
      expect(cache.stats().misses).toBe(1);
    });

    it('different options produce different cache keys', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const cache = new HandshakeCache();
      await verifyCounterpartyHardened(proof, { cache });
      await verifyCounterpartyHardened(proof, { cache, trustLevel: 'strict' });
      expect(cache.size).toBe(2);
    });

    it('respects TTL expiry', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const cache = new HandshakeCache({ ttlMs: 0 });
      await verifyCounterpartyHardened(proof, { cache });
      // TTL=0 means entries are expired immediately.
      await new Promise((r) => setTimeout(r, 2));
      await verifyCounterpartyHardened(proof, { cache });
      expect(cache.stats().misses).toBeGreaterThanOrEqual(2);
    });

    it('enforces maxEntries (LRU-style eviction)', async () => {
      const cache = new HandshakeCache({ maxEntries: 2 });
      const p1 = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const p2 = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const p3 = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      await verifyCounterpartyHardened(p1, { cache });
      await verifyCounterpartyHardened(p2, { cache });
      await verifyCounterpartyHardened(p3, { cache });
      expect(cache.size).toBe(2);
    });

    it('HandshakeCache.key is stable for identical inputs', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const k1 = HandshakeCache.key(proof, { minActions: 5 });
      const k2 = HandshakeCache.key(proof, { minActions: 5 });
      expect(k1).toBe(k2);
    });

    it('clear empties the cache', async () => {
      const cache = new HandshakeCache();
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      await verifyCounterpartyHardened(proof, { cache });
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  // ── Batch verification ─────────────────────────────────────────────────

  describe('verifyCounterpartiesBatch', () => {
    it('returns allTrusted when every proof passes', async () => {
      const proofs = await Promise.all([
        makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]),
        makeProof('covenant Y { permit write; }', [{ action: 'write', params: {} }]),
      ]);
      const batch = await verifyCounterpartiesBatch(
        proofs.map((proof) => ({ proof })),
      );
      expect(batch.allTrusted).toBe(true);
      expect(batch.untrustedCount).toBe(0);
      expect(batch.results).toHaveLength(2);
    });

    it('reports untrusted indexes when some fail', async () => {
      const good = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const bad = await makeProof('covenant Y { permit read; }', []);
      const batch = await verifyCounterpartiesBatch(
        [
          { proof: good },
          { proof: bad, options: { minActions: 5 } },
        ],
      );
      expect(batch.allTrusted).toBe(false);
      expect(batch.untrustedIndexes).toEqual([1]);
    });

    it('shares the cache across successive batch calls', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const cache = new HandshakeCache();
      // First batch populates the cache.
      await verifyCounterpartiesBatch([{ proof }], { cache });
      // Second batch should hit.
      await verifyCounterpartiesBatch([{ proof }], { cache });
      expect(cache.stats().hits).toBeGreaterThanOrEqual(1);
    });

    it('respects a shared trust level', async () => {
      const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
      const batch = await verifyCounterpartiesBatch(
        [{ proof }],
        { trustLevel: 'strict' },
      );
      expect(batch.results[0]!.trusted).toBe(false);
    });
  });

  // ── Non-regression ─────────────────────────────────────────────────────

  it('verifyCounterpartyHardened without cache/preset equals verifyCounterparty', async () => {
    const proof = await makeProof('covenant X { permit read; }', [{ action: 'read', params: {} }]);
    const a = await verifyCounterparty(proof);
    const b = await verifyCounterpartyHardened(proof);
    expect(b.trusted).toBe(a.trusted);
    expect(b.reason).toBe(a.reason);
  });
});
