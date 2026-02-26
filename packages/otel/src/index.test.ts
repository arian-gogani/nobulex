import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String } from '@nobulex/crypto';
import { EvidenceSpanProcessor } from './index';
import type { ReadableSpan } from './index';

function makeSpan(overrides?: Partial<ReadableSpan>): ReadableSpan {
  const now = Date.now();
  return {
    name: 'test-span',
    kind: 0,
    startTime: [Math.floor(now / 1000), (now % 1000) * 1_000_000],
    endTime: [Math.floor((now + 100) / 1000), ((now + 100) % 1000) * 1_000_000],
    attributes: {
      'tool.name': 'web_search',
      'nobulex.action_type': 'tool_call',
    },
    status: { code: 0 },
    spanContext: () => ({
      traceId: 'trace-123',
      spanId: 'span-456',
    }),
    ...overrides,
  };
}

describe('otel', () => {
  describe('EvidenceSpanProcessor', () => {
    it('should generate evidence items from spans', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
        modelVersion: 'claude-opus-4-20250514',
      });

      processor.onEnd(makeSpan());
      processor.onEnd(makeSpan({ name: 'second-span' }));

      await processor.forceFlush();

      const items = await processor.getEvidenceItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.agentDid).toBe('did:nobulex:agent1');
      expect(items[0]!.toolName).toBe('web_search');
      expect(items[0]!.actionType).toBe('tool_call');
      expect(items[0]!.previousHash).toBeNull();
      expect(items[1]!.previousHash).toBe(items[0]!.hash);
    });

    it('should extract tool name from span attributes', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      processor.onEnd(makeSpan({
        attributes: { 'rpc.method': 'SearchAPI' },
      }));

      await processor.forceFlush();
      const items = await processor.getEvidenceItems();
      expect(items[0]!.toolName).toBe('SearchAPI');
    });

    it('should fall back to span name for tool name', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      processor.onEnd(makeSpan({ attributes: {}, name: 'my-operation' }));

      await processor.forceFlush();
      const items = await processor.getEvidenceItems();
      expect(items[0]!.toolName).toBe('my-operation');
    });

    it('should respect filter function', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
        filter: (span) => span.name !== 'ignored',
      });

      processor.onEnd(makeSpan({ name: 'included' }));
      processor.onEnd(makeSpan({ name: 'ignored' }));
      processor.onEnd(makeSpan({ name: 'also-included' }));

      await processor.forceFlush();
      const items = await processor.getEvidenceItems();
      expect(items).toHaveLength(2);
    });

    it('should auto-seal epochs based on config', async () => {
      const kp = await generateKeyPair();
      const epochs: unknown[] = [];
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
        epochConfig: { maxItems: 2 },
        onEpochSealed: (epoch) => epochs.push(epoch),
      });

      processor.onEnd(makeSpan());
      processor.onEnd(makeSpan());
      // Wait for async evidence generation to complete
      await processor.forceFlush();

      // At least one epoch should have been created
      expect(processor.getAggregator().epochCount).toBeGreaterThanOrEqual(1);
    });

    it('should include parent span ID as parentActionId', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      processor.onEnd(makeSpan({ parentSpanId: 'parent-span-id' }));

      await processor.forceFlush();
      const items = await processor.getEvidenceItems();
      expect(items[0]!.parentActionId).toBe('parent-span-id');
    });

    it('should provide access to chain and aggregator', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      expect(processor.getChain()).toBeDefined();
      expect(processor.getAggregator()).toBeDefined();
    });

    it('onStart should be a no-op', () => {
      const kp = { privateKey: new Uint8Array(32), publicKey: new Uint8Array(32), publicKeyHex: '' };
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      // Should not throw
      processor.onStart(makeSpan());
    });

    it('shutdown should flush pending items', async () => {
      const kp = await generateKeyPair();
      const processor = new EvidenceSpanProcessor({
        agentDid: 'did:nobulex:agent1',
        keyPair: kp,
      });

      processor.onEnd(makeSpan());
      await processor.shutdown();

      const items = await processor.getEvidenceItems();
      expect(items).toHaveLength(1);
    });
  });
});
