import { describe, it, expect } from 'vitest';
import { verifyHashChain, independentVerify } from './index.js';
import { protect } from '@nobulex/sdk';
import { sha256String } from '@nobulex/crypto';

describe('independent-verifier', () => {
  describe('verifyHashChain', () => {
    it('should verify an empty log', async () => {
      const result = await verifyHashChain([]);
      expect(result.intact).toBe(true);
    });

    it('should verify a valid hash chain', async () => {
      const entry1Hash = await sha256String('1' + '2024-01-01T00:00:00Z' + 'agent-1' + 'read' + '/data' + '0000');
      const entry2Hash = await sha256String('2' + '2024-01-01T00:01:00Z' + 'agent-1' + 'read' + '/data/file' + entry1Hash);

      const log = [
        {
          id: '1',
          timestamp: '2024-01-01T00:00:00Z',
          agentId: 'agent-1',
          action: 'read',
          resource: '/data',
          inputHash: 'abc',
          outputHash: 'def',
          previousHash: '0000',
          hash: entry1Hash,
        },
        {
          id: '2',
          timestamp: '2024-01-01T00:01:00Z',
          agentId: 'agent-1',
          action: 'read',
          resource: '/data/file',
          inputHash: 'ghi',
          outputHash: 'jkl',
          previousHash: entry1Hash,
          hash: entry2Hash,
        },
      ];

      const result = await verifyHashChain(log);
      expect(result.intact).toBe(true);
    });

    it('should detect a tampered entry', async () => {
      const entry1Hash = await sha256String('1' + '2024-01-01T00:00:00Z' + 'agent-1' + 'read' + '/data' + '0000');

      const log = [
        {
          id: '1',
          timestamp: '2024-01-01T00:00:00Z',
          agentId: 'agent-1',
          action: 'read',
          resource: '/data',
          inputHash: 'abc',
          outputHash: 'def',
          previousHash: '0000',
          hash: 'tampered-hash',
        },
      ];

      const result = await verifyHashChain(log);
      expect(result.intact).toBe(false);
      expect(result.brokenAt).toBe(0);
    });

    it('should detect a broken chain link', async () => {
      const entry1Hash = await sha256String('1' + '2024-01-01T00:00:00Z' + 'agent-1' + 'read' + '/data' + '0000');
      const entry2Hash = await sha256String('2' + '2024-01-01T00:01:00Z' + 'agent-1' + 'read' + '/data/file' + entry1Hash);

      const log = [
        {
          id: '1',
          timestamp: '2024-01-01T00:00:00Z',
          agentId: 'agent-1',
          action: 'read',
          resource: '/data',
          inputHash: 'abc',
          outputHash: 'def',
          previousHash: '0000',
          hash: entry1Hash,
        },
        {
          id: '2',
          timestamp: '2024-01-01T00:01:00Z',
          agentId: 'agent-1',
          action: 'read',
          resource: '/data/file',
          inputHash: 'ghi',
          outputHash: 'jkl',
          previousHash: 'wrong-hash',
          hash: entry2Hash,
        },
      ];

      const result = await verifyHashChain(log);
      expect(result.intact).toBe(false);
      expect(result.brokenAt).toBe(1);
    });
  });

  describe('independentVerify', () => {
    it('should fully verify a valid covenant', async () => {
      const agent = await protect({
        name: 'test-agent',
        rules: ['read-only'],
      });

      const result = await independentVerify(agent.covenant, []);
      expect(result.covenantValid).toBe(true);
      expect(result.hashChainIntact).toBe(true);
      expect(result.allActionsCompliant).toBe(true);
      expect(result.verifierNote).toContain('PASSED');
    });
  });
});
