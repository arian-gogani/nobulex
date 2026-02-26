import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPair } from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';
import type { EvidenceItem } from '@nobulex/evidence-core';
import {
  EvidenceSpanProcessor,
  FilterBuilder,
  SpanFilterChain,
  createAttributeFilter,
  createNameFilter,
  createKindFilter,
  DefaultAttributeExtractor,
  CompositeExtractor,
  BatchProcessor,
  ResilientSpanProcessor,
  ProcessorPipeline,
  MultiExporter,
  ConsoleExporter,
  CallbackExporter,
  ProcessorMetrics,
  MetricsCollector,
  MultiSinkProcessor,
  httpExtractor,
  rpcExtractor,
  dbExtractor,
  createExtractor,
} from './index';
import type {
  ReadableSpan,
  SpanProcessor,
  Exporter,
  EvidenceSink,
  SpanEnricher,
  EnricherFn,
  ErrorRecord,
} from './index';

// ============================================================================
// Helpers
// ============================================================================

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

function makeSpanWithDuration(durationMs: number, overrides?: Partial<ReadableSpan>): ReadableSpan {
  const startMs = Date.now();
  const endMs = startMs + durationMs;
  return makeSpan({
    startTime: [Math.floor(startMs / 1000), (startMs % 1000) * 1_000_000],
    endTime: [Math.floor(endMs / 1000), (endMs % 1000) * 1_000_000],
    ...overrides,
  });
}

let sharedKeyPair: KeyPair;

beforeEach(async () => {
  sharedKeyPair = await generateKeyPair();
});

// ============================================================================
// 1. EvidenceSpanProcessor - Core behavior (preserved from original)
// ============================================================================

describe('EvidenceSpanProcessor', () => {
  it('should generate evidence items from spans', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
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
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    processor.onEnd(makeSpan({
      attributes: { 'rpc.method': 'SearchAPI' },
    }));

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('SearchAPI');
  });

  it('should fall back to span name for tool name', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    processor.onEnd(makeSpan({ attributes: {}, name: 'my-operation' }));

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('my-operation');
  });

  it('should respect filter function', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
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
    const epochs: unknown[] = [];
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      epochConfig: { maxItems: 2 },
      onEpochSealed: (epoch) => epochs.push(epoch),
    });

    processor.onEnd(makeSpan());
    processor.onEnd(makeSpan());
    await processor.forceFlush();

    expect(processor.getAggregator().epochCount).toBeGreaterThanOrEqual(1);
  });

  it('should include parent span ID as parentActionId', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    processor.onEnd(makeSpan({ parentSpanId: 'parent-span-id' }));

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items[0]!.parentActionId).toBe('parent-span-id');
  });

  it('should provide access to chain and aggregator', () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    expect(processor.getChain()).toBeDefined();
    expect(processor.getAggregator()).toBeDefined();
  });

  it('onStart should be a no-op', () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    // Should not throw
    processor.onStart(makeSpan());
  });

  it('shutdown should flush pending items', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    processor.onEnd(makeSpan());
    await processor.shutdown();

    const items = await processor.getEvidenceItems();
    expect(items).toHaveLength(1);
  });
});

// ============================================================================
// 2. FilterBuilder - Span Filtering Rules
// ============================================================================

describe('FilterBuilder', () => {
  it('should pass all spans when no rules are defined', () => {
    const filter = new FilterBuilder().build();
    expect(filter(makeSpan())).toBe(true);
  });

  it('should include spans by exact name', () => {
    const filter = new FilterBuilder()
      .includeByName('test-span')
      .build();
    expect(filter(makeSpan({ name: 'test-span' }))).toBe(true);
    expect(filter(makeSpan({ name: 'other-span' }))).toBe(false);
  });

  it('should include spans by regex name pattern', () => {
    const filter = new FilterBuilder()
      .includeByName(/^test-/)
      .build();
    expect(filter(makeSpan({ name: 'test-span' }))).toBe(true);
    expect(filter(makeSpan({ name: 'test-another' }))).toBe(true);
    expect(filter(makeSpan({ name: 'other-span' }))).toBe(false);
  });

  it('should exclude spans by exact name', () => {
    const filter = new FilterBuilder()
      .excludeByName('health-check')
      .build();
    expect(filter(makeSpan({ name: 'test-span' }))).toBe(true);
    expect(filter(makeSpan({ name: 'health-check' }))).toBe(false);
  });

  it('should exclude spans by regex name pattern', () => {
    const filter = new FilterBuilder()
      .excludeByName(/^internal\./)
      .build();
    expect(filter(makeSpan({ name: 'external.api' }))).toBe(true);
    expect(filter(makeSpan({ name: 'internal.metrics' }))).toBe(false);
  });

  it('should include spans by attribute key/value', () => {
    const filter = new FilterBuilder()
      .includeByAttribute('http.method', 'POST')
      .build();
    expect(filter(makeSpan({ attributes: { 'http.method': 'POST' } }))).toBe(true);
    expect(filter(makeSpan({ attributes: { 'http.method': 'GET' } }))).toBe(false);
    expect(filter(makeSpan({ attributes: {} }))).toBe(false);
  });

  it('should exclude spans by attribute key/value', () => {
    const filter = new FilterBuilder()
      .excludeByAttribute('http.route', '/health')
      .build();
    expect(filter(makeSpan({ attributes: { 'http.route': '/api/data' } }))).toBe(true);
    expect(filter(makeSpan({ attributes: { 'http.route': '/health' } }))).toBe(false);
  });

  it('should filter by minimum duration', () => {
    const filter = new FilterBuilder()
      .minDuration(50)
      .build();
    expect(filter(makeSpanWithDuration(100))).toBe(true);
    expect(filter(makeSpanWithDuration(50))).toBe(true);
    expect(filter(makeSpanWithDuration(10))).toBe(false);
  });

  it('should filter by maximum duration', () => {
    const filter = new FilterBuilder()
      .maxDuration(200)
      .build();
    expect(filter(makeSpanWithDuration(100))).toBe(true);
    expect(filter(makeSpanWithDuration(200))).toBe(true);
    expect(filter(makeSpanWithDuration(300))).toBe(false);
  });

  it('should filter by span kind', () => {
    const filter = new FilterBuilder()
      .includeByKind(1) // SERVER
      .build();
    expect(filter(makeSpan({ kind: 1 }))).toBe(true);
    expect(filter(makeSpan({ kind: 0 }))).toBe(false);
    expect(filter(makeSpan({ kind: 2 }))).toBe(false);
  });

  it('should combine multiple include-by-kind rules (union)', () => {
    const filter = new FilterBuilder()
      .includeByKind(1) // SERVER
      .includeByKind(2) // CLIENT
      .build();
    expect(filter(makeSpan({ kind: 1 }))).toBe(true);
    expect(filter(makeSpan({ kind: 2 }))).toBe(true);
    expect(filter(makeSpan({ kind: 0 }))).toBe(false);
  });

  it('should combine include and exclude rules correctly', () => {
    const filter = new FilterBuilder()
      .includeByName(/^api\./)
      .excludeByName(/\.health$/)
      .build();
    expect(filter(makeSpan({ name: 'api.users' }))).toBe(true);
    expect(filter(makeSpan({ name: 'api.health' }))).toBe(false);
    expect(filter(makeSpan({ name: 'internal.thing' }))).toBe(false);
  });

  it('should combine duration and name filters', () => {
    const filter = new FilterBuilder()
      .includeByName(/^api\./)
      .minDuration(10)
      .maxDuration(500)
      .build();
    expect(filter(makeSpanWithDuration(100, { name: 'api.users' }))).toBe(true);
    expect(filter(makeSpanWithDuration(5, { name: 'api.users' }))).toBe(false);
    expect(filter(makeSpanWithDuration(100, { name: 'internal.thing' }))).toBe(false);
  });

  it('should expose rules via getRules()', () => {
    const builder = new FilterBuilder()
      .includeByName('test')
      .excludeByAttribute('key', 'val')
      .minDuration(10);
    const rules = builder.getRules();
    expect(rules).toHaveLength(3);
    expect(rules[0]!.type).toBe('include-name');
    expect(rules[1]!.type).toBe('exclude-attr');
    expect(rules[2]!.type).toBe('min-duration');
  });

  it('should work with EvidenceSpanProcessor filter config', async () => {
    const filter = new FilterBuilder()
      .excludeByName('ignored')
      .build();

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      filter,
    });

    processor.onEnd(makeSpan({ name: 'kept', attributes: { 'tool.name': 'kept-tool' } }));
    processor.onEnd(makeSpan({ name: 'ignored', attributes: { 'tool.name': 'ignored-tool' } }));
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.toolName).toBe('kept-tool');
  });
});

// ============================================================================
// 3. Custom Attribute Extraction
// ============================================================================

describe('AttributeExtraction', () => {
  it('httpExtractor should detect HTTP spans', () => {
    const span = makeSpan({
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://api.example.com/data',
        'http.status_code': 200,
      },
    });
    expect(httpExtractor.canExtract(span)).toBe(true);
    const extracted = httpExtractor.extract(span);
    expect(extracted.toolName).toBe('POST');
    expect(extracted.actionType).toBe('POST');
    expect(extracted.inputHash).toBeDefined();
    expect(extracted.outputHash).toBeDefined();
  });

  it('httpExtractor should not match non-HTTP spans', () => {
    const span = makeSpan({ attributes: { 'db.system': 'postgresql' } });
    expect(httpExtractor.canExtract(span)).toBe(false);
  });

  it('rpcExtractor should detect RPC spans', () => {
    const span = makeSpan({
      attributes: {
        'rpc.system': 'grpc',
        'rpc.service': 'UserService',
        'rpc.method': 'GetUser',
      },
    });
    expect(rpcExtractor.canExtract(span)).toBe(true);
    const extracted = rpcExtractor.extract(span);
    expect(extracted.toolName).toBe('GetUser');
    expect(extracted.actionType).toBe('grpc');
  });

  it('dbExtractor should detect database spans', () => {
    const span = makeSpan({
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT * FROM users',
      },
    });
    expect(dbExtractor.canExtract(span)).toBe(true);
    const extracted = dbExtractor.extract(span);
    expect(extracted.toolName).toBe('postgresql');
    expect(extracted.actionType).toBe('postgresql');
  });

  it('createExtractor should build custom extractors', () => {
    const customExtractor = createExtractor('custom', {
      toolNameKey: 'custom.tool',
      actionTypeKey: 'custom.action',
      inputKeys: ['custom.input'],
      outputKeys: ['custom.output'],
    });

    const span = makeSpan({
      attributes: {
        'custom.tool': 'my-tool',
        'custom.action': 'my-action',
        'custom.input': 'input-data',
        'custom.output': 'output-data',
      },
    });

    expect(customExtractor.canExtract(span)).toBe(true);
    const extracted = customExtractor.extract(span);
    expect(extracted.toolName).toBe('my-tool');
    expect(extracted.actionType).toBe('my-action');
    expect(extracted.inputHash).toBeDefined();
    expect(extracted.outputHash).toBeDefined();
  });

  it('createExtractor with predicate should use custom detection', () => {
    const extractor = createExtractor('predicate-test', {
      toolNameKey: 'my.tool',
      predicate: (span) => span.name.startsWith('custom-'),
    });

    expect(extractor.canExtract(makeSpan({ name: 'custom-op' }))).toBe(true);
    expect(extractor.canExtract(makeSpan({ name: 'other-op' }))).toBe(false);
  });

  it('should use extractors in EvidenceSpanProcessor', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      extractors: [httpExtractor, rpcExtractor, dbExtractor],
    });

    processor.onEnd(makeSpan({
      attributes: {
        'http.method': 'GET',
        'http.url': 'https://example.com',
        'http.status_code': 200,
      },
    }));

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('GET');
    expect(items[0]!.actionType).toBe('GET');
  });

  it('should fall through extractors to defaults when none match', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      extractors: [httpExtractor],
    });

    processor.onEnd(makeSpan({
      attributes: { 'tool.name': 'file_read' },
      name: 'read-op',
    }));

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('file_read');
  });
});

// ============================================================================
// 4. Batch Processing
// ============================================================================

describe('BatchProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should buffer spans until batch size is reached', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 3, 0); // disable timer

    batch.onEnd(makeSpan({ name: 'span-1' }));
    batch.onEnd(makeSpan({ name: 'span-2' }));
    expect(batch.pendingCount).toBe(2);

    // Adding the 3rd span should trigger a flush
    batch.onEnd(makeSpan({ name: 'span-3' }));
    // Wait for async flush
    await batch.forceFlush();

    const items = await inner.getEvidenceItems();
    expect(items.length).toBe(3);
    await batch.shutdown();
  });

  it('should allow changing batch size', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 10, 0);
    expect(batch.getBatchSize()).toBe(10);

    batch.setBatchSize(2);
    expect(batch.getBatchSize()).toBe(2);

    batch.onEnd(makeSpan());
    batch.onEnd(makeSpan());
    await batch.forceFlush();

    const items = await inner.getEvidenceItems();
    expect(items.length).toBe(2);
    await batch.shutdown();
  });

  it('should allow changing flush interval', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 100, 10000);
    expect(batch.getFlushInterval()).toBe(10000);

    batch.setFlushInterval(500);
    expect(batch.getFlushInterval()).toBe(500);

    await batch.shutdown();
  });

  it('should flush all buffered spans on forceFlush', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 100, 0); // large batch, no timer

    for (let i = 0; i < 5; i++) {
      batch.onEnd(makeSpan({ name: `span-${i}` }));
    }
    expect(batch.pendingCount).toBe(5);

    await batch.forceFlush();

    const items = await inner.getEvidenceItems();
    expect(items.length).toBe(5);
    expect(batch.pendingCount).toBe(0);
    await batch.shutdown();
  });

  it('should flush on shutdown', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 100, 0);

    batch.onEnd(makeSpan());
    batch.onEnd(makeSpan());

    await batch.shutdown();

    const items = await inner.getEvidenceItems();
    expect(items.length).toBe(2);
  });

  it('should not accept spans after shutdown', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 100, 0);
    await batch.shutdown();

    batch.onEnd(makeSpan());
    expect(batch.pendingCount).toBe(0);
  });

  it('should expose the inner processor', () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    const batch = new BatchProcessor(inner, 10, 0);
    expect(batch.getInner()).toBe(inner);
    batch.shutdown();
  });
});

// ============================================================================
// 5. Error Handling and Retry
// ============================================================================

describe('ErrorHandling', () => {
  it('should record errors and invoke onError callback', async () => {
    const errors: ErrorRecord[] = [];
    // Create a processor with a key pair that will be intercepted
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      retryPolicy: { maxRetries: 0, backoffMs: 1, maxBackoffMs: 1 },
      onError: (record) => errors.push(record),
    });

    // Sabotage the chain's append method to simulate failure
    const chain = processor.getChain();
    const origAppend = chain.append.bind(chain);
    let callCount = 0;
    chain.append = async (input) => {
      callCount++;
      if (callCount <= 1) {
        throw new Error('Simulated failure');
      }
      return origAppend(input);
    };

    processor.onEnd(makeSpan({ name: 'failing-span' }));
    await processor.forceFlush();

    // With maxRetries=0, there is no retry, so the first span fails
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toBe('Simulated failure');
    expect(errors[0]!.retryCount).toBe(0);
  });

  it('should retry failed operations up to maxRetries', async () => {
    const errors: ErrorRecord[] = [];
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      retryPolicy: { maxRetries: 2, backoffMs: 1, maxBackoffMs: 10 },
      onError: (record) => errors.push(record),
    });

    const chain = processor.getChain();
    const origAppend = chain.append.bind(chain);
    let callCount = 0;
    chain.append = async (input) => {
      callCount++;
      if (callCount <= 2) {
        throw new Error('Transient failure');
      }
      return origAppend(input);
    };

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    // Should succeed on the 3rd attempt (after 2 retries)
    expect(errors).toHaveLength(0);
    expect(callCount).toBe(3);
    const items = await processor.getEvidenceItems();
    expect(items.length).toBe(1);
  });

  it('should exhaust retries and record the error', async () => {
    const errors: ErrorRecord[] = [];
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      retryPolicy: { maxRetries: 2, backoffMs: 1, maxBackoffMs: 5 },
      onError: (record) => errors.push(record),
    });

    const chain = processor.getChain();
    chain.append = async () => {
      throw new Error('Permanent failure');
    };

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toBe('Permanent failure');
  });

  it('should expose error records via getErrorRecords()', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      retryPolicy: { maxRetries: 0, backoffMs: 1, maxBackoffMs: 1 },
    });

    const chain = processor.getChain();
    chain.append = async () => {
      throw new Error('Test error');
    };

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    const records = processor.getErrorRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.error.message).toBe('Test error');
  });
});

// ============================================================================
// 6. Metrics Collection
// ============================================================================

describe('ProcessorMetrics', () => {
  it('should start with all zeros', () => {
    const metrics = new ProcessorMetrics();
    const snap = metrics.getMetrics();
    expect(snap.evidenceItemsCreated).toBe(0);
    expect(snap.evidenceItemsFailed).toBe(0);
    expect(snap.averageProcessingTimeMs).toBe(0);
    expect(snap.chainLength).toBe(0);
    expect(snap.epochsSealed).toBe(0);
    expect(snap.totalSpansReceived).toBe(0);
    expect(snap.totalSpansFiltered).toBe(0);
  });

  it('should record created items and compute average', () => {
    const metrics = new ProcessorMetrics();
    metrics.recordCreated(10);
    metrics.recordCreated(20);
    metrics.recordCreated(30);

    const snap = metrics.getMetrics();
    expect(snap.evidenceItemsCreated).toBe(3);
    expect(snap.averageProcessingTimeMs).toBe(20); // (10+20+30)/3
    expect(snap.chainLength).toBe(3);
  });

  it('should record failures', () => {
    const metrics = new ProcessorMetrics();
    metrics.recordFailed();
    metrics.recordFailed();
    expect(metrics.getMetrics().evidenceItemsFailed).toBe(2);
  });

  it('should record spans received and filtered', () => {
    const metrics = new ProcessorMetrics();
    metrics.recordSpanReceived();
    metrics.recordSpanReceived();
    metrics.recordSpanReceived();
    metrics.recordSpanFiltered();

    const snap = metrics.getMetrics();
    expect(snap.totalSpansReceived).toBe(3);
    expect(snap.totalSpansFiltered).toBe(1);
  });

  it('should record epochs sealed', () => {
    const metrics = new ProcessorMetrics();
    metrics.recordEpochSealed();
    expect(metrics.getMetrics().epochsSealed).toBe(1);
  });

  it('should reset all metrics', () => {
    const metrics = new ProcessorMetrics();
    metrics.recordCreated(50);
    metrics.recordFailed();
    metrics.recordSpanReceived();
    metrics.recordSpanFiltered();
    metrics.recordEpochSealed();

    metrics.resetMetrics();

    const snap = metrics.getMetrics();
    expect(snap.evidenceItemsCreated).toBe(0);
    expect(snap.evidenceItemsFailed).toBe(0);
    expect(snap.averageProcessingTimeMs).toBe(0);
    expect(snap.chainLength).toBe(0);
    expect(snap.epochsSealed).toBe(0);
    expect(snap.totalSpansReceived).toBe(0);
    expect(snap.totalSpansFiltered).toBe(0);
  });

  it('should track metrics in EvidenceSpanProcessor', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      filter: (span) => span.name !== 'filtered',
    });

    processor.onEnd(makeSpan({ name: 'kept-1' }));
    processor.onEnd(makeSpan({ name: 'filtered' }));
    processor.onEnd(makeSpan({ name: 'kept-2' }));

    await processor.forceFlush();

    const snap = processor.getMetricsSnapshot();
    expect(snap.totalSpansReceived).toBe(3);
    expect(snap.totalSpansFiltered).toBe(1);
    expect(snap.evidenceItemsCreated).toBe(2);
  });

  it('should reset metrics in EvidenceSpanProcessor', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    expect(processor.getMetricsSnapshot().evidenceItemsCreated).toBe(1);

    processor.resetMetrics();
    expect(processor.getMetricsSnapshot().evidenceItemsCreated).toBe(0);
  });
});

// ============================================================================
// 7. Multiple Exporter Support
// ============================================================================

describe('Exporters', () => {
  it('ConsoleExporter should log items', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exporter = new ConsoleExporter('[test]');

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      exporter,
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toContain('[test]');
    logSpy.mockRestore();
  });

  it('CallbackExporter should invoke callback with items', async () => {
    const received: EvidenceItem[][] = [];
    const exporter = new CallbackExporter((items) => {
      received.push([...items]);
    });

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      exporter,
    });

    processor.onEnd(makeSpan());
    processor.onEnd(makeSpan());
    await processor.forceFlush();

    // Each span triggers its own export call
    expect(received.length).toBe(2);
    expect(received[0]!).toHaveLength(1);
    expect(received[1]!).toHaveLength(1);
  });

  it('MultiExporter should send to multiple exporters', async () => {
    const received1: EvidenceItem[][] = [];
    const received2: EvidenceItem[][] = [];

    const exporter1 = new CallbackExporter((items) => {
      received1.push([...items]);
    });
    const exporter2 = new CallbackExporter((items) => {
      received2.push([...items]);
    });

    const multi = new MultiExporter([exporter1, exporter2]);

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      exporter: multi,
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    expect(received1.length).toBe(1);
    expect(received2.length).toBe(1);
  });

  it('MultiExporter should continue if one exporter fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const received: EvidenceItem[][] = [];

    const failingExporter: Exporter = {
      async export() { throw new Error('Exporter boom'); },
      async shutdown() {},
    };

    const workingExporter = new CallbackExporter((items) => {
      received.push([...items]);
    });

    const multi = new MultiExporter([failingExporter, workingExporter]);

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      exporter: multi,
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    // The working exporter should still receive items
    expect(received.length).toBe(1);
    errorSpy.mockRestore();
  });

  it('MultiExporter should add and remove exporters', () => {
    const multi = new MultiExporter();
    const exp1 = new ConsoleExporter();
    const exp2 = new ConsoleExporter();

    multi.addExporter(exp1);
    multi.addExporter(exp2);
    expect(multi.exporterCount).toBe(2);

    expect(multi.removeExporter(exp1)).toBe(true);
    expect(multi.exporterCount).toBe(1);

    expect(multi.removeExporter(exp1)).toBe(false); // already removed
    expect(multi.exporterCount).toBe(1);
  });

  it('MultiExporter shutdown should propagate to all', async () => {
    let shutdowns = 0;
    const exp: Exporter = {
      async export() {},
      async shutdown() { shutdowns++; },
    };

    const multi = new MultiExporter([exp, exp]);
    await multi.shutdown();
    expect(shutdowns).toBe(2);
  });
});

// ============================================================================
// 8. Processor Pipeline
// ============================================================================

describe('ProcessorPipeline', () => {
  it('should forward spans to all processors', async () => {
    const p1 = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });
    const kp2 = await generateKeyPair();
    const p2 = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent2',
      keyPair: kp2,
    });

    const pipeline = new ProcessorPipeline();
    pipeline.addProcessor(p1);
    pipeline.addProcessor(p2);

    pipeline.onEnd(makeSpan());
    await pipeline.forceFlush();

    const items1 = await p1.getEvidenceItems();
    const items2 = await p2.getEvidenceItems();
    expect(items1).toHaveLength(1);
    expect(items2).toHaveLength(1);
  });

  it('should support onStart propagation', () => {
    const startCalls: string[] = [];

    const mockProcessor: SpanProcessor = {
      onStart: (span: ReadableSpan) => startCalls.push(span.name),
      onEnd: () => {},
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    const pipeline = new ProcessorPipeline();
    pipeline.addProcessor(mockProcessor);

    pipeline.onStart(makeSpan({ name: 'start-test' }));
    expect(startCalls).toEqual(['start-test']);
  });

  it('should flush all processors', async () => {
    const flushCalls: number[] = [];
    let id = 0;

    const makeMockProcessor = () => {
      const myId = ++id;
      return {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: async () => { flushCalls.push(myId); },
        shutdown: async () => {},
      };
    };

    const pipeline = new ProcessorPipeline();
    pipeline.addProcessor(makeMockProcessor());
    pipeline.addProcessor(makeMockProcessor());
    pipeline.addProcessor(makeMockProcessor());

    await pipeline.forceFlush();
    expect(flushCalls).toEqual([1, 2, 3]);
  });

  it('should shutdown all processors', async () => {
    const shutdownCalls: number[] = [];
    let id = 0;

    const makeMockProcessor = () => {
      const myId = ++id;
      return {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: async () => {},
        shutdown: async () => { shutdownCalls.push(myId); },
      };
    };

    const pipeline = new ProcessorPipeline();
    pipeline.addProcessor(makeMockProcessor());
    pipeline.addProcessor(makeMockProcessor());

    await pipeline.shutdown();
    expect(shutdownCalls).toEqual([1, 2]);
  });

  it('should add and remove processors', () => {
    const pipeline = new ProcessorPipeline();
    const p1 = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
    });

    pipeline.addProcessor(p1);
    expect(pipeline.processorCount).toBe(1);

    expect(pipeline.removeProcessor(p1)).toBe(true);
    expect(pipeline.processorCount).toBe(0);

    expect(pipeline.removeProcessor(p1)).toBe(false);
  });

  it('should support chaining addProcessor calls', () => {
    const p1 = new EvidenceSpanProcessor({ agentDid: 'did:nobulex:a', keyPair: sharedKeyPair });
    const p2 = new EvidenceSpanProcessor({ agentDid: 'did:nobulex:b', keyPair: sharedKeyPair });

    const pipeline = new ProcessorPipeline()
      .addProcessor(p1)
      .addProcessor(p2);

    expect(pipeline.processorCount).toBe(2);
  });
});

// ============================================================================
// 9. Span Enrichment
// ============================================================================

describe('SpanEnrichment', () => {
  it('should enrich evidence input with environment tags', async () => {
    const enricher: EnricherFn = (input) => ({
      ...input,
      actionType: `${input.actionType}:production`,
    });

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      enrichers: [enricher],
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items[0]!.actionType).toBe('tool_call:production');
  });

  it('should support SpanEnricher interface objects', async () => {
    const enricher: SpanEnricher = {
      name: 'session-enricher',
      enrich(input, _span) {
        return {
          ...input,
          toolName: `session:${input.toolName}`,
        };
      },
    };

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      enrichers: [enricher],
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('session:web_search');
  });

  it('should chain multiple enrichers in order', async () => {
    const enricher1: EnricherFn = (input) => ({
      ...input,
      modelVersion: `${input.modelVersion}+v1`,
    });
    const enricher2: EnricherFn = (input) => ({
      ...input,
      modelVersion: `${input.modelVersion}+v2`,
    });

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      modelVersion: 'base',
      enrichers: [enricher1, enricher2],
    });

    processor.onEnd(makeSpan());
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items[0]!.modelVersion).toBe('base+v1+v2');
  });

  it('enricher should have access to the original span', async () => {
    const enricher: EnricherFn = (input, span) => ({
      ...input,
      toolName: `${input.toolName}:kind-${span.kind}`,
    });

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      enrichers: [enricher],
    });

    processor.onEnd(makeSpan({ kind: 3 }));
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items[0]!.toolName).toBe('web_search:kind-3');
  });
});

// ============================================================================
// 10. Integration tests
// ============================================================================

describe('Integration', () => {
  it('full pipeline: filter + extract + enrich + batch + export + metrics', async () => {
    const exported: EvidenceItem[] = [];
    const exporter = new CallbackExporter((items) => {
      exported.push(...items);
    });

    const filter = new FilterBuilder()
      .excludeByName('health-check')
      .minDuration(1)
      .build();

    const enricher: EnricherFn = (input) => ({
      ...input,
      modelVersion: 'integration-test-v1',
    });

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:agent1',
      keyPair: sharedKeyPair,
      filter,
      extractors: [httpExtractor],
      enrichers: [enricher],
      exporter,
    });

    const batch = new BatchProcessor(processor, 2, 0);

    // Send 3 spans, 1 filtered out
    batch.onEnd(makeSpanWithDuration(50, {
      name: 'api-call',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://example.com/api',
        'http.status_code': 201,
      },
    }));
    batch.onEnd(makeSpanWithDuration(50, { name: 'health-check' }));
    batch.onEnd(makeSpanWithDuration(50, {
      name: 'db-query',
      attributes: { 'tool.name': 'query' },
    }));

    await batch.forceFlush();

    // 2 spans pass the filter (health-check excluded)
    expect(exported.length).toBe(2);
    expect(exported[0]!.modelVersion).toBe('integration-test-v1');

    const snap = processor.getMetricsSnapshot();
    expect(snap.totalSpansReceived).toBe(3);
    expect(snap.totalSpansFiltered).toBe(1);
    expect(snap.evidenceItemsCreated).toBe(2);

    await batch.shutdown();
  });

  it('pipeline with multiple processors sharing the same spans', async () => {
    const kp2 = await generateKeyPair();
    const p1 = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:auditor',
      keyPair: sharedKeyPair,
    });
    const p2 = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:monitor',
      keyPair: kp2,
    });

    const pipeline = new ProcessorPipeline()
      .addProcessor(p1)
      .addProcessor(p2);

    for (let i = 0; i < 3; i++) {
      pipeline.onEnd(makeSpan({ name: `action-${i}` }));
    }
    await pipeline.forceFlush();

    const items1 = await p1.getEvidenceItems();
    const items2 = await p2.getEvidenceItems();

    expect(items1).toHaveLength(3);
    expect(items2).toHaveLength(3);

    // Each processor has its own chain
    expect(items1[0]!.agentDid).toBe('did:nobulex:auditor');
    expect(items2[0]!.agentDid).toBe('did:nobulex:monitor');

    // Hash chains are independent
    expect(items1[0]!.hash).not.toBe(items2[0]!.hash);
  });

  it('evidence chain integrity is maintained across many spans', async () => {
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:chain-test',
      keyPair: sharedKeyPair,
    });

    for (let i = 0; i < 10; i++) {
      processor.onEnd(makeSpan({ name: `span-${i}` }));
    }
    await processor.forceFlush();

    const items = await processor.getEvidenceItems();
    expect(items).toHaveLength(10);

    // Verify chain linkage
    expect(items[0]!.previousHash).toBeNull();
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.previousHash).toBe(items[i - 1]!.hash);
    }
  });

  it('epoch sealing fires callback and updates metrics', async () => {
    const sealedEpochs: unknown[] = [];
    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:epoch-test',
      keyPair: sharedKeyPair,
      epochConfig: { maxItems: 3 },
      onEpochSealed: (epoch) => sealedEpochs.push(epoch),
    });

    for (let i = 0; i < 7; i++) {
      processor.onEnd(makeSpan({ name: `span-${i}` }));
    }
    await processor.forceFlush();

    // 7 items, maxItems=3 => epochs sealed at 3, 6, plus forceFlush seals remainder (1)
    const snap = processor.getMetricsSnapshot();
    expect(snap.epochsSealed).toBeGreaterThanOrEqual(2);
    expect(sealedEpochs.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// 11. Convenience filter functions
// ============================================================================

describe('createAttributeFilter', () => {
  it('should match spans with matching attribute value', () => {
    const filter = createAttributeFilter('http.method', 'GET');
    expect(filter(makeSpan({ attributes: { 'http.method': 'GET' } }))).toBe(true);
    expect(filter(makeSpan({ attributes: { 'http.method': 'POST' } }))).toBe(false);
    expect(filter(makeSpan({ attributes: {} }))).toBe(false);
  });

  it('should match boolean attribute values', () => {
    const filter = createAttributeFilter('debug', true);
    expect(filter(makeSpan({ attributes: { debug: true } }))).toBe(true);
    expect(filter(makeSpan({ attributes: { debug: false } }))).toBe(false);
  });
});

describe('createNameFilter', () => {
  it('should match by exact name string', () => {
    const filter = createNameFilter('api.call');
    expect(filter(makeSpan({ name: 'api.call' }))).toBe(true);
    expect(filter(makeSpan({ name: 'api.calls' }))).toBe(false);
  });

  it('should match by regex pattern', () => {
    const filter = createNameFilter(/^db\./);
    expect(filter(makeSpan({ name: 'db.query' }))).toBe(true);
    expect(filter(makeSpan({ name: 'api.call' }))).toBe(false);
  });
});

describe('createKindFilter', () => {
  it('should match single kind', () => {
    const filter = createKindFilter(2);
    expect(filter(makeSpan({ kind: 2 }))).toBe(true);
    expect(filter(makeSpan({ kind: 0 }))).toBe(false);
  });

  it('should match array of kinds', () => {
    const filter = createKindFilter([0, 1, 2]);
    expect(filter(makeSpan({ kind: 0 }))).toBe(true);
    expect(filter(makeSpan({ kind: 1 }))).toBe(true);
    expect(filter(makeSpan({ kind: 2 }))).toBe(true);
    expect(filter(makeSpan({ kind: 5 }))).toBe(false);
  });
});

// ============================================================================
// 12. SpanFilterChain
// ============================================================================

describe('SpanFilterChain', () => {
  it('should compose filters with AND logic', () => {
    const chain = new SpanFilterChain([
      createNameFilter(/^api\./),
      createKindFilter(1),
    ], 'and');

    expect(chain.evaluate(makeSpan({ name: 'api.search', kind: 1 }))).toBe(true);
    expect(chain.evaluate(makeSpan({ name: 'api.search', kind: 0 }))).toBe(false);
    expect(chain.evaluate(makeSpan({ name: 'db.query', kind: 1 }))).toBe(false);
  });

  it('should compose filters with OR logic', () => {
    const chain = new SpanFilterChain([
      createNameFilter('api.search'),
      createNameFilter('db.query'),
    ], 'or');

    expect(chain.evaluate(makeSpan({ name: 'api.search' }))).toBe(true);
    expect(chain.evaluate(makeSpan({ name: 'db.query' }))).toBe(true);
    expect(chain.evaluate(makeSpan({ name: 'unknown' }))).toBe(false);
  });

  it('should pass all spans when chain is empty', () => {
    const chain = new SpanFilterChain([], 'and');
    expect(chain.evaluate(makeSpan())).toBe(true);
  });

  it('should allow adding filters and report length', () => {
    const chain = new SpanFilterChain([]);
    expect(chain.length).toBe(0);
    chain.add(createNameFilter('test'));
    expect(chain.length).toBe(1);
  });

  it('should convert to a single SpanFilterFn via toFilter()', () => {
    const chain = new SpanFilterChain([
      createNameFilter('allowed'),
    ], 'and');

    const fn = chain.toFilter();
    expect(fn(makeSpan({ name: 'allowed' }))).toBe(true);
    expect(fn(makeSpan({ name: 'blocked' }))).toBe(false);
  });

  it('should work as EvidenceSpanProcessor filter', async () => {
    const chain = new SpanFilterChain([
      createNameFilter(/^tool\./),
      createKindFilter([0, 1]),
    ], 'and');

    const processor = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:chain-filter',
      keyPair: sharedKeyPair,
      filter: chain.toFilter(),
    });

    processor.onEnd(makeSpan({ name: 'tool.search', kind: 0 }));
    processor.onEnd(makeSpan({ name: 'tool.compute', kind: 1 }));
    processor.onEnd(makeSpan({ name: 'tool.debug', kind: 5 })); // kind 5 not in [0,1]
    processor.onEnd(makeSpan({ name: 'other.thing', kind: 0 })); // name doesn't match

    await processor.forceFlush();
    const items = await processor.getEvidenceItems();
    expect(items).toHaveLength(2);
  });
});

// ============================================================================
// 13. DefaultAttributeExtractor and CompositeExtractor
// ============================================================================

describe('DefaultAttributeExtractor', () => {
  it('should always report canExtract as true', () => {
    const ext = new DefaultAttributeExtractor();
    expect(ext.canExtract(makeSpan())).toBe(true);
    expect(ext.canExtract(makeSpan({ attributes: {} }))).toBe(true);
    expect(ext.name).toBe('default');
  });

  it('should extract tool name from tool.name attribute', () => {
    const ext = new DefaultAttributeExtractor();
    const result = ext.extract(makeSpan({
      attributes: { 'tool.name': 'calculator' },
    }));
    expect(result.toolName).toBe('calculator');
  });

  it('should fall back to span name when no known attribute exists', () => {
    const ext = new DefaultAttributeExtractor();
    const result = ext.extract(makeSpan({ attributes: {}, name: 'fallback-op' }));
    expect(result.toolName).toBe('fallback-op');
  });

  it('should extract action type from nobulex.action_type', () => {
    const ext = new DefaultAttributeExtractor();
    const result = ext.extract(makeSpan({
      attributes: { 'nobulex.action_type': 'delegation' },
    }));
    expect(result.actionType).toBe('delegation');
  });

  it('should produce input and output hashes', () => {
    const ext = new DefaultAttributeExtractor();
    const result = ext.extract(makeSpan());
    expect(result.inputHash).toBeDefined();
    expect(typeof result.inputHash).toBe('string');
    expect(result.outputHash).toBeDefined();
    expect(typeof result.outputHash).toBe('string');
  });
});

describe('CompositeExtractor', () => {
  it('should try extractors in order and use first match', () => {
    const composite = new CompositeExtractor([httpExtractor, rpcExtractor]);

    const httpSpan = makeSpan({ attributes: { 'http.method': 'GET', 'http.url': '/api' } });
    const result = composite.extract(httpSpan);
    expect(result.toolName).toBe('GET');
    expect(result.actionType).toBe('GET');
  });

  it('should fall back to default when no extractor matches', () => {
    const composite = new CompositeExtractor([httpExtractor]);
    const plainSpan = makeSpan({ attributes: {}, name: 'plain-op' });
    const result = composite.extract(plainSpan);
    expect(result.toolName).toBe('plain-op');
  });

  it('should always report canExtract as true', () => {
    const composite = new CompositeExtractor([]);
    expect(composite.canExtract(makeSpan())).toBe(true);
    expect(composite.name).toBe('composite');
  });

  it('should report extractor count', () => {
    const composite = new CompositeExtractor([httpExtractor, rpcExtractor, dbExtractor]);
    expect(composite.extractorCount).toBe(3);
  });

  it('should allow adding extractors dynamically', () => {
    const composite = new CompositeExtractor([]);
    expect(composite.extractorCount).toBe(0);
    composite.addExtractor(httpExtractor);
    expect(composite.extractorCount).toBe(1);
  });

  it('should use dynamically added extractor', () => {
    const composite = new CompositeExtractor([]);
    composite.addExtractor(rpcExtractor);

    const rpcSpan = makeSpan({ attributes: { 'rpc.system': 'grpc', 'rpc.method': 'Call' } });
    const result = composite.extract(rpcSpan);
    expect(result.toolName).toBe('Call');
    expect(result.actionType).toBe('grpc');
  });
});

// ============================================================================
// 14. MetricsCollector
// ============================================================================

describe('MetricsCollector', () => {
  it('should record created events with processing time', () => {
    const collector = new MetricsCollector();
    collector.record('created', 25);
    collector.record('created', 35);

    const snap = collector.getMetrics();
    expect(snap.evidenceItemsCreated).toBe(2);
    expect(snap.averageProcessingTimeMs).toBe(30);
  });

  it('should record received and filtered events', () => {
    const collector = new MetricsCollector();
    collector.record('received');
    collector.record('received');
    collector.record('filtered');

    const snap = collector.getMetrics();
    expect(snap.totalSpansReceived).toBe(2);
    expect(snap.totalSpansFiltered).toBe(1);
  });

  it('should record failed events', () => {
    const collector = new MetricsCollector();
    collector.record('failed');
    collector.record('failed');
    expect(collector.getMetrics().evidenceItemsFailed).toBe(2);
  });

  it('should record epochSealed events', () => {
    const collector = new MetricsCollector();
    collector.record('epochSealed');
    expect(collector.getMetrics().epochsSealed).toBe(1);
  });

  it('should reset all metrics', () => {
    const collector = new MetricsCollector();
    collector.record('created', 10);
    collector.record('received');
    collector.record('failed');
    collector.record('filtered');
    collector.record('epochSealed');

    collector.reset();

    const snap = collector.getMetrics();
    expect(snap.evidenceItemsCreated).toBe(0);
    expect(snap.totalSpansReceived).toBe(0);
    expect(snap.evidenceItemsFailed).toBe(0);
    expect(snap.totalSpansFiltered).toBe(0);
    expect(snap.epochsSealed).toBe(0);
  });
});

// ============================================================================
// 15. ResilientSpanProcessor
// ============================================================================

describe('ResilientSpanProcessor', () => {
  it('should pass spans to inner processor on success', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:resilient',
      keyPair: sharedKeyPair,
    });
    const resilient = new ResilientSpanProcessor(inner);

    resilient.onEnd(makeSpan({ name: 'ok-span' }));
    await resilient.forceFlush();

    const items = await inner.getEvidenceItems();
    expect(items).toHaveLength(1);
  });

  it('should record errors when inner throws synchronously', async () => {
    const errorRecords: ErrorRecord[] = [];
    const failing: SpanProcessor = {
      onStart: () => {},
      onEnd: () => { throw new Error('sync-boom'); },
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    const resilient = new ResilientSpanProcessor(
      failing,
      { maxRetries: 0, backoffMs: 1, maxBackoffMs: 1 },
      (record) => errorRecords.push(record),
    );

    resilient.onEnd(makeSpan());
    await resilient.forceFlush();

    expect(resilient.getErrorRecords()).toHaveLength(1);
    expect(errorRecords).toHaveLength(1);
    expect(errorRecords[0]!.error.message).toBe('sync-boom');
  });

  it('should respect shouldRetry predicate', async () => {
    let attempts = 0;
    const failing: SpanProcessor = {
      onStart: () => {},
      onEnd: () => { attempts++; throw new Error('fatal'); },
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    const resilient = new ResilientSpanProcessor(
      failing,
      {
        maxRetries: 5,
        backoffMs: 1,
        maxBackoffMs: 1,
        shouldRetry: () => false, // never retry
      },
    );

    resilient.onEnd(makeSpan());
    await resilient.forceFlush();

    expect(attempts).toBe(1);
    expect(resilient.getErrorRecords()).toHaveLength(1);
  });

  it('should delegate forceFlush and shutdown', async () => {
    let flushed = false;
    let shutDown = false;
    const inner: SpanProcessor = {
      onStart: () => {},
      onEnd: () => {},
      forceFlush: async () => { flushed = true; },
      shutdown: async () => { shutDown = true; },
    };

    const resilient = new ResilientSpanProcessor(inner);
    await resilient.forceFlush();
    expect(flushed).toBe(true);

    await resilient.shutdown();
    expect(shutDown).toBe(true);
  });

  it('should delegate onStart to inner', () => {
    const started: string[] = [];
    const inner: SpanProcessor = {
      onStart: (span) => { started.push(span.name); },
      onEnd: () => {},
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    const resilient = new ResilientSpanProcessor(inner);
    resilient.onStart(makeSpan({ name: 'start-test' }));
    expect(started).toEqual(['start-test']);
  });
});

// ============================================================================
// 16. MultiSinkProcessor / EvidenceSink
// ============================================================================

describe('MultiSinkProcessor', () => {
  it('should notify sinks of evidence items via exporter wrapping', async () => {
    const evidenceItems: EvidenceItem[] = [];
    const sink: EvidenceSink = {
      onEvidence: (item) => { evidenceItems.push(item); },
      onEpochSealed: () => {},
    };

    const proc = new MultiSinkProcessor(
      { agentDid: 'did:nobulex:sink-agent', keyPair: sharedKeyPair },
      [sink],
    );

    expect(proc.sinkCount).toBe(1);

    proc.onEnd(makeSpan({ name: 'sink-span' }));
    await proc.forceFlush();

    expect(evidenceItems).toHaveLength(1);
    expect(evidenceItems[0]!.agentDid).toBe('did:nobulex:sink-agent');
    await proc.shutdown();
  });

  it('should notify sinks of epoch-sealed events', async () => {
    const epochs: unknown[] = [];
    const sink: EvidenceSink = {
      onEvidence: () => {},
      onEpochSealed: (epoch) => { epochs.push(epoch); },
    };

    const proc = new MultiSinkProcessor(
      {
        agentDid: 'did:nobulex:sink-epoch',
        keyPair: sharedKeyPair,
        epochConfig: { maxItems: 2 },
      },
      [sink],
    );

    proc.onEnd(makeSpan());
    proc.onEnd(makeSpan());
    await proc.forceFlush();

    // At least one epoch should have been sealed and notified
    expect(epochs.length).toBeGreaterThanOrEqual(1);
    await proc.shutdown();
  });

  it('should add and remove sinks', async () => {
    const proc = new MultiSinkProcessor({
      agentDid: 'did:nobulex:sink-mgmt',
      keyPair: sharedKeyPair,
    });

    const sink: EvidenceSink = {
      onEvidence: () => {},
      onEpochSealed: () => {},
    };

    expect(proc.sinkCount).toBe(0);
    proc.addSink(sink);
    expect(proc.sinkCount).toBe(1);
    expect(proc.removeSink(sink)).toBe(true);
    expect(proc.sinkCount).toBe(0);
    expect(proc.removeSink(sink)).toBe(false);
    await proc.shutdown();
  });

  it('should expose the inner EvidenceSpanProcessor', async () => {
    const proc = new MultiSinkProcessor({
      agentDid: 'did:nobulex:sink-inner',
      keyPair: sharedKeyPair,
    });

    expect(proc.getInner()).toBeInstanceOf(EvidenceSpanProcessor);
    await proc.shutdown();
  });

  it('should handle sink errors gracefully', async () => {
    const sink: EvidenceSink = {
      onEvidence: () => { throw new Error('sink error'); },
      onEpochSealed: () => { throw new Error('epoch sink error'); },
    };

    const proc = new MultiSinkProcessor(
      { agentDid: 'did:nobulex:sink-err', keyPair: sharedKeyPair },
      [sink],
    );

    // Should not throw despite sink errors
    proc.onEnd(makeSpan());
    await proc.forceFlush();
    await proc.shutdown();
  });

  it('should fan out to multiple sinks', async () => {
    const items1: EvidenceItem[] = [];
    const items2: EvidenceItem[] = [];

    const sink1: EvidenceSink = {
      onEvidence: (item) => { items1.push(item); },
      onEpochSealed: () => {},
    };
    const sink2: EvidenceSink = {
      onEvidence: (item) => { items2.push(item); },
      onEpochSealed: () => {},
    };

    const proc = new MultiSinkProcessor(
      { agentDid: 'did:nobulex:multi-sink', keyPair: sharedKeyPair },
      [sink1, sink2],
    );

    proc.onEnd(makeSpan());
    await proc.forceFlush();

    expect(items1).toHaveLength(1);
    expect(items2).toHaveLength(1);
    await proc.shutdown();
  });
});

// ============================================================================
// 17. BatchProcessor: maxQueueSize / droppedCount
// ============================================================================

describe('BatchProcessor maxQueueSize', () => {
  it('should drop spans when maxQueueSize is exceeded', async () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:batch-drop',
      keyPair: sharedKeyPair,
    });
    const batch = new BatchProcessor(inner, 100, 0, 3);

    batch.onEnd(makeSpan({ name: 'span-1' }));
    batch.onEnd(makeSpan({ name: 'span-2' }));
    batch.onEnd(makeSpan({ name: 'span-3' }));
    batch.onEnd(makeSpan({ name: 'span-4-dropped' }));
    batch.onEnd(makeSpan({ name: 'span-5-dropped' }));

    expect(batch.droppedCount).toBe(2);
    expect(batch.pendingCount).toBe(3);

    await batch.forceFlush();
    const items = await inner.getEvidenceItems();
    expect(items).toHaveLength(3);
    await batch.shutdown();
  });

  it('should expose maxQueueSize via getter', () => {
    const inner = new EvidenceSpanProcessor({
      agentDid: 'did:nobulex:batch-q',
      keyPair: sharedKeyPair,
    });
    const batch = new BatchProcessor(inner, 50, 0, 1024);
    expect(batch.getMaxQueueSize()).toBe(1024);
    batch.shutdown();
  });
});
