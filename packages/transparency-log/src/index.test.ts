import { describe, it, expect } from 'vitest';
import {
  TransparencyLog,
  MemoryBackend,
  verifyLogInclusionProof,
} from './index';

describe('transparency-log', () => {
  describe('TransparencyLog', () => {
    it('should append entries with hash chain', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      const e1 = await log.append('root-aaa', 0, 10);
      const e2 = await log.append('root-bbb', 1, 20);
      const e3 = await log.append('root-ccc', 2, 15);

      expect(e1.index).toBe(0);
      expect(e1.previousHash).toBeNull();
      expect(e1.epochRoot).toBe('root-aaa');
      expect(e1.leafCount).toBe(10);

      expect(e2.index).toBe(1);
      expect(e2.previousHash).toBe(e1.hash);

      expect(e3.index).toBe(2);
      expect(e3.previousHash).toBe(e2.hash);
    });

    it('should retrieve entries by index', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      await log.append('root-1', 0, 5);
      const e2 = await log.append('root-2', 1, 10);

      const retrieved = await log.get(1);
      expect(retrieved).toEqual(e2);
    });

    it('should return null for missing entries', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      expect(await log.get(0)).toBeNull();
    });

    it('should get latest entry', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      expect(await log.getLatest()).toBeNull();

      await log.append('r1', 0, 1);
      const e2 = await log.append('r2', 1, 2);

      expect(await log.getLatest()).toEqual(e2);
    });

    it('should get range of entries', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      await log.append('r0', 0, 1);
      await log.append('r1', 1, 1);
      await log.append('r2', 2, 1);
      await log.append('r3', 3, 1);

      const range = await log.getRange(1, 3);
      expect(range).toHaveLength(2);
      expect(range[0]!.epochIndex).toBe(1);
      expect(range[1]!.epochIndex).toBe(2);
    });

    it('should track length', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      expect(await log.length()).toBe(0);
      await log.append('r', 0, 1);
      expect(await log.length()).toBe(1);
      await log.append('r', 1, 1);
      expect(await log.length()).toBe(2);
    });

    it('should default to self-hosted mode', () => {
      const log = new TransparencyLog();
      expect(log.mode).toBe('self-hosted');
    });
  });

  describe('verify', () => {
    it('should pass verification on valid log', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      await log.append('r0', 0, 10);
      await log.append('r1', 1, 20);
      await log.append('r2', 2, 30);

      const result = await log.verify();
      expect(result.valid).toBe(true);
      expect(result.length).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify empty log', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      const result = await log.verify();
      expect(result.valid).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('inclusion proofs', () => {
    it('should generate and verify inclusion proof', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      await log.append('r0', 0, 5);
      await log.append('r1', 1, 10);
      const e3 = await log.append('r2', 2, 15);

      const proof = await log.generateInclusionProof(0);
      expect(proof.entryIndex).toBe(0);
      expect(proof.headHash).toBe(e3.hash);
      expect(verifyLogInclusionProof(proof)).toBe(true);
    });

    it('should verify proof for latest entry', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      await log.append('r0', 0, 5);

      const proof = await log.generateInclusionProof(0);
      expect(proof.chainHashes).toHaveLength(0);
      expect(verifyLogInclusionProof(proof)).toBe(true);
    });

    it('should throw for out-of-range entry', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      await log.append('r0', 0, 5);

      await expect(log.generateInclusionProof(5)).rejects.toThrow('out of range');
    });
  });

  describe('MemoryBackend', () => {
    it('should implement all backend methods', async () => {
      const backend = new MemoryBackend();

      expect(await backend.length()).toBe(0);
      expect(await backend.get(0)).toBeNull();
      expect(await backend.getLatest()).toBeNull();

      const entry = {
        index: 0,
        epochRoot: 'root',
        timestamp: '2025-01-01T00:00:00.000Z',
        previousHash: null,
        hash: 'abc',
        leafCount: 5,
        epochIndex: 0,
      };

      await backend.append(entry);
      expect(await backend.length()).toBe(1);
      expect(await backend.get(0)).toEqual(entry);
      expect(await backend.getLatest()).toEqual(entry);
    });
  });
});
