import { describe, it, expect, beforeEach } from 'vitest';
import { sha256String, sha256Object } from '@nobulex/crypto';
import { buildMerkleTreeFromHashes, verifyInclusionProof, generateInclusionProof } from '@nobulex/merkle';
import {
  nobulex,
  NobulexAuditHandler,
  NobulexWrapper,
} from './index';
import type {
  EvidenceItem,
  AuditLog,
  ComplianceReport,
  IntegrityResult,
  Runnable,
  WrapOptions,
} from './index';

// ─── Mock Runnable ──────────────────────────────────────────────────────────

/** A mock LangChain Runnable that calls handler methods to simulate events. */
function createMockRunnable(
  events?: Array<{
    type: 'llm' | 'chain' | 'tool';
    input?: unknown;
    output?: unknown;
    error?: Error;
  }>,
): Runnable<string, string> {
  return {
    async invoke(input: string, options?: Record<string, unknown>): Promise<string> {
      const callbacks = (options?.callbacks ?? []) as NobulexAuditHandler[];
      const handler = callbacks.find((cb) => cb.name === 'NobulexAuditHandler');

      if (handler && events) {
        for (const event of events) {
          const runId = `run-${Math.random().toString(36).substring(2, 10)}`;

          if (event.type === 'llm') {
            await handler.handleLLMStart({ name: 'gpt-4' }, [input], runId);
            if (event.error) {
              await handler.handleLLMError(event.error, runId);
            } else {
              await handler.handleLLMEnd(
                { generations: [[{ text: event.output ?? 'response' }]] },
                runId,
              );
            }
          } else if (event.type === 'chain') {
            await handler.handleChainStart({ name: 'test-chain' }, { input }, runId);
            if (event.error) {
              await handler.handleChainError(event.error, runId);
            } else {
              await handler.handleChainEnd(
                { output: event.output ?? 'chain-result' },
                runId,
              );
            }
          } else if (event.type === 'tool') {
            await handler.handleToolStart({ name: 'search' }, input, runId);
            if (event.error) {
              await handler.handleToolError(event.error, runId);
            } else {
              await handler.handleToolEnd(
                String(event.output ?? 'tool-result'),
                runId,
              );
            }
          }
        }
      }

      return `result: ${input}`;
    },
  };
}

// ─── NobulexAuditHandler ────────────────────────────────────────────────────

describe('NobulexAuditHandler', () => {
  let handler: NobulexAuditHandler;

  beforeEach(() => {
    handler = new NobulexAuditHandler('test-agent');
  });

  it('should have correct name', () => {
    expect(handler.name).toBe('NobulexAuditHandler');
  });

  it('should start with zero items', () => {
    expect(handler.itemCount).toBe(0);
    expect(handler.getItems()).toEqual([]);
  });

  it('should record LLM start events', async () => {
    await handler.handleLLMStart({ name: 'gpt-4' }, ['hello'], 'run-1');

    expect(handler.itemCount).toBe(1);
    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('llm_start');
    expect(items[0]!.agentId).toBe('test-agent');
    expect(items[0]!.runId).toBe('run-1');
    expect(items[0]!.outputHash).toBeNull();
  });

  it('should record LLM end events', async () => {
    await handler.handleLLMEnd({ generations: [[{ text: 'hi' }]] }, 'run-1');

    expect(handler.itemCount).toBe(1);
    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('llm_end');
    expect(items[0]!.outputHash).toBeTruthy();
  });

  it('should record LLM error events', async () => {
    await handler.handleLLMError(new Error('rate limit'), 'run-1');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('llm_error');
    expect(items[0]!.outputHash).toBe(sha256String('rate limit'));
  });

  it('should record chain start events', async () => {
    await handler.handleChainStart({ name: 'qa-chain' }, { query: 'test' }, 'run-2', 'parent-1');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('chain_start');
    expect(items[0]!.runId).toBe('run-2');
    expect(items[0]!.parentRunId).toBe('parent-1');
  });

  it('should record chain end events', async () => {
    await handler.handleChainEnd({ result: 'answer' }, 'run-2');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('chain_end');
  });

  it('should record chain error events', async () => {
    await handler.handleChainError(new Error('timeout'), 'run-2');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('chain_error');
  });

  it('should record tool start events', async () => {
    await handler.handleToolStart({ name: 'calculator' }, '2+2', 'run-3');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('tool_start');
  });

  it('should record tool end events', async () => {
    await handler.handleToolEnd('4', 'run-3');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('tool_end');
    expect(items[0]!.outputHash).toBe(sha256String('4'));
  });

  it('should record tool error events', async () => {
    await handler.handleToolError(new Error('not found'), 'run-3');

    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('tool_error');
  });

  it('should accumulate multiple events in order', async () => {
    await handler.handleLLMStart({ name: 'gpt-4' }, ['hi'], 'r1');
    await handler.handleLLMEnd({ generations: [[]] }, 'r1');
    await handler.handleToolStart({ name: 'search' }, 'query', 'r2');
    await handler.handleToolEnd('result', 'r2');

    expect(handler.itemCount).toBe(4);
    const items = handler.getItems();
    expect(items.map((i) => i.actionType)).toEqual([
      'llm_start',
      'llm_end',
      'tool_start',
      'tool_end',
    ]);
  });

  it('should produce unique IDs for each evidence item', async () => {
    await handler.handleLLMStart({ name: 'gpt-4' }, ['a'], 'r1');
    await handler.handleLLMStart({ name: 'gpt-4' }, ['b'], 'r2');

    const items = handler.getItems();
    expect(items[0]!.id).not.toBe(items[1]!.id);
  });

  it('should produce valid self-hashes for each evidence item', async () => {
    await handler.handleLLMStart({ name: 'gpt-4' }, ['test'], 'r1');
    await handler.handleToolEnd('output', 'r2');

    const items = handler.getItems();
    for (const item of items) {
      const expectedHash = sha256Object({
        id: item.id,
        timestamp: item.timestamp,
        agentId: item.agentId,
        actionType: item.actionType,
        inputHash: item.inputHash,
        outputHash: item.outputHash,
        runId: item.runId,
        parentRunId: item.parentRunId,
      });
      expect(item.hash).toBe(expectedHash);
    }
  });

  it('should handle LLM start with no name', async () => {
    await handler.handleLLMStart({}, ['prompt'], 'r1');
    const items = handler.getItems();
    expect(items[0]!.actionType).toBe('llm_start');
    expect(items[0]!.inputHash).toBeTruthy();
  });

  it('should return a copy of items, not the internal array', async () => {
    await handler.handleLLMStart({ name: 'gpt-4' }, ['a'], 'r1');
    const items1 = handler.getItems();
    const items2 = handler.getItems();
    expect(items1).not.toBe(items2);
    expect(items1).toEqual(items2);
  });
});

// ─── Evidence Item Integrity ────────────────────────────────────────────────

describe('evidence item integrity', () => {
  it('should create items with 64-char hex hashes', async () => {
    const handler = new NobulexAuditHandler('agent-1');
    await handler.handleLLMStart({ name: 'model' }, ['prompt'], 'r1');

    const item = handler.getItems()[0]!;
    expect(item.hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(item.hash)).toBe(true);
  });

  it('should produce deterministic hashes for same content', () => {
    const hash1 = sha256Object({ a: 1, b: 2 });
    const hash2 = sha256Object({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different content', async () => {
    const handler = new NobulexAuditHandler('agent-1');
    await handler.handleLLMStart({ name: 'gpt-4' }, ['hello'], 'r1');
    await handler.handleLLMStart({ name: 'gpt-4' }, ['world'], 'r2');

    const items = handler.getItems();
    expect(items[0]!.inputHash).not.toBe(items[1]!.inputHash);
  });

  it('evidence hashes form a verifiable merkle tree', async () => {
    const handler = new NobulexAuditHandler('agent-1');
    await handler.handleLLMStart({ name: 'gpt-4' }, ['a'], 'r1');
    await handler.handleLLMEnd({ generations: [[]] }, 'r1');
    await handler.handleToolStart({ name: 'search' }, 'q', 'r2');
    await handler.handleToolEnd('result', 'r2');

    const items = handler.getItems();
    const hashes = items.map((i) => i.hash);
    const tree = buildMerkleTreeFromHashes(hashes);

    expect(tree.leafCount).toBe(4);

    // Verify each leaf's inclusion proof
    for (let i = 0; i < items.length; i++) {
      const proof = generateInclusionProof(tree, i);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });
});

// ─── NobulexWrapper ─────────────────────────────────────────────────────────

describe('NobulexWrapper', () => {
  it('should invoke the underlying runnable', async () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'eu-ai-act-article-12' });

    const result = await wrapped.invoke('test');
    expect(result).toBe('result: test');
  });

  it('should inject callbacks into invoke options', async () => {
    let receivedCallbacks: unknown[] = [];
    const mock: Runnable<string, string> = {
      async invoke(_input: string, options?: Record<string, unknown>) {
        receivedCallbacks = (options?.callbacks ?? []) as unknown[];
        return 'ok';
      },
    };

    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    await wrapped.invoke('hello');

    expect(receivedCallbacks).toHaveLength(1);
    expect((receivedCallbacks[0] as NobulexAuditHandler).name).toBe('NobulexAuditHandler');
  });

  it('should merge with existing callbacks', async () => {
    let receivedCallbacks: unknown[] = [];
    const existingCallback = { name: 'existing' };
    const mock: Runnable<string, string> = {
      async invoke(_input: string, options?: Record<string, unknown>) {
        receivedCallbacks = (options?.callbacks ?? []) as unknown[];
        return 'ok';
      },
    };

    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    await wrapped.invoke('hello', { callbacks: [existingCallback] });

    expect(receivedCallbacks).toHaveLength(2);
    expect(receivedCallbacks[0]).toBe(existingCallback);
  });

  it('should auto-generate agent ID when not provided', () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    expect(wrapped.agentId).toMatch(/^agent-[0-9a-f]+$/);
  });

  it('should use provided agent ID', () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test', agentId: 'my-agent' });
    expect(wrapped.agentId).toBe('my-agent');
  });

  it('should expose the covenant', () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'eu-ai-act-article-12' });
    expect(wrapped.covenant).toBe('eu-ai-act-article-12');
  });

  it('should expose the handler', () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    expect(wrapped.handler).toBeInstanceOf(NobulexAuditHandler);
  });

  it('should record events from invoke', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'tool', output: 'search result' },
    ]);

    const wrapped = nobulex.wrap(mock, { covenant: 'eu-ai-act-article-12' });
    await wrapped.invoke('test query');

    expect(wrapped.handler.itemCount).toBe(4); // llm_start + llm_end + tool_start + tool_end
  });

  it('should record error events', async () => {
    const mock = createMockRunnable([
      { type: 'llm', error: new Error('API error') },
    ]);

    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    await wrapped.invoke('test');

    const items = wrapped.handler.getItems();
    expect(items).toHaveLength(2);
    expect(items[0]!.actionType).toBe('llm_start');
    expect(items[1]!.actionType).toBe('llm_error');
  });
});

// ─── getAuditLog ────────────────────────────────────────────────────────────

describe('getAuditLog', () => {
  it('should return a complete audit log', async () => {
    const mock = createMockRunnable([{ type: 'llm' }]);
    const wrapped = nobulex.wrap(mock, {
      covenant: 'eu-ai-act-article-12',
      agentId: 'audit-agent',
    });

    await wrapped.invoke('hello');
    const log = await wrapped.getAuditLog();

    expect(log.agentId).toBe('audit-agent');
    expect(log.covenant).toBe('eu-ai-act-article-12');
    expect(log.items).toHaveLength(2);
    expect(log.merkleRoot).toHaveLength(64);
    expect(log.signature).toBeTruthy();
    expect(log.signerPublicKey).toBeTruthy();
    expect(log.startTime).toBeTruthy();
    expect(log.endTime).toBeTruthy();
  });

  it('should handle empty audit log', async () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    const log = await wrapped.getAuditLog();
    expect(log.items).toHaveLength(0);
    expect(log.merkleRoot).toBeTruthy();
    expect(log.signature).toBeTruthy();
  });

  it('should produce a valid merkle root', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'chain' },
      { type: 'tool' },
    ]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const log = await wrapped.getAuditLog();

    // Rebuild the tree and verify
    const hashes = log.items.map((i) => i.hash);
    const tree = buildMerkleTreeFromHashes(hashes);
    expect(log.merkleRoot).toBe(tree.root);
  });

  it('should produce different merkle roots for different runs', async () => {
    const mock1 = createMockRunnable([{ type: 'llm' }]);
    const mock2 = createMockRunnable([{ type: 'tool' }]);

    const w1 = nobulex.wrap(mock1, { covenant: 'test', agentId: 'a1' });
    const w2 = nobulex.wrap(mock2, { covenant: 'test', agentId: 'a2' });

    await w1.invoke('hello');
    await w2.invoke('world');

    const log1 = await w1.getAuditLog();
    const log2 = await w2.getAuditLog();

    expect(log1.merkleRoot).not.toBe(log2.merkleRoot);
  });

  it('should sign the merkle root with Ed25519', async () => {
    const mock = createMockRunnable([{ type: 'llm' }]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const log = await wrapped.getAuditLog();

    // Signature should be 128-char hex (64 bytes Ed25519)
    expect(log.signature).toHaveLength(128);
    expect(/^[0-9a-f]{128}$/.test(log.signature)).toBe(true);
    // Public key should be 64-char hex (32 bytes)
    expect(log.signerPublicKey).toHaveLength(64);
  });
});

// ─── getComplianceReport ────────────────────────────────────────────────────

describe('getComplianceReport', () => {
  it('should generate EU AI Act Article 12 report', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'tool' },
      { type: 'chain' },
    ]);
    const wrapped = nobulex.wrap(mock, {
      covenant: 'eu-ai-act-article-12',
      agentId: 'compliance-agent',
    });

    await wrapped.invoke('test');
    const report = await wrapped.getComplianceReport();

    expect(report.standard).toBe('EU AI Act');
    expect(report.article).toBe('Article 12 - Record-keeping');
    expect(report.agentId).toBe('compliance-agent');
    expect(report.generatedAt).toBeTruthy();
    expect(report.totalActions).toBe(6);
    expect(report.merkleRoot).toHaveLength(64);
    expect(report.signature).toBeTruthy();
    expect(report.signerPublicKey).toBeTruthy();
    expect(report.integrityVerified).toBe(true);
  });

  it('should include action breakdown', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'llm' },
      { type: 'tool' },
    ]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const report = await wrapped.getComplianceReport();

    expect(report.actionBreakdown['llm_start']).toBe(2);
    expect(report.actionBreakdown['llm_end']).toBe(2);
    expect(report.actionBreakdown['tool_start']).toBe(1);
    expect(report.actionBreakdown['tool_end']).toBe(1);
  });

  it('should include compliance findings', async () => {
    const mock = createMockRunnable([{ type: 'llm' }]);
    const wrapped = nobulex.wrap(mock, { covenant: 'eu-ai-act-article-12' });

    await wrapped.invoke('test');
    const report = await wrapped.getComplianceReport();

    expect(report.findings).toHaveLength(4);
    expect(report.findings[0]!.requirement).toContain('Article 12(1)');
    expect(report.findings[0]!.status).toBe('pass');
    expect(report.findings[1]!.requirement).toContain('Article 12(2)');
    expect(report.findings[2]!.requirement).toContain('Article 12(3)');
    expect(report.findings[3]!.requirement).toContain('Article 12(4)');
  });

  it('should embed the full audit log', async () => {
    const mock = createMockRunnable([{ type: 'llm' }]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const report = await wrapped.getComplianceReport();

    expect(report.auditLog).toBeTruthy();
    expect(report.auditLog.items).toHaveLength(2);
    expect(report.auditLog.merkleRoot).toBe(report.merkleRoot);
  });

  it('should handle empty report', async () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    const report = await wrapped.getComplianceReport();
    expect(report.totalActions).toBe(0);
    expect(report.actionBreakdown).toEqual({});
    expect(report.findings).toHaveLength(4);
  });
});

// ─── verifyIntegrity ────────────────────────────────────────────────────────

describe('verifyIntegrity', () => {
  it('should verify a valid audit trail', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'tool' },
      { type: 'chain' },
    ]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const result = await wrapped.verifyIntegrity();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.totalItems).toBe(6);
    expect(result.merkleRoot).toHaveLength(64);
    expect(result.signatureValid).toBe(true);
  });

  it('should verify empty trail', async () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    const result = await wrapped.verifyIntegrity();
    expect(result.valid).toBe(true);
    expect(result.totalItems).toBe(0);
    expect(result.signatureValid).toBe(true);
  });

  it('should verify trail with many items', async () => {
    const events = Array.from({ length: 20 }, () => ({ type: 'llm' as const }));
    const mock = createMockRunnable(events);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const result = await wrapped.verifyIntegrity();

    expect(result.valid).toBe(true);
    expect(result.totalItems).toBe(40); // 20 llm_start + 20 llm_end
  });

  it('should report correct merkle root', async () => {
    const mock = createMockRunnable([{ type: 'llm' }, { type: 'tool' }]);
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });

    await wrapped.invoke('test');
    const result = await wrapped.verifyIntegrity();
    const log = await wrapped.getAuditLog();

    expect(result.merkleRoot).toBe(log.merkleRoot);
  });
});

// ─── nobulex.wrap ───────────────────────────────────────────────────────────

describe('nobulex.wrap', () => {
  it('should return a NobulexWrapper', () => {
    const mock = createMockRunnable();
    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    expect(wrapped).toBeInstanceOf(NobulexWrapper);
  });

  it('should preserve original invoke behavior', async () => {
    const mock: Runnable<string, string> = {
      async invoke(input: string) {
        return `processed: ${input}`;
      },
    };

    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    const result = await wrapped.invoke('hello');
    expect(result).toBe('processed: hello');
  });

  it('should forward options to the underlying runnable', async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const mock: Runnable<string, string> = {
      async invoke(_input: string, options?: Record<string, unknown>) {
        receivedOptions = options;
        return 'ok';
      },
    };

    const wrapped = nobulex.wrap(mock, { covenant: 'test' });
    await wrapped.invoke('hello', { temperature: 0.5 });

    expect(receivedOptions?.temperature).toBe(0.5);
    expect(receivedOptions?.callbacks).toBeTruthy();
  });
});

// ─── nobulex.createHandler ──────────────────────────────────────────────────

describe('nobulex.createHandler', () => {
  it('should create a standalone handler', () => {
    const handler = nobulex.createHandler('my-agent');
    expect(handler).toBeInstanceOf(NobulexAuditHandler);
    expect(handler.name).toBe('NobulexAuditHandler');
  });

  it('should auto-generate agent ID', () => {
    const handler = nobulex.createHandler();
    expect(handler.itemCount).toBe(0);
  });

  it('should work independently for manual callback attachment', async () => {
    const handler = nobulex.createHandler('manual-agent');

    await handler.handleLLMStart({ name: 'gpt-4' }, ['hello'], 'r1');
    await handler.handleLLMEnd({ generations: [[]] }, 'r1');

    expect(handler.itemCount).toBe(2);
    const items = handler.getItems();
    expect(items[0]!.agentId).toBe('manual-agent');
  });
});

// ─── End-to-end flow ────────────────────────────────────────────────────────

describe('end-to-end audit flow', () => {
  it('should complete the full 3-line workflow', async () => {
    // Simulates: import { nobulex } from '@nobulex/langchain'
    const yourAgent = createMockRunnable([
      { type: 'chain' },
      { type: 'llm' },
      { type: 'tool', output: 'search results' },
      { type: 'llm' },
    ]);

    // const agent = nobulex.wrap(yourAgent, { covenant: 'eu-ai-act-article-12' })
    const agent = nobulex.wrap(yourAgent, { covenant: 'eu-ai-act-article-12' });

    // Use the agent
    const result = await agent.invoke('What is the weather?');
    expect(result).toBe('result: What is the weather?');

    // Get audit log
    const log = await agent.getAuditLog();
    expect(log.items.length).toBeGreaterThan(0);
    expect(log.covenant).toBe('eu-ai-act-article-12');

    // Get compliance report
    const report = await agent.getComplianceReport();
    expect(report.standard).toBe('EU AI Act');
    expect(report.integrityVerified).toBe(true);
    expect(report.totalActions).toBe(8); // 4 events × 2 (start + end)

    // Verify integrity
    const integrity = await agent.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.signatureValid).toBe(true);
  });

  it('should handle multiple invocations', async () => {
    const mock = createMockRunnable([{ type: 'llm' }]);
    const agent = nobulex.wrap(mock, { covenant: 'test' });

    await agent.invoke('first');
    await agent.invoke('second');
    await agent.invoke('third');

    const log = await agent.getAuditLog();
    expect(log.items).toHaveLength(6); // 3 invocations × 2 events

    const integrity = await agent.verifyIntegrity();
    expect(integrity.valid).toBe(true);
  });

  it('should handle mixed success and error events', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'tool', error: new Error('tool failed') },
      { type: 'llm' },
    ]);
    const agent = nobulex.wrap(mock, { covenant: 'test' });

    await agent.invoke('test');

    const log = await agent.getAuditLog();
    const types = log.items.map((i) => i.actionType);
    expect(types).toContain('llm_start');
    expect(types).toContain('llm_end');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_error');

    const integrity = await agent.verifyIntegrity();
    expect(integrity.valid).toBe(true);
  });

  it('audit log merkle root matches independently built tree', async () => {
    const mock = createMockRunnable([
      { type: 'llm' },
      { type: 'tool' },
    ]);
    const agent = nobulex.wrap(mock, { covenant: 'test' });
    await agent.invoke('test');

    const log = await agent.getAuditLog();
    const hashes = log.items.map((i) => i.hash);
    const tree = buildMerkleTreeFromHashes(hashes);

    expect(log.merkleRoot).toBe(tree.root);

    // Verify each item's inclusion in the tree
    for (let i = 0; i < log.items.length; i++) {
      const proof = generateInclusionProof(tree, i);
      expect(verifyInclusionProof(proof)).toBe(true);
    }
  });
});
