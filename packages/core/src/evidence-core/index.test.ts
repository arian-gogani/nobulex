import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String } from '../crypto/index';
import type { KeyPair } from '../crypto/index';
import {
  EvidenceChainBuilder,
  EvidenceQuery,
  createEvidenceItem,
  createBatchEvidence,
  verifyEvidenceItem,
  verifyEvidenceChain,
  computeEvidenceHash,
  evidenceItemSize,
  detectFork,
  diffChains,
  serializeItem,
  deserializeItem,
  serializeChain,
  deserializeChain,
  auditChain,
  queryChain,
  chainStats,
  sliceChain,
  headN,
  tailN,
} from './index';
import type { EvidenceInput, EvidenceItem } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides?: Partial<EvidenceInput>): EvidenceInput {
  return {
    agentDid: 'did:nobulex:abc123',
    actionType: 'tool_call',
    toolName: 'web_search',
    inputHash: sha256String('query=test'),
    outputHash: sha256String('result=ok'),
    modelVersion: 'claude-opus-4-20250514',
    ...overrides,
  };
}

function makeTimedInput(ms: number, overrides?: Partial<EvidenceInput>): EvidenceInput {
  return makeInput({
    timestamp: new Date(1700000000000 + ms).toISOString(),
    ...overrides,
  });
}

async function buildChain(
  kp: KeyPair,
  count: number,
  inputFn?: (i: number) => Partial<EvidenceInput>,
): Promise<readonly EvidenceItem[]> {
  const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
  for (let i = 0; i < count; i++) {
    const overrides = inputFn ? inputFn(i) : { toolName: `tool_${i}` };
    await builder.append(makeInput(overrides));
  }
  return builder.entries();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evidence-core', () => {
  // ── EvidenceChainBuilder ────────────────────────────────────────────────

  describe('EvidenceChainBuilder', () => {
    it('should create a chain with sequential items linked via previousHash', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item1 = await builder.append(makeInput());
      const item2 = await builder.append(makeInput({ toolName: 'code_exec' }));
      const item3 = await builder.append(makeInput({ toolName: 'file_read' }));

      expect(builder.length).toBe(3);
      expect(item1.previousHash).toBeNull();
      expect(item2.previousHash).toBe(item1.hash);
      expect(item3.previousHash).toBe(item2.hash);
    });

    it('should produce unique hashes and IDs for different items', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item1 = await builder.append(makeInput({ toolName: 'a' }));
      const item2 = await builder.append(makeInput({ toolName: 'b' }));

      expect(item1.hash).not.toBe(item2.hash);
      expect(item1.id).not.toBe(item2.id);
    });

    it('should include all required fields on created items', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item = await builder.append(makeInput({
        parentActionId: 'parent-123',
        timestamp: '2025-01-01T00:00:00.000Z',
      }));

      expect(item.agentDid).toBe('did:nobulex:abc123');
      expect(item.actionType).toBe('tool_call');
      expect(item.toolName).toBe('web_search');
      expect(item.modelVersion).toBe('claude-opus-4-20250514');
      expect(item.parentActionId).toBe('parent-123');
      expect(item.hash).toBeTruthy();
      expect(item.signature).toBeTruthy();
      expect(item.id).toBeTruthy();
    });

    it('should return items by index via get()', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item = await builder.append(makeInput());
      expect(builder.get(0)).toEqual(item);
      expect(builder.get(1)).toBeUndefined();
    });

    it('should return hashes array matching appended items', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item1 = await builder.append(makeInput());
      const item2 = await builder.append(makeInput({ toolName: 'x' }));

      const hashes = builder.hashes();
      expect(hashes).toHaveLength(2);
      expect(hashes[0]).toBe(item1.hash);
      expect(hashes[1]).toBe(item2.hash);
    });

    it('should report headHash correctly', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      expect(builder.headHash).toBeNull();

      const item1 = await builder.append(makeInput());
      expect(builder.headHash).toBe(item1.hash);

      const item2 = await builder.append(makeInput({ toolName: 'y' }));
      expect(builder.headHash).toBe(item2.hash);
    });

    it('should return a defensive copy from entries()', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput());

      const copy = builder.entries();
      (copy as EvidenceItem[]).push({} as EvidenceItem);

      expect(builder.length).toBe(1);
    });

    it('should throw on empty agentDid', () => {
      expect(
        () => new EvidenceChainBuilder('', {} as KeyPair),
      ).toThrow('agentDid is required');
    });

    it('should use builder agentDid when input agentDid is empty', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:fallback', kp);

      const item = await builder.append(makeInput({ agentDid: '' }));
      expect(item.agentDid).toBe('did:nobulex:fallback');
    });

    it('should default parentActionId to null when not provided', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item = await builder.append(makeInput());
      expect(item.parentActionId).toBeNull();
    });
  });

  // ── EvidenceChainBuilder.appendBatch ────────────────────────────────────

  describe('EvidenceChainBuilder.appendBatch', () => {
    it('should append multiple items in sequence', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const items = await builder.appendBatch([
        makeInput({ toolName: 'tool_a' }),
        makeInput({ toolName: 'tool_b' }),
        makeInput({ toolName: 'tool_c' }),
      ]);

      expect(items).toHaveLength(3);
      expect(builder.length).toBe(3);
      expect(items[0]!.previousHash).toBeNull();
      expect(items[1]!.previousHash).toBe(items[0]!.hash);
      expect(items[2]!.previousHash).toBe(items[1]!.hash);
    });

    it('should return empty array for empty input', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const items = await builder.appendBatch([]);
      expect(items).toHaveLength(0);
      expect(builder.length).toBe(0);
    });

    it('should correctly chain after existing items', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const first = await builder.append(makeInput({ toolName: 'first' }));
      const batch = await builder.appendBatch([
        makeInput({ toolName: 'batch_a' }),
        makeInput({ toolName: 'batch_b' }),
      ]);

      expect(batch[0]!.previousHash).toBe(first.hash);
      expect(builder.length).toBe(3);
    });
  });

  // ── createEvidenceItem ──────────────────────────────────────────────────

  describe('createEvidenceItem', () => {
    it('should create a standalone signed item with null previousHash', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      expect(item.previousHash).toBeNull();
      expect(item.hash).toBeTruthy();
      expect(item.signature).toBeTruthy();
      expect(item.agentDid).toBe('did:nobulex:abc123');
    });

    it('should link to a provided previousHash', async () => {
      const kp = await generateKeyPair();
      const item1 = await createEvidenceItem(makeInput(), null, kp);
      const item2 = await createEvidenceItem(makeInput(), item1.hash, kp);

      expect(item2.previousHash).toBe(item1.hash);
    });

    it('should use provided timestamp when given', async () => {
      const kp = await generateKeyPair();
      const ts = '2025-06-15T12:00:00.000Z';
      const item = await createEvidenceItem(makeInput({ timestamp: ts }), null, kp);
      expect(item.timestamp).toBe(ts);
    });

    it('should generate unique IDs for each standalone item', async () => {
      const kp = await generateKeyPair();
      const item1 = await createEvidenceItem(makeInput(), null, kp);
      const item2 = await createEvidenceItem(makeInput(), null, kp);
      expect(item1.id).not.toBe(item2.id);
    });
  });

  // ── createBatchEvidence ─────────────────────────────────────────────────

  describe('createBatchEvidence', () => {
    it('should create a chained batch of items starting from null', async () => {
      const kp = await generateKeyPair();
      const inputs = [
        makeInput({ toolName: 'a' }),
        makeInput({ toolName: 'b' }),
        makeInput({ toolName: 'c' }),
      ];

      const items = await createBatchEvidence(inputs, null, kp);

      expect(items).toHaveLength(3);
      expect(items[0]!.previousHash).toBeNull();
      expect(items[1]!.previousHash).toBe(items[0]!.hash);
      expect(items[2]!.previousHash).toBe(items[1]!.hash);
    });

    it('should chain from a provided previous hash', async () => {
      const kp = await generateKeyPair();
      const genesis = await createEvidenceItem(makeInput(), null, kp);
      const batch = await createBatchEvidence(
        [makeInput({ toolName: 'after_genesis' })],
        genesis.hash,
        kp,
      );

      expect(batch[0]!.previousHash).toBe(genesis.hash);
    });

    it('should return empty array for empty inputs', async () => {
      const kp = await generateKeyPair();
      const items = await createBatchEvidence([], null, kp);
      expect(items).toHaveLength(0);
    });

    it('should produce individually verifiable items', async () => {
      const kp = await generateKeyPair();
      const items = await createBatchEvidence(
        [makeInput(), makeInput({ toolName: 'b' })],
        null,
        kp,
      );

      for (const item of items) {
        const result = await verifyEvidenceItem(item, kp.publicKey);
        expect(result.valid).toBe(true);
      }
    });
  });

  // ── verifyEvidenceItem ──────────────────────────────────────────────────

  describe('verifyEvidenceItem', () => {
    it('should verify a valid item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const result = await verifyEvidenceItem(item, kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.checks).toHaveLength(2);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('should reject an item with tampered hash', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const tampered = { ...item, hash: 'deadbeef'.repeat(8) };
      const result = await verifyEvidenceItem(tampered, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'hash_integrity')?.passed).toBe(false);
    });

    it('should reject an item signed with a different key', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp1);

      const result = await verifyEvidenceItem(item, kp2.publicKey);
      expect(result.valid).toBe(false);
      expect(result.checks.find((c) => c.name === 'signature_valid')?.passed).toBe(false);
    });

    it('should reject an item with tampered content', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const tampered = { ...item, toolName: 'tampered_tool' };
      const result = await verifyEvidenceItem(tampered, kp.publicKey);
      expect(result.valid).toBe(false);
    });

    it('should handle malformed signature gracefully', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const tampered = { ...item, signature: 'not_valid_hex' };
      const result = await verifyEvidenceItem(tampered, kp.publicKey);
      expect(result.valid).toBe(false);
    });
  });

  // ── verifyEvidenceChain ─────────────────────────────────────────────────

  describe('verifyEvidenceChain', () => {
    it('should verify a valid chain', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      await builder.append(makeInput());
      await builder.append(makeInput({ toolName: 'b' }));
      await builder.append(makeInput({ toolName: 'c' }));

      const result = await verifyEvidenceChain(builder.entries(), kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.length).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify an empty chain', async () => {
      const kp = await generateKeyPair();
      const result = await verifyEvidenceChain([], kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should detect broken chain linkage', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      await builder.append(makeInput());
      await builder.append(makeInput({ toolName: 'b' }));

      const items = [...builder.entries()];
      items[1] = { ...items[1]!, previousHash: 'wrong' };

      const result = await verifyEvidenceChain(items, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('previousHash'))).toBe(true);
    });

    it('should detect non-null previousHash on first item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), 'some_hash', kp);

      const result = await verifyEvidenceChain([item], kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('First item'))).toBe(true);
    });

    it('should detect timestamp ordering violations', async () => {
      const kp = await generateKeyPair();
      const item1 = await createEvidenceItem(
        makeInput({ timestamp: '2025-06-15T12:00:00.000Z' }),
        null,
        kp,
      );
      const item2 = await createEvidenceItem(
        makeInput({ timestamp: '2025-06-14T12:00:00.000Z' }),
        item1.hash,
        kp,
      );

      const result = await verifyEvidenceChain([item1, item2], kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('timestamp'))).toBe(true);
    });
  });

  // ── computeEvidenceHash ─────────────────────────────────────────────────

  describe('computeEvidenceHash', () => {
    it('should be deterministic for the same content', () => {
      const content = {
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:a',
        actionType: 'tool_call',
        toolName: 'test',
        inputHash: 'abc',
        outputHash: 'def',
        modelVersion: 'v1',
        parentActionId: null,
        previousHash: null,
      };
      expect(computeEvidenceHash(content)).toBe(computeEvidenceHash(content));
    });

    it('should produce different hashes for different content', () => {
      const base = {
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:a',
        actionType: 'tool_call',
        toolName: 'test',
        inputHash: 'abc',
        outputHash: 'def',
        modelVersion: 'v1',
        parentActionId: null,
        previousHash: null,
      };
      const modified = { ...base, toolName: 'different' };
      expect(computeEvidenceHash(base)).not.toBe(computeEvidenceHash(modified));
    });

    it('should return a 64-character hex string (SHA-256)', () => {
      const content = {
        timestamp: '2025-01-01T00:00:00.000Z',
        agentDid: 'did:nobulex:a',
        actionType: 'tool_call',
        toolName: 'test',
        inputHash: 'abc',
        outputHash: 'def',
        modelVersion: 'v1',
        parentActionId: null,
        previousHash: null,
      };
      const hash = computeEvidenceHash(content);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── evidenceItemSize ────────────────────────────────────────────────────

  describe('evidenceItemSize', () => {
    it('should return a reasonable byte size for a valid item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);
      const size = evidenceItemSize(item);
      expect(size).toBeGreaterThan(200);
      expect(size).toBeLessThan(1024);
    });

    it('should return larger size for items with longer field values', async () => {
      const kp = await generateKeyPair();
      const shortItem = await createEvidenceItem(makeInput({ toolName: 'a' }), null, kp);
      const longItem = await createEvidenceItem(
        makeInput({ toolName: 'a_very_long_tool_name_that_should_increase_size' }),
        null,
        kp,
      );
      expect(evidenceItemSize(longItem)).toBeGreaterThan(evidenceItemSize(shortItem));
    });

    it('should be consistent for the same item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(
        makeInput({ timestamp: '2025-01-01T00:00:00.000Z' }),
        null,
        kp,
      );
      expect(evidenceItemSize(item)).toBe(evidenceItemSize(item));
    });
  });

  // ── detectFork ──────────────────────────────────────────────────────────

  describe('detectFork', () => {
    it('should return forkIndex -1 for identical chains', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const result = detectFork(chain, chain);

      expect(result.forkIndex).toBe(-1);
      expect(result.commonPrefix).toHaveLength(3);
      expect(result.branchA).toHaveLength(0);
      expect(result.branchB).toHaveLength(0);
    });

    it('should detect a fork at the very first item', async () => {
      const kp = await generateKeyPair();
      const chainA = await buildChain(kp, 3, (i) => ({ toolName: `a_${i}` }));
      const chainB = await buildChain(kp, 3, (i) => ({ toolName: `b_${i}` }));

      const result = detectFork(chainA, chainB);

      expect(result.forkIndex).toBe(0);
      expect(result.commonPrefix).toHaveLength(0);
      expect(result.branchA).toHaveLength(3);
      expect(result.branchB).toHaveLength(3);
    });

    it('should detect fork with a shared prefix', async () => {
      const kp = await generateKeyPair();

      const builderA = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderA.append(makeTimedInput(0, { toolName: 'shared_0' }));
      await builderA.append(makeTimedInput(1000, { toolName: 'shared_1' }));
      await builderA.append(makeTimedInput(2000, { toolName: 'fork_a' }));
      const chainA = builderA.entries();

      const builderB = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderB.append(makeTimedInput(0, { toolName: 'shared_0' }));
      await builderB.append(makeTimedInput(1000, { toolName: 'shared_1' }));
      await builderB.append(makeTimedInput(2000, { toolName: 'fork_b' }));
      const chainB = builderB.entries();

      const result = detectFork(chainA, chainB);

      expect(result.forkIndex).toBe(2);
      expect(result.commonPrefix).toHaveLength(2);
      expect(result.branchA).toHaveLength(1);
      expect(result.branchB).toHaveLength(1);
      expect(result.branchA[0]!.toolName).toBe('fork_a');
      expect(result.branchB[0]!.toolName).toBe('fork_b');
    });

    it('should handle one chain being a prefix of the other', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeTimedInput(0, { toolName: 't0' }));
      await builder.append(makeTimedInput(1000, { toolName: 't1' }));
      await builder.append(makeTimedInput(2000, { toolName: 't2' }));
      const longChain = builder.entries();

      const shortChain = longChain.slice(0, 2);
      const result = detectFork(longChain, shortChain);

      expect(result.forkIndex).toBe(2);
      expect(result.commonPrefix).toHaveLength(2);
      expect(result.branchA).toHaveLength(1);
      expect(result.branchB).toHaveLength(0);
    });

    it('should handle two empty chains', () => {
      const result = detectFork([], []);
      expect(result.forkIndex).toBe(-1);
      expect(result.commonPrefix).toHaveLength(0);
    });

    it('should handle one empty and one non-empty chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 2);

      const result = detectFork(chain, []);
      expect(result.forkIndex).toBe(0);
      expect(result.commonPrefix).toHaveLength(0);
      expect(result.branchA).toHaveLength(2);
      expect(result.branchB).toHaveLength(0);
    });
  });

  // ── serializeItem / deserializeItem ─────────────────────────────────────

  describe('serializeItem / deserializeItem', () => {
    it('should round-trip a single item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const json = serializeItem(item);
      const restored = deserializeItem(json);

      expect(restored.id).toBe(item.id);
      expect(restored.hash).toBe(item.hash);
      expect(restored.signature).toBe(item.signature);
      expect(restored.agentDid).toBe(item.agentDid);
      expect(restored.previousHash).toBeNull();
    });

    it('should produce deterministic JSON', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const json1 = serializeItem(item);
      const json2 = serializeItem(item);
      expect(json1).toBe(json2);
    });

    it('should throw on invalid JSON', () => {
      expect(() => deserializeItem('not json')).toThrow('Failed to parse');
    });

    it('should throw on missing required fields', () => {
      expect(() => deserializeItem('{"id":"test"}')).toThrow('missing required field');
    });

    it('should throw on wrong field types', () => {
      const obj = {
        id: 123,
        timestamp: 't',
        agentDid: 'a',
        actionType: 'a',
        toolName: 'a',
        inputHash: 'a',
        outputHash: 'a',
        modelVersion: 'a',
        parentActionId: null,
        previousHash: null,
        hash: 'a',
        signature: 'a',
      };
      expect(() => deserializeItem(JSON.stringify(obj))).toThrow('must be a string');
    });

    it('should reject non-object input', () => {
      expect(() => deserializeItem('"just a string"')).toThrow('expected an object');
    });

    it('should reject null input', () => {
      expect(() => deserializeItem('null')).toThrow('expected an object');
    });
  });

  // ── serializeChain / deserializeChain ───────────────────────────────────

  describe('serializeChain / deserializeChain', () => {
    it('should round-trip a chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const json = serializeChain(chain);
      const restored = deserializeChain(json);

      expect(restored).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(restored[i]!.hash).toBe(chain[i]!.hash);
        expect(restored[i]!.signature).toBe(chain[i]!.signature);
      }
    });

    it('should handle empty chain', () => {
      const json = serializeChain([]);
      const restored = deserializeChain(json);
      expect(restored).toHaveLength(0);
    });

    it('should throw on non-array JSON', () => {
      expect(() => deserializeChain('{"not":"array"}')).toThrow('must be a JSON array');
    });

    it('should throw on invalid items within array', () => {
      expect(() => deserializeChain('[{"bad":"item"}]')).toThrow('missing required field');
    });

    it('should throw on malformed JSON', () => {
      expect(() => deserializeChain('not json at all')).toThrow('Failed to parse');
    });

    it('should produce deterministic output', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 2);

      expect(serializeChain(chain)).toBe(serializeChain(chain));
    });
  });

  // ── auditChain ──────────────────────────────────────────────────────────

  describe('auditChain', () => {
    it('should pass audit for a valid chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      const report = await auditChain(chain, kp.publicKey);

      expect(report.valid).toBe(true);
      expect(report.totalItems).toBe(5);
      expect(report.validItems).toBe(5);
      expect(report.invalidItems).toBe(0);
      expect(report.gaps).toHaveLength(0);
      expect(report.duplicates).toHaveLength(0);
      expect(report.timingAnomalies).toHaveLength(0);
      expect(report.entries).toHaveLength(5);
    });

    it('should handle empty chain', async () => {
      const kp = await generateKeyPair();
      const report = await auditChain([], kp.publicKey);

      expect(report.valid).toBe(true);
      expect(report.totalItems).toBe(0);
    });

    it('should detect hash tampering', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);
      const tampered = [...chain];
      tampered[1] = { ...tampered[1]!, hash: 'deadbeef'.repeat(8) };

      const report = await auditChain(tampered, kp.publicKey);

      expect(report.valid).toBe(false);
      expect(report.invalidItems).toBeGreaterThan(0);
      expect(report.entries[1]!.hashValid).toBe(false);
    });

    it('should detect wrong public key (signature failure)', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const chain = await buildChain(kp1, 2);

      const report = await auditChain(chain, kp2.publicKey);

      expect(report.valid).toBe(false);
      for (const entry of report.entries) {
        expect(entry.signatureValid).toBe(false);
      }
    });

    it('should detect chain linkage gaps', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);
      const broken = [...chain];
      broken[2] = { ...broken[2]!, previousHash: 'wrong_hash' };

      const report = await auditChain(broken, kp.publicKey);

      expect(report.gaps).toContain(2);
      expect(report.entries[2]!.linkageValid).toBe(false);
    });

    it('should detect timing anomalies', async () => {
      const kp = await generateKeyPair();
      const item1 = await createEvidenceItem(
        makeInput({ timestamp: '2025-06-15T12:00:00.000Z' }),
        null,
        kp,
      );
      const item2 = await createEvidenceItem(
        makeInput({ timestamp: '2025-06-14T12:00:00.000Z' }),
        item1.hash,
        kp,
      );

      const report = await auditChain([item1, item2], kp.publicKey);

      expect(report.timingAnomalies).toContain(1);
    });

    it('should detect duplicate hashes', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      const report = await auditChain([item, item], kp.publicKey);

      expect(report.duplicates).toContain(1);
    });

    it('should report first item with non-null previousHash', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), 'some_hash', kp);

      const report = await auditChain([item], kp.publicKey);

      expect(report.valid).toBe(false);
      expect(report.entries[0]!.linkageValid).toBe(false);
    });

    it('should provide human-readable summary', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const report = await auditChain(chain, kp.publicKey);
      expect(report.summary.length).toBeGreaterThan(0);
      expect(report.summary[0]).toContain('passed audit');
    });
  });

  // ── diffChains ──────────────────────────────────────────────────────────

  describe('diffChains', () => {
    it('should find no diff for identical chains', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const result = diffChains(chain, chain);

      expect(result.onlyInA).toHaveLength(0);
      expect(result.onlyInB).toHaveLength(0);
      expect(result.common).toHaveLength(3);
    });

    it('should find all items unique when chains are disjoint', async () => {
      const kp = await generateKeyPair();
      const chainA = await buildChain(kp, 2, (i) => ({ toolName: `a_${i}` }));
      const chainB = await buildChain(kp, 3, (i) => ({ toolName: `b_${i}` }));

      const result = diffChains(chainA, chainB);

      expect(result.onlyInA).toHaveLength(2);
      expect(result.onlyInB).toHaveLength(3);
      expect(result.common).toHaveLength(0);
    });

    it('should handle empty chains', () => {
      const result = diffChains([], []);
      expect(result.onlyInA).toHaveLength(0);
      expect(result.onlyInB).toHaveLength(0);
      expect(result.common).toHaveLength(0);
    });

    it('should handle one empty and one non-empty chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 2);

      const result = diffChains(chain, []);
      expect(result.onlyInA).toHaveLength(2);
      expect(result.onlyInB).toHaveLength(0);
      expect(result.common).toHaveLength(0);
    });

    it('should find common prefix and unique suffixes', async () => {
      const kp = await generateKeyPair();
      const builderA = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderA.append(makeTimedInput(0, { toolName: 'shared' }));
      await builderA.append(makeTimedInput(1000, { toolName: 'only_a' }));
      const chainA = builderA.entries();

      const builderB = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderB.append(makeTimedInput(0, { toolName: 'shared' }));
      await builderB.append(makeTimedInput(1000, { toolName: 'only_b' }));
      const chainB = builderB.entries();

      const result = diffChains(chainA, chainB);

      expect(result.common).toHaveLength(1);
      expect(result.onlyInA).toHaveLength(1);
      expect(result.onlyInB).toHaveLength(1);
    });
  });

  // ── EvidenceQuery ───────────────────────────────────────────────────────

  describe('EvidenceQuery', () => {
    async function setupQueryItems(): Promise<readonly EvidenceItem[]> {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      await builder.append(makeTimedInput(0, {
        agentDid: 'did:nobulex:alice',
        actionType: 'tool_call',
        toolName: 'web_search',
        modelVersion: 'v1',
      }));
      await builder.append(makeTimedInput(1000, {
        agentDid: 'did:nobulex:alice',
        actionType: 'api_request',
        toolName: 'http_client',
        modelVersion: 'v1',
      }));
      await builder.append(makeTimedInput(2000, {
        agentDid: 'did:nobulex:bob',
        actionType: 'tool_call',
        toolName: 'code_exec',
        modelVersion: 'v2',
        parentActionId: 'parent-1',
      }));
      await builder.append(makeTimedInput(3000, {
        agentDid: 'did:nobulex:bob',
        actionType: 'delegation',
        toolName: 'delegate',
        modelVersion: 'v2',
        parentActionId: 'parent-1',
      }));
      await builder.append(makeTimedInput(4000, {
        agentDid: 'did:nobulex:alice',
        actionType: 'tool_call',
        toolName: 'web_search',
        modelVersion: 'v2',
      }));

      return builder.entries();
    }

    it('should filter by agent DID', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().byAgent('did:nobulex:alice').execute(items);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.agentDid === 'did:nobulex:alice')).toBe(true);
    });

    it('should filter by action type', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().byActionType('tool_call').execute(items);
      expect(results).toHaveLength(3);
    });

    it('should filter by tool name', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().byToolName('web_search').execute(items);
      expect(results).toHaveLength(2);
    });

    it('should filter by time range', async () => {
      const items = await setupQueryItems();
      const start = new Date(1700000000000 + 1000).toISOString();
      const end = new Date(1700000000000 + 3000).toISOString();
      const results = new EvidenceQuery().byTimeRange(start, end).execute(items);
      expect(results).toHaveLength(3);
    });

    it('should filter by parent action ID', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().byParentAction('parent-1').execute(items);
      expect(results).toHaveLength(2);
    });

    it('should filter by model version', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().byModel('v1').execute(items);
      expect(results).toHaveLength(2);
    });

    it('should combine multiple filters with AND logic', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery()
        .byAgent('did:nobulex:alice')
        .byActionType('tool_call')
        .execute(items);
      expect(results).toHaveLength(2);
    });

    it('should return empty array when no items match', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery()
        .byAgent('did:nobulex:nonexistent')
        .execute(items);
      expect(results).toHaveLength(0);
    });

    it('should return all items when no filters are applied', async () => {
      const items = await setupQueryItems();
      const results = new EvidenceQuery().execute(items);
      expect(results).toHaveLength(5);
    });
  });

  // ── queryChain ──────────────────────────────────────────────────────────

  describe('queryChain', () => {
    it('should filter by agentDid', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput({ agentDid: 'did:nobulex:alice' }));
      await builder.append(makeInput({ agentDid: 'did:nobulex:bob' }));
      const items = builder.entries();

      const results = queryChain(items, { agentDid: 'did:nobulex:alice' });
      expect(results).toHaveLength(1);
      expect(results[0]!.agentDid).toBe('did:nobulex:alice');
    });

    it('should filter by toolName', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput({ toolName: 'search' }));
      await builder.append(makeInput({ toolName: 'exec' }));
      const items = builder.entries();

      const results = queryChain(items, { toolName: 'exec' });
      expect(results).toHaveLength(1);
    });

    it('should filter by multiple criteria', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput({ agentDid: 'alice', actionType: 'tool_call' }));
      await builder.append(makeInput({ agentDid: 'alice', actionType: 'api_request' }));
      await builder.append(makeInput({ agentDid: 'bob', actionType: 'tool_call' }));
      const items = builder.entries();

      const results = queryChain(items, {
        agentDid: 'alice',
        actionType: 'tool_call',
      });
      expect(results).toHaveLength(1);
    });

    it('should return all items with empty filter', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const results = queryChain(chain, {});
      expect(results).toHaveLength(3);
    });

    it('should filter by modelVersion', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput({ modelVersion: 'v1' }));
      await builder.append(makeInput({ modelVersion: 'v2' }));
      const items = builder.entries();

      const results = queryChain(items, { modelVersion: 'v2' });
      expect(results).toHaveLength(1);
      expect(results[0]!.modelVersion).toBe('v2');
    });

    it('should filter by time range via timeStart and timeEnd', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeTimedInput(0, { toolName: 'early' }));
      await builder.append(makeTimedInput(5000, { toolName: 'mid' }));
      await builder.append(makeTimedInput(10000, { toolName: 'late' }));
      const items = builder.entries();

      const start = new Date(1700000000000 + 3000).toISOString();
      const end = new Date(1700000000000 + 7000).toISOString();
      const results = queryChain(items, { timeStart: start, timeEnd: end });
      expect(results).toHaveLength(1);
      expect(results[0]!.toolName).toBe('mid');
    });
  });

  // ── chainStats ──────────────────────────────────────────────────────────

  describe('chainStats', () => {
    it('should return zeroes for empty chain', () => {
      const stats = chainStats([]);
      expect(stats.totalItems).toBe(0);
      expect(stats.uniqueAgents).toBe(0);
      expect(stats.uniqueTools).toBe(0);
      expect(stats.uniqueActionTypes).toBe(0);
      expect(stats.timeSpan).toBe(0);
      expect(stats.averageInterval).toBe(0);
      expect(stats.itemSizeStats.min).toBe(0);
      expect(stats.itemSizeStats.max).toBe(0);
    });

    it('should compute correct unique counts', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeTimedInput(0, {
        agentDid: 'did:nobulex:alice',
        actionType: 'tool_call',
        toolName: 'search',
      }));
      await builder.append(makeTimedInput(1000, {
        agentDid: 'did:nobulex:bob',
        actionType: 'api_request',
        toolName: 'http',
      }));
      await builder.append(makeTimedInput(2000, {
        agentDid: 'did:nobulex:alice',
        actionType: 'tool_call',
        toolName: 'exec',
      }));
      const items = builder.entries();

      const stats = chainStats(items);
      expect(stats.totalItems).toBe(3);
      expect(stats.uniqueAgents).toBe(2);
      expect(stats.uniqueTools).toBe(3);
      expect(stats.uniqueActionTypes).toBe(2);
    });

    it('should compute time span and average interval', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeTimedInput(0));
      await builder.append(makeTimedInput(1000));
      await builder.append(makeTimedInput(3000));
      const items = builder.entries();

      const stats = chainStats(items);
      expect(stats.timeSpan).toBe(3000);
      expect(stats.averageInterval).toBe(1500);
    });

    it('should compute item size statistics', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builder.append(makeInput({ toolName: 'a' }));
      await builder.append(makeInput({ toolName: 'longer_tool_name' }));
      const items = builder.entries();

      const stats = chainStats(items);
      expect(stats.itemSizeStats.min).toBeGreaterThan(0);
      expect(stats.itemSizeStats.max).toBeGreaterThanOrEqual(stats.itemSizeStats.min);
      expect(stats.itemSizeStats.total).toBe(
        stats.itemSizeStats.average * stats.totalItems,
      );
    });

    it('should handle single item chain (zero timeSpan)', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);
      const stats = chainStats([item]);

      expect(stats.totalItems).toBe(1);
      expect(stats.timeSpan).toBe(0);
      expect(stats.averageInterval).toBe(0);
      expect(stats.uniqueAgents).toBe(1);
    });
  });

  // ── sliceChain ──────────────────────────────────────────────────────────

  describe('sliceChain', () => {
    it('should slice a range from the chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      const sliced = sliceChain(chain, 1, 4);
      expect(sliced).toHaveLength(3);
      expect(sliced[0]!.hash).toBe(chain[1]!.hash);
      expect(sliced[2]!.hash).toBe(chain[3]!.hash);
    });

    it('should return full chain with default params', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const sliced = sliceChain(chain);
      expect(sliced).toHaveLength(3);
    });

    it('should throw on negative start', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      expect(() => sliceChain(chain, -1)).toThrow('negative');
    });

    it('should throw on end exceeding length', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      expect(() => sliceChain(chain, 0, 10)).toThrow('exceeds chain length');
    });

    it('should throw on start > end', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      expect(() => sliceChain(chain, 3, 1)).toThrow('start index');
    });

    it('should return empty slice for start === end', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const sliced = sliceChain(chain, 2, 2);
      expect(sliced).toHaveLength(0);
    });
  });

  // ── headN ───────────────────────────────────────────────────────────────

  describe('headN', () => {
    it('should return first N items', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      const head = headN(chain, 3);
      expect(head).toHaveLength(3);
      expect(head[0]!.hash).toBe(chain[0]!.hash);
      expect(head[2]!.hash).toBe(chain[2]!.hash);
    });

    it('should return entire chain when N exceeds length', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const head = headN(chain, 10);
      expect(head).toHaveLength(3);
    });

    it('should return empty for N=0', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const head = headN(chain, 0);
      expect(head).toHaveLength(0);
    });

    it('should throw on negative N', () => {
      expect(() => headN([], -1)).toThrow('non-negative');
    });
  });

  // ── tailN ───────────────────────────────────────────────────────────────

  describe('tailN', () => {
    it('should return last N items', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      const tail = tailN(chain, 2);
      expect(tail).toHaveLength(2);
      expect(tail[0]!.hash).toBe(chain[3]!.hash);
      expect(tail[1]!.hash).toBe(chain[4]!.hash);
    });

    it('should return entire chain when N exceeds length', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const tail = tailN(chain, 10);
      expect(tail).toHaveLength(3);
    });

    it('should return empty for N=0', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 3);

      const tail = tailN(chain, 0);
      expect(tail).toHaveLength(0);
    });

    it('should throw on negative N', () => {
      expect(() => tailN([], -1)).toThrow('non-negative');
    });
  });

  // ── Cross-feature interactions ──────────────────────────────────────────

  describe('cross-feature interactions', () => {
    it('should detect fork after serialization round-trip', async () => {
      const kp = await generateKeyPair();

      const builderA = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderA.append(makeTimedInput(0, { toolName: 'shared' }));
      await builderA.append(makeTimedInput(1000, { toolName: 'branch_a' }));

      const builderB = new EvidenceChainBuilder('did:nobulex:agent1', kp);
      await builderB.append(makeTimedInput(0, { toolName: 'shared' }));
      await builderB.append(makeTimedInput(1000, { toolName: 'branch_b' }));

      const chainA = deserializeChain(serializeChain(builderA.entries()));
      const chainB = deserializeChain(serializeChain(builderB.entries()));

      const fork = detectFork(chainA, chainB);
      expect(fork.forkIndex).toBe(1);
    });

    it('should slice then query a sub-chain', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      for (let i = 0; i < 10; i++) {
        await builder.append(makeTimedInput(i * 1000, {
          agentDid: i < 5 ? 'did:nobulex:alice' : 'did:nobulex:bob',
          toolName: `tool_${i}`,
        }));
      }

      const middle = sliceChain(builder.entries(), 3, 8);
      const aliceItems = queryChain(middle, { agentDid: 'did:nobulex:alice' });

      // Items 3-7: indices 3,4 are alice, 5,6,7 are bob
      expect(aliceItems).toHaveLength(2);
    });

    it('should compute stats on head of a chain', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 10, (i) => ({
        toolName: `tool_${i}`,
        timestamp: new Date(1700000000000 + i * 1000).toISOString(),
      }));

      const head = headN(chain, 5);
      const stats = chainStats(head);
      expect(stats.totalItems).toBe(5);
      expect(stats.timeSpan).toBe(4000);
    });

    it('should diff a chain against its tail', async () => {
      const kp = await generateKeyPair();
      const chain = await buildChain(kp, 5);

      const tail = tailN(chain, 3);
      const diff = diffChains(chain, tail);

      expect(diff.onlyInA).toHaveLength(2);
      expect(diff.common).toHaveLength(3);
      expect(diff.onlyInB).toHaveLength(0);
    });

    it('should audit a batch-created chain', async () => {
      const kp = await generateKeyPair();
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeTimedInput(i * 1000, { toolName: `batch_${i}` }),
      );

      const chain = await createBatchEvidence(inputs, null, kp);
      const report = await auditChain(chain, kp.publicKey);

      expect(report.valid).toBe(true);
      expect(report.totalItems).toBe(10);
      expect(report.gaps).toHaveLength(0);
    });

    it('should verify a chain built with createBatchEvidence', async () => {
      const kp = await generateKeyPair();
      const inputs = Array.from({ length: 5 }, (_, i) =>
        makeTimedInput(i * 1000, { toolName: `tool_${i}` }),
      );

      const chain = await createBatchEvidence(inputs, null, kp);
      const result = await verifyEvidenceChain(chain, kp.publicKey);

      expect(result.valid).toBe(true);
      expect(result.length).toBe(5);
      expect(result.errors).toHaveLength(0);
    });
  });
});
