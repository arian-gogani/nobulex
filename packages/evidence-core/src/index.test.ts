import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String } from '@nobulex/crypto';
import {
  EvidenceChainBuilder,
  createEvidenceItem,
  verifyEvidenceItem,
  verifyEvidenceChain,
  computeEvidenceHash,
  evidenceItemSize,
} from './index';
import type { EvidenceInput } from './index';

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

describe('evidence-core', () => {
  describe('EvidenceChainBuilder', () => {
    it('should create a chain with sequential items', async () => {
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

    it('should produce unique hashes for different items', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item1 = await builder.append(makeInput({ toolName: 'a' }));
      const item2 = await builder.append(makeInput({ toolName: 'b' }));

      expect(item1.hash).not.toBe(item2.hash);
      expect(item1.id).not.toBe(item2.id);
    });

    it('should include all required fields', async () => {
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
    });

    it('should return items by index', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      const item = await builder.append(makeInput());
      expect(builder.get(0)).toEqual(item);
      expect(builder.get(1)).toBeUndefined();
    });

    it('should return hashes array', async () => {
      const kp = await generateKeyPair();
      const builder = new EvidenceChainBuilder('did:nobulex:agent1', kp);

      await builder.append(makeInput());
      await builder.append(makeInput());

      const hashes = builder.hashes();
      expect(hashes).toHaveLength(2);
      expect(hashes[0]).toBeTruthy();
    });

    it('should throw on empty agentDid', () => {
      expect(() => new EvidenceChainBuilder('', {} as KeyPair)).toThrow('agentDid is required');
    });
  });

  describe('createEvidenceItem', () => {
    it('should create a standalone signed item', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);

      expect(item.previousHash).toBeNull();
      expect(item.hash).toBeTruthy();
      expect(item.signature).toBeTruthy();
      expect(item.agentDid).toBe('did:nobulex:abc123');
    });

    it('should link to a previous hash', async () => {
      const kp = await generateKeyPair();
      const item1 = await createEvidenceItem(makeInput(), null, kp);
      const item2 = await createEvidenceItem(makeInput(), item1.hash, kp);

      expect(item2.previousHash).toBe(item1.hash);
    });
  });

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
    });

    it('should reject an item with wrong signer', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp1);

      const result = await verifyEvidenceItem(item, kp2.publicKey);
      expect(result.valid).toBe(false);
    });
  });

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
  });

  describe('computeEvidenceHash', () => {
    it('should be deterministic', () => {
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
  });

  describe('evidenceItemSize', () => {
    it('should return a reasonable size', async () => {
      const kp = await generateKeyPair();
      const item = await createEvidenceItem(makeInput(), null, kp);
      const size = evidenceItemSize(item);
      expect(size).toBeGreaterThan(200);
      expect(size).toBeLessThan(1024);
    });
  });
});
