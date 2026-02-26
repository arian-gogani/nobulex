import { describe, it, expect, afterEach } from 'vitest';
import {
  hashLeaf,
  hashInner,
  buildMerkleTree,
  buildMerkleTreeFromHashes,
  appendLeaves,
  generateInclusionProof,
  verifyInclusionProof,
  generateMultiProof,
  verifyMultiProof,
  getAuditPath,
  verifyAuditPath,
  serializeProof,
  deserializeProof,
  serializeTree,
  deserializeTree,
  diffTrees,
  visualizeTree,
  EpochAggregator,
  EpochManager,
  verifyEpochChain,
  SparseMerkleTree,
} from './index';
import type {
  MultiProof,
  AuditPath,
} from './index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeData(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `item-${i}`);
}

// ─── Domain-separated hashing ───────────────────────────────────────────────

describe('domain-separated hashing', () => {
  it('should produce different hashes for leaf vs inner with same data', () => {
    const data = 'test-data';
    const leafHash = hashLeaf(data);
    const innerHash = hashInner(data, data);
    expect(leafHash).not.toBe(innerHash);
  });

  it('should be deterministic', () => {
    expect(hashLeaf('hello')).toBe(hashLeaf('hello'));
    expect(hashInner('a', 'b')).toBe(hashInner('a', 'b'));
  });

  it('should produce different hashes for different inputs', () => {
    expect(hashLeaf('a')).not.toBe(hashLeaf('b'));
    expect(hashInner('a', 'b')).not.toBe(hashInner('b', 'a'));
  });

  it('should produce 64-character hex hashes', () => {
    const h = hashLeaf('test');
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });

  it('should handle empty string input', () => {
    const h = hashLeaf('');
    expect(h).toHaveLength(64);
  });

  it('should handle unicode input', () => {
    const h1 = hashLeaf('hello world');
    const h2 = hashLeaf('hello world');
    expect(h1).toBe(h2);
    expect(hashLeaf('\u{1F600}')).toHaveLength(64);
  });
});

// ─── buildMerkleTree ────────────────────────────────────────────────────────

describe('buildMerkleTree', () => {
  it('should handle empty input', () => {
    const tree = buildMerkleTree([]);
    expect(tree.root).toBeTruthy();
    expect(tree.leafCount).toBe(0);
    expect(tree.layers).toHaveLength(1);
  });

  it('should handle single leaf', () => {
    const tree = buildMerkleTree(['data1']);
    expect(tree.root).toBe(hashLeaf('data1'));
    expect(tree.leafCount).toBe(1);
    expect(tree.leaves).toHaveLength(1);
  });

  it('should handle two leaves', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(tree.root).toBe(hashInner(hashLeaf('a'), hashLeaf('b')));
    expect(tree.leafCount).toBe(2);
    expect(tree.layers).toHaveLength(2);
  });

  it('should handle odd number of leaves by duplicating last', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    expect(tree.leafCount).toBe(3);
    expect(tree.layers).toHaveLength(3);
    expect(tree.layers[1]).toHaveLength(2);
  });

  it('should handle power-of-two leaves', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    expect(tree.leafCount).toBe(4);
    expect(tree.layers).toHaveLength(3);
  });

  it('should handle 8 leaves perfectly', () => {
    const tree = buildMerkleTree(makeData(8));
    expect(tree.leafCount).toBe(8);
    expect(tree.layers).toHaveLength(4); // 8 -> 4 -> 2 -> 1
    expect(tree.layers[0]).toHaveLength(8);
    expect(tree.layers[1]).toHaveLength(4);
    expect(tree.layers[2]).toHaveLength(2);
    expect(tree.layers[3]).toHaveLength(1);
  });

  it('should handle 100 leaves', () => {
    const tree = buildMerkleTree(makeData(100));
    expect(tree.leafCount).toBe(100);
    expect(tree.root).toBeTruthy();
  });

  it('should handle 1000 leaves', () => {
    const tree = buildMerkleTree(makeData(1000));
    expect(tree.leafCount).toBe(1000);
    expect(tree.root).toBeTruthy();
    expect(tree.layers[tree.layers.length - 1]).toHaveLength(1);
  });

  it('should produce different roots for different data', () => {
    const t1 = buildMerkleTree(['a', 'b']);
    const t2 = buildMerkleTree(['a', 'c']);
    expect(t1.root).not.toBe(t2.root);
  });

  it('root should equal top layer', () => {
    const tree = buildMerkleTree(makeData(15));
    const topLayer = tree.layers[tree.layers.length - 1]!;
    expect(topLayer).toHaveLength(1);
    expect(topLayer[0]).toBe(tree.root);
  });
});

// ─── buildMerkleTreeFromHashes ──────────────────────────────────────────────

describe('buildMerkleTreeFromHashes', () => {
  it('should build from pre-hashed data', () => {
    const hashes = makeData(4).map(hashLeaf);
    const tree = buildMerkleTreeFromHashes(hashes);
    expect(tree.leafCount).toBe(4);
    expect(tree.leaves).toEqual(hashes);
  });

  it('should produce same result as buildMerkleTree leaves', () => {
    const data = ['a', 'b', 'c', 'd'];
    const tree1 = buildMerkleTree(data);
    const tree2 = buildMerkleTreeFromHashes(tree1.leaves as string[]);
    expect(tree2.root).toBe(tree1.root);
  });

  it('should handle empty input', () => {
    const tree = buildMerkleTreeFromHashes([]);
    expect(tree.leafCount).toBe(0);
    expect(tree.root).toBeTruthy();
  });

  it('should handle single hash', () => {
    const h = hashLeaf('single');
    const tree = buildMerkleTreeFromHashes([h]);
    expect(tree.root).toBe(h);
    expect(tree.leafCount).toBe(1);
  });
});

// ─── appendLeaves ───────────────────────────────────────────────────────────

describe('appendLeaves', () => {
  it('should append new leaves to an existing tree', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const extended = appendLeaves(tree, ['c', 'd']);
    expect(extended.leafCount).toBe(4);
    // First two leaves should match
    expect(extended.leaves[0]).toBe(tree.leaves[0]);
    expect(extended.leaves[1]).toBe(tree.leaves[1]);
  });

  it('should return same tree when appending empty array', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const same = appendLeaves(tree, []);
    expect(same.root).toBe(tree.root);
  });

  it('should produce valid proofs for appended leaves', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const extended = appendLeaves(tree, ['c']);
    const proof = generateInclusionProof(extended, 2);
    expect(verifyInclusionProof(proof)).toBe(true);
  });

  it('should handle appending to empty tree', () => {
    const empty = buildMerkleTree([]);
    // appendLeaves builds from existing leaves + new hashes
    // empty tree has no leaves, so this effectively builds from new leaves
    const extended = appendLeaves(empty, ['a', 'b']);
    expect(extended.leafCount).toBe(2);
  });
});

// ─── Inclusion proofs ───────────────────────────────────────────────────────

describe('inclusion proofs', () => {
  it('should generate and verify a proof for each leaf', () => {
    const data = ['a', 'b', 'c', 'd', 'e'];
    const tree = buildMerkleTree(data);

    for (let i = 0; i < data.length; i++) {
      const proof = generateInclusionProof(tree, i);
      expect(proof.leafIndex).toBe(i);
      expect(proof.root).toBe(tree.root);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });

  it('should have O(log N) proof size', () => {
    const tree = buildMerkleTree(makeData(1024));
    const proof = generateInclusionProof(tree, 500);
    expect(proof.proof.length).toBeLessThanOrEqual(10);
  });

  it('should reject proof with wrong root', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 0);
    const tampered = { ...proof, root: 'wrong-root' };
    expect(verifyInclusionProof(tampered)).toBe(false);
  });

  it('should reject proof with wrong leaf hash', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 0);
    const tampered = { ...proof, leafHash: 'wrong-leaf' };
    expect(verifyInclusionProof(tampered)).toBe(false);
  });

  it('should throw for out-of-range index', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(() => generateInclusionProof(tree, -1)).toThrow('out of range');
    expect(() => generateInclusionProof(tree, 2)).toThrow('out of range');
  });

  it('should work for single-leaf tree', () => {
    const tree = buildMerkleTree(['only']);
    const proof = generateInclusionProof(tree, 0);
    expect(proof.proof).toHaveLength(0);
    expect(verifyInclusionProof(proof)).toBe(true);
  });

  it('should verify proofs for a large tree (1000 items)', () => {
    const tree = buildMerkleTree(makeData(1000));
    // Check first, middle, last
    for (const idx of [0, 499, 999]) {
      const proof = generateInclusionProof(tree, idx);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });

  it('should reject proof with tampered sibling hash', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 0);
    const tamperedNodes = [...proof.proof];
    tamperedNodes[0] = { ...tamperedNodes[0]!, hash: 'tampered' };
    const tampered = { ...proof, proof: tamperedNodes };
    expect(verifyInclusionProof(tampered)).toBe(false);
  });
});

// ─── Multi-proof support ────────────────────────────────────────────────────

describe('multi-proof support', () => {
  it('should generate and verify a multi-proof for two leaves', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 2]);
    expect(mp.leafIndices).toEqual([0, 2]);
    expect(verifyMultiProof(mp)).toBe(true);
  });

  it('should generate and verify a multi-proof for all leaves', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 1, 2, 3]);
    expect(verifyMultiProof(mp)).toBe(true);
    // All leaves known, so proof hashes should be minimal
    expect(mp.proofHashes.length).toBe(0);
  });

  it('should generate and verify multi-proof for single leaf', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [1]);
    expect(verifyMultiProof(mp)).toBe(true);
  });

  it('should be smaller than individual proofs combined', () => {
    const data = makeData(16);
    const tree = buildMerkleTree(data);
    const indices = [0, 3, 7, 12];

    const mp = generateMultiProof(tree, indices);

    // Individual proofs total
    let totalIndividual = 0;
    for (const idx of indices) {
      const ip = generateInclusionProof(tree, idx);
      totalIndividual += ip.proof.length;
    }

    // Multi-proof should use fewer proof hashes
    expect(mp.proofHashes.length).toBeLessThan(totalIndividual);
  });

  it('should handle duplicate indices by deduplicating', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 0, 1, 1]);
    expect(mp.leafIndices).toEqual([0, 1]);
    expect(verifyMultiProof(mp)).toBe(true);
  });

  it('should throw for empty indices', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(() => generateMultiProof(tree, [])).toThrow('At least one');
  });

  it('should throw for out-of-range index', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(() => generateMultiProof(tree, [5])).toThrow('out of range');
  });

  it('should reject multi-proof with tampered root', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 2]);
    const tampered: MultiProof = { ...mp, root: 'bad-root' };
    expect(verifyMultiProof(tampered)).toBe(false);
  });

  it('should reject multi-proof with tampered leaf hash', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 2]);
    const tampered: MultiProof = {
      ...mp,
      leafHashes: ['tampered', mp.leafHashes[1]!],
    };
    expect(verifyMultiProof(tampered)).toBe(false);
  });

  it('should work with odd number of leaves', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd', 'e']);
    const mp = generateMultiProof(tree, [0, 4]);
    expect(verifyMultiProof(mp)).toBe(true);
  });

  it('should work with adjacent leaves', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const mp = generateMultiProof(tree, [2, 3]);
    expect(verifyMultiProof(mp)).toBe(true);
  });

  it('should work for large tree multi-proofs', () => {
    const tree = buildMerkleTree(makeData(1000));
    const indices = [0, 100, 500, 999];
    const mp = generateMultiProof(tree, indices);
    expect(verifyMultiProof(mp)).toBe(true);
  });
});

// ─── Audit paths ────────────────────────────────────────────────────────────

describe('audit paths', () => {
  it('should generate an audit path for a leaf', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 0);
    expect(path.leafIndex).toBe(0);
    expect(path.leafHash).toBe(tree.leaves[0]);
    expect(path.root).toBe(tree.root);
    expect(path.path.length).toBeGreaterThan(0);
  });

  it('should verify a valid audit path', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 2);
    expect(verifyAuditPath(path)).toBe(true);
  });

  it('should include depth information', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 0);
    // Tree has 3 layers (leaves -> inner -> root), so path has 2 nodes.
    expect(path.path).toHaveLength(2);
    // Depths should be descending from tree height.
    expect(path.path[0]!.depth).toBe(2);
    expect(path.path[1]!.depth).toBe(1);
  });

  it('should verify all leaves in a tree', () => {
    const data = makeData(16);
    const tree = buildMerkleTree(data);
    for (let i = 0; i < data.length; i++) {
      const path = getAuditPath(tree, i);
      expect(verifyAuditPath(path)).toBe(true);
    }
  });

  it('should reject tampered audit path', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 0);
    const tampered: AuditPath = {
      ...path,
      path: path.path.map((n, i) =>
        i === 0 ? { ...n, hash: 'tampered' } : n,
      ),
    };
    expect(verifyAuditPath(tampered)).toBe(false);
  });

  it('should throw for out-of-range index', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(() => getAuditPath(tree, -1)).toThrow('out of range');
    expect(() => getAuditPath(tree, 2)).toThrow('out of range');
  });

  it('should produce same path as inclusion proof', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    for (let i = 0; i < 8; i++) {
      const auditPath = getAuditPath(tree, i);
      const inclusionProof = generateInclusionProof(tree, i);
      expect(auditPath.path.length).toBe(inclusionProof.proof.length);
      for (let j = 0; j < auditPath.path.length; j++) {
        expect(auditPath.path[j]!.hash).toBe(inclusionProof.proof[j]!.hash);
        expect(auditPath.path[j]!.direction).toBe(
          inclusionProof.proof[j]!.direction,
        );
      }
    }
  });
});

// ─── Proof serialization ────────────────────────────────────────────────────

describe('proof serialization', () => {
  it('should round-trip an inclusion proof', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 1);
    const json = serializeProof(proof);
    const deserialized = deserializeProof(json);
    expect(deserialized.leafIndex).toBe(proof.leafIndex);
    expect(deserialized.leafHash).toBe(proof.leafHash);
    expect(deserialized.root).toBe(proof.root);
    expect(deserialized.proof).toHaveLength(proof.proof.length);
    for (let i = 0; i < proof.proof.length; i++) {
      expect(deserialized.proof[i]!.hash).toBe(proof.proof[i]!.hash);
      expect(deserialized.proof[i]!.direction).toBe(proof.proof[i]!.direction);
    }
  });

  it('should produce valid proof after deserialization', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 2);
    const json = serializeProof(proof);
    const deserialized = deserializeProof(json);
    expect(verifyInclusionProof(deserialized)).toBe(true);
  });

  it('should throw on invalid JSON', () => {
    expect(() => deserializeProof('not json')).toThrow('Invalid JSON');
  });

  it('should throw on non-object JSON', () => {
    expect(() => deserializeProof('"string"')).toThrow('must be a JSON object');
  });

  it('should throw on wrong version', () => {
    expect(() => deserializeProof('{"v":99}')).toThrow('Unsupported proof version');
  });

  it('should throw on wrong type', () => {
    expect(() => deserializeProof('{"v":1,"type":"wrong"}')).toThrow(
      'Unsupported proof type',
    );
  });

  it('should throw on invalid leafIndex', () => {
    expect(() =>
      deserializeProof(
        '{"v":1,"type":"inclusion","leafIndex":-1,"leafHash":"h","root":"r","proof":[]}',
      ),
    ).toThrow('Invalid leafIndex');
  });

  it('should throw on invalid proof node', () => {
    expect(() =>
      deserializeProof(
        '{"v":1,"type":"inclusion","leafIndex":0,"leafHash":"h","root":"r","proof":[{"h":"","d":"l"}]}',
      ),
    ).toThrow('Invalid hash in proof node');
  });

  it('should round-trip proof for large tree', () => {
    const tree = buildMerkleTree(makeData(500));
    const proof = generateInclusionProof(tree, 250);
    const json = serializeProof(proof);
    const deserialized = deserializeProof(json);
    expect(verifyInclusionProof(deserialized)).toBe(true);
  });
});

// ─── Tree serialization ─────────────────────────────────────────────────────

describe('tree serialization', () => {
  it('should round-trip a tree', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const json = serializeTree(tree);
    const deserialized = deserializeTree(json);
    expect(deserialized.root).toBe(tree.root);
    expect(deserialized.leafCount).toBe(tree.leafCount);
    expect(deserialized.leaves).toEqual(tree.leaves);
    expect(deserialized.layers.length).toBe(tree.layers.length);
  });

  it('should round-trip an empty tree', () => {
    const tree = buildMerkleTree([]);
    const json = serializeTree(tree);
    const deserialized = deserializeTree(json);
    expect(deserialized.root).toBe(tree.root);
    expect(deserialized.leafCount).toBe(0);
  });

  it('should generate valid proofs from deserialized tree', () => {
    const tree = buildMerkleTree(makeData(10));
    const json = serializeTree(tree);
    const deserialized = deserializeTree(json);
    for (let i = 0; i < 10; i++) {
      const proof = generateInclusionProof(deserialized, i);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });

  it('should throw on invalid JSON', () => {
    expect(() => deserializeTree('bad')).toThrow('Invalid JSON');
  });

  it('should throw on wrong version', () => {
    expect(() => deserializeTree('{"v":99}')).toThrow('Unsupported tree version');
  });

  it('should throw on mismatched leafCount', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const json = JSON.parse(serializeTree(tree));
    json.leafCount = 999;
    expect(() => deserializeTree(JSON.stringify(json))).toThrow(
      'leafCount does not match',
    );
  });

  it('should throw on invalid root mismatch', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const json = JSON.parse(serializeTree(tree));
    json.root = 'wrong-root';
    expect(() => deserializeTree(JSON.stringify(json))).toThrow(
      'Root does not match',
    );
  });
});

// ─── Tree diff ──────────────────────────────────────────────────────────────

describe('tree diff', () => {
  it('should detect no changes for identical trees', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    const diff = diffTrees(tree, tree);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('should detect added leaves', () => {
    const a = buildMerkleTree(['a', 'b']);
    const b = buildMerkleTree(['a', 'b', 'c', 'd']);
    const diff = diffTrees(a, b);
    expect(diff.added).toEqual([2, 3]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('should detect removed leaves', () => {
    const a = buildMerkleTree(['a', 'b', 'c', 'd']);
    const b = buildMerkleTree(['a', 'b']);
    const diff = diffTrees(a, b);
    expect(diff.removed).toEqual([2, 3]);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('should detect changed leaves', () => {
    const a = buildMerkleTree(['a', 'b', 'c']);
    const b = buildMerkleTree(['a', 'x', 'c']);
    const diff = diffTrees(a, b);
    expect(diff.changed).toEqual([1]);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('should detect mixed changes', () => {
    const a = buildMerkleTree(['a', 'b', 'c']);
    const b = buildMerkleTree(['a', 'x', 'c', 'd']);
    const diff = diffTrees(a, b);
    expect(diff.changed).toEqual([1]);
    expect(diff.added).toEqual([3]);
    expect(diff.removed).toHaveLength(0);
  });

  it('should handle empty trees', () => {
    const a = buildMerkleTree([]);
    const b = buildMerkleTree(['a']);
    const diff = diffTrees(a, b);
    expect(diff.added).toEqual([0]);
  });

  it('should handle large tree diffs', () => {
    const dataA = makeData(500);
    const dataB = [...dataA.slice(0, 250), ...makeData(300).map((s) => s + '-new')];
    const a = buildMerkleTree(dataA);
    const b = buildMerkleTree(dataB);
    const diff = diffTrees(a, b);
    // Positions 250-499 in a are changed (different data in b at those positions)
    // Position 500-549 in b are added
    expect(diff.changed.length).toBeGreaterThan(0);
  });
});

// ─── Tree visualization ─────────────────────────────────────────────────────

describe('tree visualization', () => {
  it('should produce ASCII output for a small tree', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const viz = visualizeTree(tree);
    expect(viz).toContain('ROOT');
    expect(viz).toContain('LEAVES');
    expect(viz.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('should show abbreviated hashes', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const viz = visualizeTree(tree, 6);
    // Each hash should be surrounded by brackets and be 6 chars
    expect(viz).toMatch(/\[[0-9a-f]{6}\]/);
  });

  it('should handle single-leaf tree', () => {
    const tree = buildMerkleTree(['only']);
    const viz = visualizeTree(tree);
    expect(viz).toContain('ROOT');
  });

  it('should handle empty tree', () => {
    const tree = buildMerkleTree([]);
    const viz = visualizeTree(tree);
    // Empty tree still has one layer (the empty root)
    expect(viz).toContain('ROOT');
  });

  it('should use custom hash length', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const viz = visualizeTree(tree, 4);
    expect(viz).toMatch(/\[[0-9a-f]{4}\]/);
  });
});

// ─── EpochAggregator ────────────────────────────────────────────────────────

describe('EpochAggregator', () => {
  it('should accumulate items and seal epochs', () => {
    const agg = new EpochAggregator({ maxItems: 3 });

    agg.add('hash1');
    agg.add('hash2');
    expect(agg.pendingCount).toBe(2);
    expect(agg.epochCount).toBe(0);

    agg.add('hash3'); // triggers auto-seal
    expect(agg.epochCount).toBe(1);
    expect(agg.pendingCount).toBe(0);

    const epoch = agg.getLatestEpoch();
    expect(epoch).toBeDefined();
    expect(epoch!.index).toBe(0);
    expect(epoch!.leafCount).toBe(3);
    expect(epoch!.previousEpochRoot).toBeNull();
  });

  it('should chain epochs together', () => {
    const agg = new EpochAggregator({ maxItems: 2 });

    agg.add('a');
    agg.add('b'); // auto-seal epoch 0

    agg.add('c');
    agg.add('d'); // auto-seal epoch 1

    const epochs = agg.getEpochs();
    expect(epochs).toHaveLength(2);
    expect(epochs[0]!.previousEpochRoot).toBeNull();
    expect(epochs[0]!.chainedRoot).toBe(epochs[0]!.merkleRoot);
    expect(epochs[1]!.previousEpochRoot).toBe(epochs[0]!.chainedRoot);
    expect(epochs[1]!.chainedRoot).not.toBe(epochs[1]!.merkleRoot);
  });

  it('should manually seal', () => {
    const agg = new EpochAggregator({ maxItems: 100 });

    agg.add('x');
    agg.add('y');
    const epoch = agg.seal();

    expect(epoch).not.toBeNull();
    expect(epoch!.leafCount).toBe(2);
    expect(agg.pendingCount).toBe(0);
  });

  it('should return null when sealing empty epoch', () => {
    const agg = new EpochAggregator();
    expect(agg.seal()).toBeNull();
  });

  it('should support custom end time', () => {
    const agg = new EpochAggregator();
    agg.add('x');
    const endTime = '2025-01-01T00:00:00.000Z';
    const epoch = agg.seal(endTime);
    expect(epoch!.endTime).toBe(endTime);
  });
});

// ─── verifyEpochChain ───────────────────────────────────────────────────────

describe('verifyEpochChain', () => {
  it('should verify a valid epoch chain', () => {
    const agg = new EpochAggregator({ maxItems: 2 });

    agg.add('a');
    agg.add('b');
    agg.add('c');
    agg.add('d');
    agg.add('e');
    agg.seal();

    const result = verifyEpochChain(agg.getEpochs());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect tampered epoch chain', () => {
    const agg = new EpochAggregator({ maxItems: 2 });

    agg.add('a');
    agg.add('b');
    agg.add('c');
    agg.add('d');

    const epochs = [...agg.getEpochs()];
    epochs[1] = { ...epochs[1]!, previousEpochRoot: 'tampered' };

    const result = verifyEpochChain(epochs);
    expect(result.valid).toBe(false);
  });

  it('should verify empty chain', () => {
    const result = verifyEpochChain([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify single epoch chain', () => {
    const agg = new EpochAggregator({ maxItems: 100 });
    agg.add('a');
    agg.seal();
    const result = verifyEpochChain(agg.getEpochs());
    expect(result.valid).toBe(true);
  });

  it('should detect tampered chainedRoot', () => {
    const agg = new EpochAggregator({ maxItems: 2 });
    agg.add('a');
    agg.add('b');
    agg.add('c');
    agg.add('d');

    const epochs = [...agg.getEpochs()];
    epochs[1] = { ...epochs[1]!, chainedRoot: 'tampered' };
    const result = verifyEpochChain(epochs);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─── EpochManager ───────────────────────────────────────────────────────────

describe('EpochManager', () => {
  let manager: EpochManager;

  afterEach(() => {
    if (manager) manager.destroy();
  });

  it('should add items and seal', () => {
    manager = new EpochManager({ maxItems: 3 });
    manager.add('a');
    manager.add('b');
    manager.add('c'); // auto-seal
    expect(manager.epochCount).toBe(1);
    expect(manager.pendingCount).toBe(0);
  });

  it('should retrieve epochs', () => {
    manager = new EpochManager({ maxItems: 2 });
    manager.add('a');
    manager.add('b');
    manager.add('c');
    manager.add('d');

    const epochs = manager.getEpochs();
    expect(epochs).toHaveLength(2);
    expect(manager.getLatestEpoch()).toBeDefined();
  });

  it('should get epoch by time', () => {
    manager = new EpochManager({ maxItems: 100 });
    manager.add('a');
    const epoch = manager.seal()!;

    // The epoch's time window should contain the seal time.
    const found = manager.getEpochByTime(epoch.startTime);
    expect(found).toBeDefined();
    expect(found!.index).toBe(0);
  });

  it('should return undefined for time outside any epoch', () => {
    manager = new EpochManager({ maxItems: 100 });
    manager.add('a');
    manager.seal();

    const found = manager.getEpochByTime('1970-01-01T00:00:00.000Z');
    expect(found).toBeUndefined();
  });

  it('should get epoch range', () => {
    manager = new EpochManager({ maxItems: 2 });
    manager.add('a');
    manager.add('b');
    manager.add('c');
    manager.add('d');
    manager.add('e');
    manager.seal();

    const allEpochs = manager.getEpochs();
    const start = allEpochs[0]!.startTime;
    const end = allEpochs[allEpochs.length - 1]!.endTime;

    const range = manager.getEpochRange(start, end);
    expect(range.length).toBe(allEpochs.length);
  });

  it('should throw for invalid epoch range', () => {
    manager = new EpochManager();
    expect(() =>
      manager.getEpochRange(
        '2025-12-31T00:00:00Z',
        '2025-01-01T00:00:00Z',
      ),
    ).toThrow('Start time must be before');
  });

  it('should verify chain', () => {
    manager = new EpochManager({ maxItems: 2 });
    manager.add('a');
    manager.add('b');
    manager.add('c');
    manager.add('d');

    const result = manager.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('should destroy cleanly', () => {
    manager = new EpochManager({ autoSeal: true, maxDurationMs: 100 });
    manager.add('a');
    // Should not throw.
    manager.destroy();
    manager.destroy(); // Double destroy should be safe.
  });

  it('should manually seal with end time', () => {
    manager = new EpochManager({ maxItems: 100 });
    manager.add('data');
    const endTime = '2025-06-15T12:00:00.000Z';
    const epoch = manager.seal(endTime);
    expect(epoch).not.toBeNull();
    expect(epoch!.endTime).toBe(endTime);
  });
});

// ─── Sparse Merkle tree ─────────────────────────────────────────────────────

describe('SparseMerkleTree', () => {
  it('should start empty with a default root', () => {
    const smt = new SparseMerkleTree(8);
    expect(smt.root).toBeTruthy();
    expect(smt.size).toBe(0);
  });

  it('should insert and retrieve a value', () => {
    const smt = new SparseMerkleTree(8);
    smt.insert('key1', 'value1');
    expect(smt.get('key1')).toBe('value1');
    expect(smt.size).toBe(1);
  });

  it('should update an existing key', () => {
    const smt = new SparseMerkleTree(8);
    smt.insert('key1', 'value1');
    const root1 = smt.root;
    smt.insert('key1', 'value2');
    expect(smt.get('key1')).toBe('value2');
    expect(smt.root).not.toBe(root1);
  });

  it('should return null for missing keys', () => {
    const smt = new SparseMerkleTree(8);
    expect(smt.get('nonexistent')).toBeNull();
  });

  it('should delete a key', () => {
    const smt = new SparseMerkleTree(8);
    const emptyRoot = smt.root;
    smt.insert('key1', 'value1');
    expect(smt.size).toBe(1);
    expect(smt.delete('key1')).toBe(true);
    expect(smt.size).toBe(0);
    expect(smt.get('key1')).toBeNull();
    expect(smt.root).toBe(emptyRoot);
  });

  it('should return false when deleting nonexistent key', () => {
    const smt = new SparseMerkleTree(8);
    expect(smt.delete('nope')).toBe(false);
  });

  it('should change root when inserting', () => {
    const smt = new SparseMerkleTree(8);
    const emptyRoot = smt.root;
    smt.insert('key1', 'value1');
    expect(smt.root).not.toBe(emptyRoot);
  });

  it('should generate and verify a membership proof', () => {
    const smt = new SparseMerkleTree(16);
    smt.insert('hello', 'world');
    const proof = smt.generateProof('hello');
    expect(proof.exists).toBe(true);
    expect(proof.value).toBe('world');
    expect(proof.siblings).toHaveLength(16);
    expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(true);
  });

  it('should generate and verify a non-membership proof', () => {
    const smt = new SparseMerkleTree(16);
    smt.insert('hello', 'world');
    const proof = smt.generateProof('missing');
    expect(proof.exists).toBe(false);
    expect(proof.value).toBeNull();
    expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(true);
  });

  it('should reject proof with wrong root', () => {
    const smt = new SparseMerkleTree(8);
    smt.insert('key', 'val');
    const proof = smt.generateProof('key');
    const tampered = { ...proof, root: 'bad-root' };
    expect(SparseMerkleTree.verifyProof(tampered, 8)).toBe(false);
  });

  it('should reject proof with wrong value', () => {
    const smt = new SparseMerkleTree(8);
    smt.insert('key', 'val');
    const proof = smt.generateProof('key');
    const tampered = { ...proof, value: 'wrong' };
    expect(SparseMerkleTree.verifyProof(tampered, 8)).toBe(false);
  });

  it('should handle multiple keys', () => {
    const smt = new SparseMerkleTree(16);
    for (let i = 0; i < 50; i++) {
      smt.insert(`key-${i}`, `value-${i}`);
    }
    expect(smt.size).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(smt.get(`key-${i}`)).toBe(`value-${i}`);
      const proof = smt.generateProof(`key-${i}`);
      expect(proof.exists).toBe(true);
      expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(true);
    }
  });

  it('should reject proof with wrong depth', () => {
    const smt = new SparseMerkleTree(8);
    smt.insert('key', 'val');
    const proof = smt.generateProof('key');
    // Wrong depth
    expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(false);
  });

  it('should throw for invalid depth', () => {
    expect(() => new SparseMerkleTree(0)).toThrow('Depth must be between');
    expect(() => new SparseMerkleTree(257)).toThrow('Depth must be between');
  });

  it('should produce deterministic roots', () => {
    const smt1 = new SparseMerkleTree(8);
    const smt2 = new SparseMerkleTree(8);
    smt1.insert('a', '1');
    smt1.insert('b', '2');
    smt2.insert('a', '1');
    smt2.insert('b', '2');
    expect(smt1.root).toBe(smt2.root);
  });

  it('should produce different roots for different insertion orders if values differ', () => {
    const smt1 = new SparseMerkleTree(8);
    const smt2 = new SparseMerkleTree(8);
    smt1.insert('a', '1');
    smt2.insert('a', '2');
    expect(smt1.root).not.toBe(smt2.root);
  });
});

// ─── Integration / cross-feature tests ──────────────────────────────────────

describe('integration', () => {
  it('should serialize and deserialize a tree, then generate valid proofs', () => {
    const tree = buildMerkleTree(makeData(20));
    const json = serializeTree(tree);
    const restored = deserializeTree(json);

    for (let i = 0; i < 20; i++) {
      const proof = generateInclusionProof(restored, i);
      const proofJson = serializeProof(proof);
      const restoredProof = deserializeProof(proofJson);
      expect(verifyInclusionProof(restoredProof)).toBe(true);
    }
  });

  it('should diff original vs appended tree', () => {
    const original = buildMerkleTree(['a', 'b', 'c']);
    const extended = appendLeaves(original, ['d', 'e']);
    const diff = diffTrees(original, extended);
    expect(diff.added).toEqual([3, 4]);
    expect(diff.changed).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('should handle a full workflow: build, prove, serialize, verify', () => {
    // Build tree
    const data = makeData(100);
    const tree = buildMerkleTree(data);

    // Generate proofs
    const proof42 = generateInclusionProof(tree, 42);
    expect(verifyInclusionProof(proof42)).toBe(true);

    // Serialize/deserialize tree
    const treeJson = serializeTree(tree);
    const restoredTree = deserializeTree(treeJson);
    expect(restoredTree.root).toBe(tree.root);

    // Serialize/deserialize proof
    const proofJson = serializeProof(proof42);
    const restoredProof = deserializeProof(proofJson);
    expect(verifyInclusionProof(restoredProof)).toBe(true);

    // Audit path
    const path = getAuditPath(restoredTree, 42);
    expect(verifyAuditPath(path)).toBe(true);

    // Visualize
    const viz = visualizeTree(restoredTree);
    expect(viz).toContain('ROOT');
  });

  it('should handle large scale: 2000 items build + proof', () => {
    const data = makeData(2000);
    const tree = buildMerkleTree(data);
    expect(tree.leafCount).toBe(2000);

    // Spot-check proofs
    for (const idx of [0, 500, 1000, 1500, 1999]) {
      const proof = generateInclusionProof(tree, idx);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });

  it('buildMerkleTreeFromHashes + appendLeaves round-trip', () => {
    const hashes = makeData(5).map(hashLeaf);
    const tree = buildMerkleTreeFromHashes(hashes);
    const extended = appendLeaves(tree, ['new1', 'new2']);
    expect(extended.leafCount).toBe(7);
    const proof = generateInclusionProof(extended, 6);
    expect(verifyInclusionProof(proof)).toBe(true);
  });
});
