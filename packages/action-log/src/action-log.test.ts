import { describe, it, expect } from 'vitest';
import {
  ActionLogBuilder,
  computeEntryHash,
  verifyIntegrity,
  verifyPartial,
  buildMerkleTree,
  generateMerkleProof,
  verifyMerkleProof,
} from './index';

describe('@nobulex/action-log', () => {
  // ── Builder ───────────────────────────────────────────────────────────────

  describe('ActionLogBuilder', () => {
    it('creates an empty log', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      expect(builder.agentDid).toBe('did:nobulex:agent-1');
      expect(builder.length).toBe(0);
      const log = builder.toLog();
      expect(log.entries).toHaveLength(0);
      expect(log.rootHash).toBeNull();
      expect(log.headHash).toBeNull();
      expect(log.length).toBe(0);
    });

    it('throws on empty agentDid', () => {
      expect(() => new ActionLogBuilder('')).toThrow();
    });

    it('appends entries with auto-computed hashes', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      const entry = builder.append({
        action: 'read',
        resource: '/data',
        params: {},
        outcome: 'success',
      });
      expect(entry.index).toBe(0);
      expect(entry.previousHash).toBeNull();
      expect(entry.hash).toBeTruthy();
      expect(entry.hash.length).toBe(64); // SHA-256 hex
    });

    it('chains entries with previousHash', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      const e0 = builder.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
      const e1 = builder.append({ action: 'write', resource: '/b', params: { v: 1 }, outcome: 'success' });
      const e2 = builder.append({ action: 'delete', resource: '/c', params: {}, outcome: 'failure' });

      expect(e1.previousHash).toBe(e0.hash);
      expect(e2.previousHash).toBe(e1.hash);
      expect(builder.length).toBe(3);
    });

    it('sequential indices', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      for (let i = 0; i < 10; i++) {
        builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      }
      const log = builder.toLog();
      for (let i = 0; i < 10; i++) {
        expect(log.entries[i]!.index).toBe(i);
      }
    });

    it('get() returns entry by index', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/data', params: {}, outcome: 'success' });
      expect(builder.get(0)!.action).toBe('read');
      expect(builder.get(1)).toBeUndefined();
    });

    it('entries() returns a copy', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/data', params: {}, outcome: 'success' });
      const entries = builder.entries();
      expect(entries).toHaveLength(1);
    });

    it('uses provided timestamp', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      const ts = '2025-01-01T00:00:00.000Z';
      const entry = builder.append({ action: 'read', resource: '/data', params: {}, outcome: 'success', timestamp: ts });
      expect(entry.timestamp).toBe(ts);
    });

    it('toLog() has correct rootHash and headHash', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      const e0 = builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      const e1 = builder.append({ action: 'b', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();
      expect(log.rootHash).toBe(e0.hash);
      expect(log.headHash).toBe(e1.hash);
    });

    it('records all outcome types', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      builder.append({ action: 'b', resource: '/r', params: {}, outcome: 'failure' });
      builder.append({ action: 'c', resource: '/r', params: {}, outcome: 'blocked' });
      const log = builder.toLog();
      expect(log.entries.map(e => e.outcome)).toEqual(['success', 'failure', 'blocked']);
    });
  });

  // ── Hash computation ──────────────────────────────────────────────────────

  describe('computeEntryHash', () => {
    it('produces deterministic hashes', () => {
      const entry = {
        index: 0,
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:agent-1',
        action: 'read',
        resource: '/data',
        params: {},
        outcome: 'success' as const,
        previousHash: null,
      };
      const h1 = computeEntryHash(entry);
      const h2 = computeEntryHash(entry);
      expect(h1).toBe(h2);
    });

    it('different content produces different hashes', () => {
      const base = {
        index: 0,
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:agent-1',
        action: 'read',
        resource: '/data',
        params: {},
        outcome: 'success' as const,
        previousHash: null,
      };
      const h1 = computeEntryHash(base);
      const h2 = computeEntryHash({ ...base, action: 'write' });
      expect(h1).not.toBe(h2);
    });
  });

  // ── Integrity verification ────────────────────────────────────────────────

  describe('verifyIntegrity', () => {
    it('valid log passes verification', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
      builder.append({ action: 'write', resource: '/b', params: { v: 1 }, outcome: 'success' });
      builder.append({ action: 'delete', resource: '/c', params: {}, outcome: 'failure' });
      const log = builder.toLog();
      const result = verifyIntegrity(log);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('empty log passes verification', () => {
      const log = new ActionLogBuilder('did:nobulex:agent-1').toLog();
      const result = verifyIntegrity(log);
      expect(result.valid).toBe(true);
    });

    it('detects tampered hash', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
      const log = builder.toLog();

      const tampered = {
        ...log,
        entries: [{ ...log.entries[0]!, hash: 'tampered' }],
        headHash: 'tampered',
      };
      const result = verifyIntegrity(tampered);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hash mismatch'))).toBe(true);
    });

    it('detects broken chain linkage', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      builder.append({ action: 'b', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();

      const tampered = {
        ...log,
        entries: [
          log.entries[0]!,
          { ...log.entries[1]!, previousHash: 'wrong' },
        ],
      };
      const result = verifyIntegrity(tampered);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('previousHash'))).toBe(true);
    });

    it('detects wrong index', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();

      const tampered = {
        ...log,
        entries: [{ ...log.entries[0]!, index: 5 }],
      };
      const result = verifyIntegrity(tampered);
      expect(result.valid).toBe(false);
    });

    it('detects length mismatch', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();
      const tampered = { ...log, length: 999 };
      const result = verifyIntegrity(tampered);
      expect(result.valid).toBe(false);
    });

    it('detects rootHash mismatch', () => {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      builder.append({ action: 'a', resource: '/r', params: {}, outcome: 'success' });
      const log = builder.toLog();
      const tampered = { ...log, rootHash: 'wrong' };
      const result = verifyIntegrity(tampered);
      expect(result.valid).toBe(false);
    });
  });

  // ── Partial verification ──────────────────────────────────────────────────

  describe('verifyPartial', () => {
    function makeChain(n: number) {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      for (let i = 0; i < n; i++) {
        builder.append({
          action: i % 2 === 0 ? 'read' : 'write',
          resource: `/res/${i}`,
          params: { i },
          outcome: 'success',
          timestamp: new Date(2025, 0, 1, 0, 0, i).toISOString(),
        });
      }
      return builder.toLog();
    }

    it('lastN = 0 is a no-op', () => {
      const log = makeChain(10);
      const result = verifyPartial(log, 0);
      expect(result.valid).toBe(true);
      expect(result.checked).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('lastN > entries.length delegates to verifyIntegrity', () => {
      const log = makeChain(10);
      const result = verifyPartial(log, 999);
      expect(result.valid).toBe(true);
      expect(result.checked).toBe(log.entries.length);
      expect(result.errors).toHaveLength(0);
    });

    it('valid 100-entry chain, lastN = 5', () => {
      const log = makeChain(100);
      const result = verifyPartial(log, 5);
      expect(result.valid).toBe(true);
      expect(result.checked).toBe(5);
      expect(result.errors).toHaveLength(0);
    });

    it('catches tamper just before the window via boundary previousHash join', () => {
      const log = makeChain(100);
      const N = 5;
      const boundaryIdx = log.entries.length - N - 1; // entry just before window
      const tampered = {
        ...log,
        entries: log.entries.map((e, i) =>
          i === boundaryIdx ? { ...e, hash: 'tampered-boundary-hash' } : e,
        ),
      };
      const result = verifyPartial(tampered, N);
      expect(result.valid).toBe(false);
      const firstWindowIdx = log.entries.length - N;
      expect(
        result.errors.some(
          (e) => e.includes(`Entry ${firstWindowIdx}`) && e.includes('previousHash'),
        ),
      ).toBe(true);
    });

    it('catches tamper inside the verified window', () => {
      const log = makeChain(100);
      const N = 5;
      const targetIdx = log.entries.length - 3; // inside [len-N, len-1]
      const tampered = {
        ...log,
        entries: log.entries.map((e, i) =>
          i === targetIdx ? { ...e, action: 'rewritten' } : e,
        ),
      };
      const result = verifyPartial(tampered, N);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(`Entry ${targetIdx}`))).toBe(true);
    });

    it('does NOT catch tamper deeper than one entry before the window', () => {
      // Intentional: partial verification trusts the prefix beyond the
      // boundary join. This test documents that limitation — a tamper more
      // than one entry before the window is invisible to verifyPartial.
      const log = makeChain(100);
      const N = 5;
      const deepIdx = log.entries.length - N - 5; // well before the boundary
      const tampered = {
        ...log,
        entries: log.entries.map((e, i) =>
          i === deepIdx ? { ...e, action: 'silently-rewritten' } : e,
        ),
      };
      const result = verifyPartial(tampered, N);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── Merkle tree ───────────────────────────────────────────────────────────

  describe('Merkle tree', () => {
    it('builds tree from single hash', () => {
      const { root, layers } = buildMerkleTree(['abc']);
      expect(root).toBeTruthy();
      expect(layers).toHaveLength(1);
    });

    it('builds tree from multiple hashes', () => {
      const { root, layers } = buildMerkleTree(['a', 'b', 'c', 'd']);
      expect(root).toBeTruthy();
      expect(layers.length).toBeGreaterThan(1);
      expect(layers[layers.length - 1]).toHaveLength(1);
    });

    it('deterministic root', () => {
      const hashes = ['h1', 'h2', 'h3', 'h4'];
      const r1 = buildMerkleTree(hashes).root;
      const r2 = buildMerkleTree(hashes).root;
      expect(r1).toBe(r2);
    });

    it('different hashes produce different roots', () => {
      const r1 = buildMerkleTree(['a', 'b']).root;
      const r2 = buildMerkleTree(['c', 'd']).root;
      expect(r1).not.toBe(r2);
    });

    it('handles odd number of leaves', () => {
      const { root } = buildMerkleTree(['a', 'b', 'c']);
      expect(root).toBeTruthy();
    });
  });

  // ── Merkle proofs ─────────────────────────────────────────────────────────

  describe('Merkle proofs', () => {
    function makeLog(n: number) {
      const builder = new ActionLogBuilder('did:nobulex:agent-1');
      for (let i = 0; i < n; i++) {
        builder.append({
          action: `action_${i}`,
          resource: `/resource/${i}`,
          params: { i },
          outcome: 'success',
          timestamp: `2025-01-01T00:00:0${i}.000Z`,
        });
      }
      return builder.toLog();
    }

    it('generates and verifies proof for first entry', () => {
      const log = makeLog(4);
      const proof = generateMerkleProof(log, 0);
      expect(proof.entryIndex).toBe(0);
      expect(proof.entryHash).toBe(log.entries[0]!.hash);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('generates and verifies proof for last entry', () => {
      const log = makeLog(4);
      const proof = generateMerkleProof(log, 3);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('generates and verifies proof for middle entry', () => {
      const log = makeLog(8);
      const proof = generateMerkleProof(log, 4);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('generates valid proofs for all entries in a log', () => {
      const log = makeLog(7);
      for (let i = 0; i < log.entries.length; i++) {
        const proof = generateMerkleProof(log, i);
        expect(verifyMerkleProof(proof)).toBe(true);
      }
    });

    it('proof fails with tampered entry hash', () => {
      const log = makeLog(4);
      const proof = generateMerkleProof(log, 2);
      const tampered = { ...proof, entryHash: 'tampered' };
      expect(verifyMerkleProof(tampered)).toBe(false);
    });

    it('proof fails with tampered root', () => {
      const log = makeLog(4);
      const proof = generateMerkleProof(log, 1);
      const tampered = { ...proof, root: 'tampered' };
      expect(verifyMerkleProof(tampered)).toBe(false);
    });

    it('throws on out-of-range index', () => {
      const log = makeLog(3);
      expect(() => generateMerkleProof(log, -1)).toThrow();
      expect(() => generateMerkleProof(log, 3)).toThrow();
    });

    it('works with single-entry log', () => {
      const log = makeLog(1);
      const proof = generateMerkleProof(log, 0);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('works with two-entry log', () => {
      const log = makeLog(2);
      expect(verifyMerkleProof(generateMerkleProof(log, 0))).toBe(true);
      expect(verifyMerkleProof(generateMerkleProof(log, 1))).toBe(true);
    });
  });
});
