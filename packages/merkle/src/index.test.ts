import { describe, it, expect } from 'vitest';
import {
  hashLeaf,
  hashInner,
  buildMerkleTree,
  generateInclusionProof,
  verifyInclusionProof,
  EpochAggregator,
  verifyEpochChain,
} from './index';

describe('merkle', () => {
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
  });

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
      // Layer 0: [H(a), H(b), H(c)]
      // Layer 1: [H(H(a),H(b)), H(H(c),H(c))]
      // Layer 2: [root]
      expect(tree.layers).toHaveLength(3);
      expect(tree.layers[1]).toHaveLength(2);
    });

    it('should handle power-of-two leaves', () => {
      const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
      expect(tree.leafCount).toBe(4);
      expect(tree.layers).toHaveLength(3);
    });

    it('should handle many leaves', () => {
      const data = Array.from({ length: 100 }, (_, i) => `item-${i}`);
      const tree = buildMerkleTree(data);
      expect(tree.leafCount).toBe(100);
      expect(tree.root).toBeTruthy();
    });
  });

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
      const data = Array.from({ length: 1024 }, (_, i) => `item-${i}`);
      const tree = buildMerkleTree(data);
      const proof = generateInclusionProof(tree, 500);
      // log2(1024) = 10
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
  });

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
  });

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
  });
});
