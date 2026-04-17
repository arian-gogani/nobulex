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
import type { MultiProof, AuditPath } from './index';

function makeData(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `item-${i}`);
}

describe('domain-separated hashing', () => {
  it('leaf and inner are domain-separated, deterministic, order-sensitive', () => {
    expect(hashLeaf('x')).not.toBe(hashInner('x', 'x'));
    expect(hashLeaf('hello')).toBe(hashLeaf('hello'));
    expect(hashInner('a', 'b')).toBe(hashInner('a', 'b'));
    expect(hashLeaf('a')).not.toBe(hashLeaf('b'));
    expect(hashInner('a', 'b')).not.toBe(hashInner('b', 'a'));
  });

  it('produces 64-char hex output for any input, including empty and unicode', () => {
    for (const s of ['', 'test', '\u{1F600}', 'x'.repeat(1000)]) {
      const h = hashLeaf(s);
      expect(h).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
    }
  });
});

describe('buildMerkleTree', () => {
  it('handles empty, single, and basic shapes correctly', () => {
    const empty = buildMerkleTree([]);
    expect(empty.root).toBeTruthy();
    expect(empty.leafCount).toBe(0);
    expect(empty.layers).toHaveLength(1);

    const single = buildMerkleTree(['data1']);
    expect(single.root).toBe(hashLeaf('data1'));
    expect(single.leafCount).toBe(1);

    const two = buildMerkleTree(['a', 'b']);
    expect(two.root).toBe(hashInner(hashLeaf('a'), hashLeaf('b')));
    expect(two.layers).toHaveLength(2);
  });

  it('duplicates last leaf on odd counts; handles arbitrary sizes', () => {
    const odd = buildMerkleTree(['a', 'b', 'c']);
    expect(odd.leafCount).toBe(3);
    expect(odd.layers).toHaveLength(3);
    expect(odd.layers[1]).toHaveLength(2);

    const eight = buildMerkleTree(makeData(8));
    expect(eight.layers.map(l => l.length)).toEqual([8, 4, 2, 1]);

    const thousand = buildMerkleTree(makeData(1000));
    expect(thousand.leafCount).toBe(1000);
    expect(thousand.layers[thousand.layers.length - 1]).toHaveLength(1);
    expect(thousand.layers[thousand.layers.length - 1][0]).toBe(thousand.root);
  });

  it('different data produces different roots', () => {
    expect(buildMerkleTree(['a', 'b']).root).not.toBe(buildMerkleTree(['a', 'c']).root);
  });
});

describe('buildMerkleTreeFromHashes', () => {
  it('accepts pre-hashed leaves and round-trips with buildMerkleTree', () => {
    const data = ['a', 'b', 'c', 'd'];
    const t1 = buildMerkleTree(data);
    const t2 = buildMerkleTreeFromHashes(t1.leaves as string[]);
    expect(t2.root).toBe(t1.root);
    expect(t2.leaves).toEqual(t1.leaves);

    expect(buildMerkleTreeFromHashes([]).leafCount).toBe(0);
    const h = hashLeaf('single');
    expect(buildMerkleTreeFromHashes([h]).root).toBe(h);
  });
});

describe('appendLeaves', () => {
  it('extends existing tree and produces valid proofs for appended leaves', () => {
    const tree = buildMerkleTree(['a', 'b']);
    const extended = appendLeaves(tree, ['c', 'd']);
    expect(extended.leafCount).toBe(4);
    expect(extended.leaves[0]).toBe(tree.leaves[0]);
    expect(verifyInclusionProof(generateInclusionProof(extended, 2))).toBe(true);

    expect(appendLeaves(tree, []).root).toBe(tree.root);
    expect(appendLeaves(buildMerkleTree([]), ['a', 'b']).leafCount).toBe(2);
  });
});

describe('inclusion proofs', () => {
  it('generates and verifies a valid proof for every leaf', () => {
    const data = ['a', 'b', 'c', 'd', 'e'];
    const tree = buildMerkleTree(data);
    for (let i = 0; i < data.length; i++) {
      const proof = generateInclusionProof(tree, i);
      expect(proof.leafIndex).toBe(i);
      expect(proof.root).toBe(tree.root);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });

  it('has O(log N) proof size and works for large trees', () => {
    const tree = buildMerkleTree(makeData(1024));
    expect(generateInclusionProof(tree, 500).proof.length).toBeLessThanOrEqual(10);
    for (const idx of [0, 499, 999]) {
      expect(verifyInclusionProof(generateInclusionProof(buildMerkleTree(makeData(1000)), idx))).toBe(true);
    }
  });

  it('single-leaf tree has zero-length proof that still verifies', () => {
    const proof = generateInclusionProof(buildMerkleTree(['only']), 0);
    expect(proof.proof).toHaveLength(0);
    expect(verifyInclusionProof(proof)).toBe(true);
  });

  it('rejects tampered root / leafHash / sibling and out-of-range indices', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = generateInclusionProof(tree, 0);
    expect(verifyInclusionProof({ ...proof, root: 'wrong-root' })).toBe(false);
    expect(verifyInclusionProof({ ...proof, leafHash: 'wrong-leaf' })).toBe(false);
    const tamperedSibling = {
      ...proof,
      proof: proof.proof.map((n, i) => (i === 0 ? { ...n, hash: 'tampered' } : n)),
    };
    expect(verifyInclusionProof(tamperedSibling)).toBe(false);

    expect(() => generateInclusionProof(buildMerkleTree(['a', 'b']), -1)).toThrow('out of range');
    expect(() => generateInclusionProof(buildMerkleTree(['a', 'b']), 2)).toThrow('out of range');
  });
});

describe('multi-proof', () => {
  it('verifies subsets, full set, and single-leaf multi-proofs', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    expect(verifyMultiProof(generateMultiProof(tree, [0, 2]))).toBe(true);
    const all = generateMultiProof(tree, [0, 1, 2, 3]);
    expect(verifyMultiProof(all)).toBe(true);
    expect(all.proofHashes).toHaveLength(0);
    expect(verifyMultiProof(generateMultiProof(tree, [1]))).toBe(true);
  });

  it('is more compact than individual proofs combined', () => {
    const tree = buildMerkleTree(makeData(16));
    const indices = [0, 3, 7, 12];
    const mp = generateMultiProof(tree, indices);
    const individualTotal = indices
      .map(i => generateInclusionProof(tree, i).proof.length)
      .reduce((a, b) => a + b, 0);
    expect(mp.proofHashes.length).toBeLessThan(individualTotal);
  });

  it('deduplicates indices, handles odd counts, adjacent leaves, large trees', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const dup = generateMultiProof(tree, [0, 0, 1, 1]);
    expect(dup.leafIndices).toEqual([0, 1]);
    expect(verifyMultiProof(dup)).toBe(true);

    expect(verifyMultiProof(generateMultiProof(buildMerkleTree(['a', 'b', 'c', 'd', 'e']), [0, 4]))).toBe(true);
    expect(
      verifyMultiProof(generateMultiProof(buildMerkleTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), [2, 3])),
    ).toBe(true);
    expect(verifyMultiProof(generateMultiProof(buildMerkleTree(makeData(1000)), [0, 100, 500, 999]))).toBe(true);
  });

  it('rejects tampered multi-proofs and invalid inputs', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const mp = generateMultiProof(tree, [0, 2]);
    expect(verifyMultiProof({ ...mp, root: 'bad-root' } as MultiProof)).toBe(false);
    expect(
      verifyMultiProof({ ...mp, leafHashes: ['tampered', mp.leafHashes[1]!] } as MultiProof),
    ).toBe(false);
    expect(() => generateMultiProof(tree, [])).toThrow('At least one');
    expect(() => generateMultiProof(tree, [5])).toThrow('out of range');
  });
});

describe('audit paths', () => {
  it('produces paths whose depths/siblings match inclusion proofs and verify', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 0);
    expect(path.leafIndex).toBe(0);
    expect(path.leafHash).toBe(tree.leaves[0]);
    expect(path.root).toBe(tree.root);
    expect(path.path).toHaveLength(2);
    expect(path.path[0]!.depth).toBe(2);
    expect(path.path[1]!.depth).toBe(1);
    expect(verifyAuditPath(path)).toBe(true);

    // Verifies every leaf; path siblings mirror inclusion proof
    const big = buildMerkleTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    for (let i = 0; i < 8; i++) {
      const ap = getAuditPath(big, i);
      const ip = generateInclusionProof(big, i);
      expect(verifyAuditPath(ap)).toBe(true);
      expect(ap.path.length).toBe(ip.proof.length);
      for (let j = 0; j < ap.path.length; j++) {
        expect(ap.path[j]!.hash).toBe(ip.proof[j]!.hash);
        expect(ap.path[j]!.direction).toBe(ip.proof[j]!.direction);
      }
    }
  });

  it('rejects tampered audit paths and out-of-range indices', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const path = getAuditPath(tree, 0);
    const tampered: AuditPath = {
      ...path,
      path: path.path.map((n, i) => (i === 0 ? { ...n, hash: 'tampered' } : n)),
    };
    expect(verifyAuditPath(tampered)).toBe(false);
    expect(() => getAuditPath(buildMerkleTree(['a', 'b']), -1)).toThrow('out of range');
    expect(() => getAuditPath(buildMerkleTree(['a', 'b']), 2)).toThrow('out of range');
  });
});

describe('proof serialization', () => {
  it('round-trips and the deserialized proof still verifies', () => {
    const tree = buildMerkleTree(makeData(500));
    const proof = generateInclusionProof(tree, 250);
    const deserialized = deserializeProof(serializeProof(proof));
    expect(deserialized.leafIndex).toBe(proof.leafIndex);
    expect(deserialized.leafHash).toBe(proof.leafHash);
    expect(deserialized.root).toBe(proof.root);
    expect(deserialized.proof).toHaveLength(proof.proof.length);
    expect(verifyInclusionProof(deserialized)).toBe(true);
  });

  it('rejects invalid JSON / version / type / leafIndex / proof node', () => {
    expect(() => deserializeProof('not json')).toThrow('Invalid JSON');
    expect(() => deserializeProof('"string"')).toThrow('must be a JSON object');
    expect(() => deserializeProof('{"v":99}')).toThrow('Unsupported proof version');
    expect(() => deserializeProof('{"v":1,"type":"wrong"}')).toThrow('Unsupported proof type');
    expect(() =>
      deserializeProof('{"v":1,"type":"inclusion","leafIndex":-1,"leafHash":"h","root":"r","proof":[]}'),
    ).toThrow('Invalid leafIndex');
    expect(() =>
      deserializeProof(
        '{"v":1,"type":"inclusion","leafIndex":0,"leafHash":"h","root":"r","proof":[{"h":"","d":"l"}]}',
      ),
    ).toThrow('Invalid hash in proof node');
  });
});

describe('tree serialization', () => {
  it('round-trips (incl. empty) and produces a tree that generates valid proofs', () => {
    for (const data of [[], makeData(10)]) {
      const tree = buildMerkleTree(data as string[]);
      const restored = deserializeTree(serializeTree(tree));
      expect(restored.root).toBe(tree.root);
      expect(restored.leafCount).toBe(tree.leafCount);
      expect(restored.leaves).toEqual(tree.leaves);
      for (let i = 0; i < restored.leafCount; i++) {
        expect(verifyInclusionProof(generateInclusionProof(restored, i))).toBe(true);
      }
    }
  });

  it('rejects invalid JSON, wrong version, leafCount mismatch and root mismatch', () => {
    expect(() => deserializeTree('bad')).toThrow('Invalid JSON');
    expect(() => deserializeTree('{"v":99}')).toThrow('Unsupported tree version');
    const tree = buildMerkleTree(['a', 'b']);
    const tamperedCount = JSON.parse(serializeTree(tree));
    tamperedCount.leafCount = 999;
    expect(() => deserializeTree(JSON.stringify(tamperedCount))).toThrow('leafCount does not match');
    const tamperedRoot = JSON.parse(serializeTree(tree));
    tamperedRoot.root = 'wrong-root';
    expect(() => deserializeTree(JSON.stringify(tamperedRoot))).toThrow('Root does not match');
  });
});

describe('tree diff', () => {
  it('detects added, removed, changed and mixed changes', () => {
    const base = buildMerkleTree(['a', 'b', 'c']);
    expect(diffTrees(base, base)).toEqual({ added: [], removed: [], changed: [] });
    expect(diffTrees(buildMerkleTree(['a', 'b']), buildMerkleTree(['a', 'b', 'c', 'd'])).added).toEqual([2, 3]);
    expect(diffTrees(buildMerkleTree(['a', 'b', 'c', 'd']), buildMerkleTree(['a', 'b'])).removed).toEqual([2, 3]);
    expect(diffTrees(buildMerkleTree(['a', 'b', 'c']), buildMerkleTree(['a', 'x', 'c'])).changed).toEqual([1]);
    const mixed = diffTrees(buildMerkleTree(['a', 'b', 'c']), buildMerkleTree(['a', 'x', 'c', 'd']));
    expect(mixed).toEqual({ changed: [1], added: [3], removed: [] });
    expect(diffTrees(buildMerkleTree([]), buildMerkleTree(['a'])).added).toEqual([0]);
  });
});

describe('tree visualization', () => {
  it('produces ASCII with ROOT/LEAVES sections and custom hash length', () => {
    const viz = visualizeTree(buildMerkleTree(['a', 'b', 'c', 'd']));
    expect(viz).toContain('ROOT');
    expect(viz).toContain('LEAVES');
    expect(viz.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(visualizeTree(buildMerkleTree(['a', 'b']), 6)).toMatch(/\[[0-9a-f]{6}\]/);
    expect(visualizeTree(buildMerkleTree(['a', 'b', 'c', 'd']), 4)).toMatch(/\[[0-9a-f]{4}\]/);
    expect(visualizeTree(buildMerkleTree([]))).toContain('ROOT');
  });
});

describe('EpochAggregator', () => {
  it('auto-seals at maxItems, chains epochs, supports manual seal and empty seal', () => {
    const agg = new EpochAggregator({ maxItems: 2 });
    agg.add('a');
    agg.add('b'); // auto-seal epoch 0
    agg.add('c');
    agg.add('d'); // auto-seal epoch 1
    const epochs = agg.getEpochs();
    expect(epochs).toHaveLength(2);
    expect(epochs[0]!.index).toBe(0);
    expect(epochs[0]!.leafCount).toBe(2);
    expect(epochs[0]!.previousEpochRoot).toBeNull();
    expect(epochs[0]!.chainedRoot).toBe(epochs[0]!.merkleRoot);
    expect(epochs[1]!.previousEpochRoot).toBe(epochs[0]!.chainedRoot);
    expect(epochs[1]!.chainedRoot).not.toBe(epochs[1]!.merkleRoot);

    const manual = new EpochAggregator({ maxItems: 100 });
    manual.add('x');
    manual.add('y');
    const epoch = manual.seal();
    expect(epoch!.leafCount).toBe(2);
    expect(manual.pendingCount).toBe(0);

    expect(new EpochAggregator().seal()).toBeNull();

    const withTime = new EpochAggregator();
    withTime.add('x');
    expect(withTime.seal('2025-01-01T00:00:00.000Z')!.endTime).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('verifyEpochChain', () => {
  it('validates good chains (including empty and single) and rejects tampering', () => {
    expect(verifyEpochChain([]).valid).toBe(true);

    const single = new EpochAggregator({ maxItems: 100 });
    single.add('a');
    single.seal();
    expect(verifyEpochChain(single.getEpochs()).valid).toBe(true);

    const good = new EpochAggregator({ maxItems: 2 });
    ['a', 'b', 'c', 'd', 'e'].forEach(v => good.add(v));
    good.seal();
    expect(verifyEpochChain(good.getEpochs()).valid).toBe(true);

    // Tampered previousEpochRoot
    const badLink = new EpochAggregator({ maxItems: 2 });
    ['a', 'b', 'c', 'd'].forEach(v => badLink.add(v));
    const e1 = [...badLink.getEpochs()];
    e1[1] = { ...e1[1]!, previousEpochRoot: 'tampered' };
    expect(verifyEpochChain(e1).valid).toBe(false);

    // Tampered chainedRoot
    const badChain = new EpochAggregator({ maxItems: 2 });
    ['a', 'b', 'c', 'd'].forEach(v => badChain.add(v));
    const e2 = [...badChain.getEpochs()];
    e2[1] = { ...e2[1]!, chainedRoot: 'tampered' };
    const r = verifyEpochChain(e2);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('EpochManager', () => {
  let manager: EpochManager;
  afterEach(() => manager?.destroy());

  it('adds/seals, retrieves epochs, and verifies the chain', () => {
    manager = new EpochManager({ maxItems: 2 });
    ['a', 'b', 'c', 'd'].forEach(v => manager.add(v));
    expect(manager.epochCount).toBe(2);
    expect(manager.getEpochs()).toHaveLength(2);
    expect(manager.getLatestEpoch()).toBeDefined();
    expect(manager.verifyChain().valid).toBe(true);
  });

  it('getEpochByTime, getEpochRange and manual seal with end time', () => {
    manager = new EpochManager({ maxItems: 100 });
    manager.add('a');
    const futureEnd = '2099-06-15T12:00:00.000Z';
    const epoch = manager.seal(futureEnd)!;
    expect(epoch.endTime).toBe(futureEnd);
    expect(manager.getEpochByTime(epoch.startTime)?.index).toBe(0);
    expect(manager.getEpochByTime('1970-01-01T00:00:00.000Z')).toBeUndefined();

    const range = manager.getEpochRange(epoch.startTime, epoch.endTime);
    expect(range).toHaveLength(1);

    expect(() =>
      manager.getEpochRange('2025-12-31T00:00:00Z', '2025-01-01T00:00:00Z'),
    ).toThrow('Start time must be before');
  });

  it('destroys cleanly, even when called twice', () => {
    manager = new EpochManager({ autoSeal: true, maxDurationMs: 100 });
    manager.add('a');
    manager.destroy();
    manager.destroy();
  });
});

describe('SparseMerkleTree', () => {
  it('insert/get/update/delete semantics with root transitions', () => {
    const smt = new SparseMerkleTree(8);
    const emptyRoot = smt.root;
    expect(smt.root).toBeTruthy();
    expect(smt.size).toBe(0);

    smt.insert('key1', 'value1');
    expect(smt.get('key1')).toBe('value1');
    expect(smt.size).toBe(1);
    expect(smt.root).not.toBe(emptyRoot);

    const rootAfterInsert = smt.root;
    smt.insert('key1', 'value2');
    expect(smt.get('key1')).toBe('value2');
    expect(smt.root).not.toBe(rootAfterInsert);

    expect(smt.get('nonexistent')).toBeNull();
    expect(smt.delete('nope')).toBe(false);
    expect(smt.delete('key1')).toBe(true);
    expect(smt.size).toBe(0);
    expect(smt.root).toBe(emptyRoot);
  });

  it('generates and verifies membership / non-membership proofs', () => {
    const smt = new SparseMerkleTree(16);
    smt.insert('hello', 'world');

    const proof = smt.generateProof('hello');
    expect(proof.exists).toBe(true);
    expect(proof.value).toBe('world');
    expect(proof.siblings).toHaveLength(16);
    expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(true);

    const missing = smt.generateProof('missing');
    expect(missing.exists).toBe(false);
    expect(missing.value).toBeNull();
    expect(SparseMerkleTree.verifyProof(missing, 16)).toBe(true);

    // Wrong depth / root / value all reject
    expect(SparseMerkleTree.verifyProof(proof, 8)).toBe(false);
    expect(SparseMerkleTree.verifyProof({ ...proof, root: 'bad' }, 16)).toBe(false);
    expect(SparseMerkleTree.verifyProof({ ...proof, value: 'wrong' }, 16)).toBe(false);
  });

  it('handles many keys, produces deterministic roots, rejects invalid depths', () => {
    const a = new SparseMerkleTree(16);
    const b = new SparseMerkleTree(16);
    for (let i = 0; i < 50; i++) {
      a.insert(`key-${i}`, `value-${i}`);
      b.insert(`key-${i}`, `value-${i}`);
    }
    expect(a.size).toBe(50);
    expect(a.root).toBe(b.root);
    for (let i = 0; i < 50; i++) {
      expect(a.get(`key-${i}`)).toBe(`value-${i}`);
      const proof = a.generateProof(`key-${i}`);
      expect(proof.exists).toBe(true);
      expect(SparseMerkleTree.verifyProof(proof, 16)).toBe(true);
    }

    const diff1 = new SparseMerkleTree(8);
    const diff2 = new SparseMerkleTree(8);
    diff1.insert('a', '1');
    diff2.insert('a', '2');
    expect(diff1.root).not.toBe(diff2.root);

    expect(() => new SparseMerkleTree(0)).toThrow('Depth must be between');
    expect(() => new SparseMerkleTree(257)).toThrow('Depth must be between');
  });
});

describe('integration', () => {
  it('full workflow: build, prove, serialize, verify, diff, audit, visualize', () => {
    const data = makeData(100);
    const tree = buildMerkleTree(data);
    const proof = generateInclusionProof(tree, 42);
    expect(verifyInclusionProof(proof)).toBe(true);

    const restoredTree = deserializeTree(serializeTree(tree));
    expect(restoredTree.root).toBe(tree.root);

    const restoredProof = deserializeProof(serializeProof(proof));
    expect(verifyInclusionProof(restoredProof)).toBe(true);

    expect(verifyAuditPath(getAuditPath(restoredTree, 42))).toBe(true);
    expect(visualizeTree(restoredTree)).toContain('ROOT');

    // Diff after appending
    const extended = appendLeaves(buildMerkleTree(['a', 'b', 'c']), ['d', 'e']);
    expect(diffTrees(buildMerkleTree(['a', 'b', 'c']), extended).added).toEqual([3, 4]);
  });

  it('large scale: builds 2000-leaf tree and verifies spot-checked proofs', () => {
    const tree = buildMerkleTree(makeData(2000));
    expect(tree.leafCount).toBe(2000);
    for (const idx of [0, 500, 1000, 1500, 1999]) {
      expect(verifyInclusionProof(generateInclusionProof(tree, idx))).toBe(true);
    }
  });
});
