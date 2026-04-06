/**
 * Tests for the OpenTelemetry-compatible instrumentation module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  telemetryMiddleware,
  NobulexMetrics,
  NoopTracer,
  NoopMeter,
  NoopSpan,
  NoopCounter,
  NoopHistogram,
  createTelemetry,
  SpanStatusCode,
} from '../src/telemetry.js';
import type {
  Span,
  Tracer,
  Meter,
  Counter,
  Histogram,
  EventSource,
} from '../src/telemetry.js';
import { MiddlewarePipeline } from '../src/middleware.js';
import type { NobulexMiddleware } from '../src/middleware.js';
import type {
  NobulexEventType,
  NobulexEventMap,
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  EvaluationCompletedEvent,
  CovenantCountersignedEvent,
  IdentityCreatedEvent,
  IdentityEvolvedEvent,
  ChainResolvedEvent,
  ChainValidatedEvent,
} from '../src/types.js';

// ─── Mock implementations ───────────────────────────────────────────────────

/** A mock Span that records all method calls for test assertions. */
class MockSpan implements Span {
  readonly attributes: Record<string, string | number | boolean> = {};
  status: { code: number; message?: string } | undefined;
  exceptions: Error[] = [];
  ended = false;

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setStatus(status: { code: number; message?: string }): void {
    this.status = status;
  }

  recordException(error: Error): void {
    this.exceptions.push(error);
  }

  end(): void {
    this.ended = true;
  }
}

/** A mock Tracer that records created spans. */
class MockTracer implements Tracer {
  readonly spans: MockSpan[] = [];

  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): Span {
    const span = new MockSpan();
    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        span.setAttribute(key, value);
      }
    }
    // Store the span name as an attribute for easy assertion
    span.setAttribute('_spanName', name);
    this.spans.push(span);
    return span;
  }
}

/** A mock Counter that records all add() calls. */
class MockCounter implements Counter {
  calls: Array<{ value: number; attributes?: Record<string, string> }> = [];
  total = 0;

  add(value: number, attributes?: Record<string, string>): void {
    this.calls.push({ value, attributes });
    this.total += value;
  }
}

/** A mock Histogram that records all record() calls. */
class MockHistogram implements Histogram {
  calls: Array<{ value: number; attributes?: Record<string, string> }> = [];

  record(value: number, attributes?: Record<string, string>): void {
    this.calls.push({ value, attributes });
  }
}

/** A mock Meter that returns tracked counters and histograms. */
class MockMeter implements Meter {
  readonly counters = new Map<string, MockCounter>();
  readonly histograms = new Map<string, MockHistogram>();

  createCounter(name: string, _options?: { description?: string }): Counter {
    const counter = new MockCounter();
    this.counters.set(name, counter);
    return counter;
  }

  createHistogram(name: string, _options?: { description?: string }): Histogram {
    const histogram = new MockHistogram();
    this.histograms.set(name, histogram);
    return histogram;
  }
}

/** A mock EventSource that simulates NobulexClient's on() API. */
class MockEventSource implements EventSource {
  private readonly _handlers = new Map<NobulexEventType, Set<(data: unknown) => void>>();

  on<T extends NobulexEventType>(event: T, handler: (data: NobulexEventMap[T]) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    const handlers = this._handlers.get(event)!;
    handlers.add(handler as (data: unknown) => void);

    return () => {
      handlers.delete(handler as (data: unknown) => void);
    };
  }

  /** Emit an event for testing. */
  emit<T extends NobulexEventType>(event: T, data: NobulexEventMap[T]): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /** Return count of handlers for a given event. */
  handlerCount(event: NobulexEventType): number {
    return this._handlers.get(event)?.size ?? 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a simple async operation that returns its input. */
function echoOp<T>(value: T): () => Promise<T> {
  return async () => value;
}

/** Create an async operation that throws. */
function failingOp(message: string): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}

// ─── Telemetry middleware — span creation ────────────────────────────────────

describe('telemetryMiddleware — span creation', () => {
  let tracer: MockTracer;
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    tracer = new MockTracer();
    pipeline = new MiddlewarePipeline();
    pipeline.use(telemetryMiddleware({ tracer }));
  });

  it('creates a span for each operation', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.attributes['_spanName']).toBe('nobulex.createCovenant');
  });

  it('creates separate spans for separate operations', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));
    await pipeline.execute('verifyCovenant', {}, echoOp({ valid: true }));
    expect(tracer.spans).toHaveLength(2);
    expect(tracer.spans[0]!.attributes['_spanName']).toBe('nobulex.createCovenant');
    expect(tracer.spans[1]!.attributes['_spanName']).toBe('nobulex.verifyCovenant');
  });

  it('ends the span after a successful operation', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));
    expect(tracer.spans[0]!.ended).toBe(true);
  });

  it('ends the span after a failed operation', async () => {
    await expect(
      pipeline.execute('createCovenant', {}, failingOp('boom')),
    ).rejects.toThrow('boom');
    expect(tracer.spans[0]!.ended).toBe(true);
  });
});

// ─── Telemetry middleware — span attributes ─────────────────────────────────

describe('telemetryMiddleware — span attributes', () => {
  let tracer: MockTracer;
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    tracer = new MockTracer();
    pipeline = new MiddlewarePipeline();
    pipeline.use(telemetryMiddleware({ tracer }));
  });

  it('sets nobulex.operation attribute', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));
    expect(tracer.spans[0]!.attributes['nobulex.operation']).toBe('createCovenant');
  });

  it('sets nobulex.covenant.id when result has an id', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-abc-123' }));
    expect(tracer.spans[0]!.attributes['nobulex.covenant.id']).toBe('cov-abc-123');
  });

  it('sets nobulex.verification.valid when result has valid field', async () => {
    await pipeline.execute('verifyCovenant', {}, echoOp({ valid: true, checks: [] }));
    expect(tracer.spans[0]!.attributes['nobulex.verification.valid']).toBe(true);
  });

  it('sets nobulex.evaluation.permitted when result has permitted field', async () => {
    await pipeline.execute('evaluateAction', {}, echoOp({ permitted: false, allMatches: [] }));
    expect(tracer.spans[0]!.attributes['nobulex.evaluation.permitted']).toBe(false);
  });

  it('sets nobulex.duration_ms attribute', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));
    expect(tracer.spans[0]!.attributes['nobulex.duration_ms']).toBeDefined();
    expect(typeof tracer.spans[0]!.attributes['nobulex.duration_ms']).toBe('number');
  });

  it('does not set result-specific attributes for non-object results', async () => {
    await pipeline.execute('someOp', {}, echoOp('string-result'));
    const span = tracer.spans[0]!;
    expect(span.attributes['nobulex.covenant.id']).toBeUndefined();
    expect(span.attributes['nobulex.verification.valid']).toBeUndefined();
    expect(span.attributes['nobulex.evaluation.permitted']).toBeUndefined();
  });

  it('does not set result-specific attributes for null results', async () => {
    await pipeline.execute('someOp', {}, echoOp(null));
    const span = tracer.spans[0]!;
    expect(span.attributes['nobulex.covenant.id']).toBeUndefined();
  });
});

// ─── Telemetry middleware — error handling ───────────────────────────────────

describe('telemetryMiddleware — error handling', () => {
  let tracer: MockTracer;
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    tracer = new MockTracer();
    pipeline = new MiddlewarePipeline();
    pipeline.use(telemetryMiddleware({ tracer }));
  });

  it('sets error status on failed operations', async () => {
    await expect(
      pipeline.execute('createCovenant', {}, failingOp('creation failed')),
    ).rejects.toThrow('creation failed');

    const span = tracer.spans[0]!;
    expect(span.status).toBeDefined();
    expect(span.status!.code).toBe(SpanStatusCode.ERROR);
    expect(span.status!.message).toBe('creation failed');
  });

  it('records exception on failed operations', async () => {
    await expect(
      pipeline.execute('createCovenant', {}, failingOp('oops')),
    ).rejects.toThrow('oops');

    const span = tracer.spans[0]!;
    expect(span.exceptions).toHaveLength(1);
    expect(span.exceptions[0]!.message).toBe('oops');
  });

  it('sets OK status on successful operations', async () => {
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));

    const span = tracer.spans[0]!;
    expect(span.status).toBeDefined();
    expect(span.status!.code).toBe(SpanStatusCode.OK);
  });

  it('records duration even on failed operations', async () => {
    await expect(
      pipeline.execute('createCovenant', {}, failingOp('fail')),
    ).rejects.toThrow('fail');

    const span = tracer.spans[0]!;
    expect(span.attributes['nobulex.duration_ms']).toBeDefined();
    expect(typeof span.attributes['nobulex.duration_ms']).toBe('number');
  });
});

// ─── NobulexMetrics — event recording ─────────────────────────────────────────

describe('NobulexMetrics — record()', () => {
  let meter: MockMeter;
  let metrics: NobulexMetrics;

  beforeEach(() => {
    meter = new MockMeter();
    metrics = new NobulexMetrics(meter);
  });

  it('increments nobulex.covenants.created on covenant:created', () => {
    const event: CovenantCreatedEvent = {
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    };
    metrics.record(event);

    const counter = meter.counters.get('nobulex.covenants.created')!;
    expect(counter.total).toBe(1);
  });

  it('increments nobulex.covenants.verified on covenant:verified', () => {
    const event: CovenantVerifiedEvent = {
      type: 'covenant:verified',
      timestamp: new Date().toISOString(),
      result: { valid: true, checks: [] } as any,
    };
    metrics.record(event);

    const counter = meter.counters.get('nobulex.covenants.verified')!;
    expect(counter.total).toBe(1);
  });

  it('increments nobulex.evaluations.total on evaluation:completed', () => {
    const event: EvaluationCompletedEvent = {
      type: 'evaluation:completed',
      timestamp: new Date().toISOString(),
      result: { permitted: true, allMatches: [] },
      action: 'read',
      resource: '/data',
    };
    metrics.record(event);

    const counter = meter.counters.get('nobulex.evaluations.total')!;
    expect(counter.total).toBe(1);
  });

  it('increments nobulex.evaluations.denied when evaluation is not permitted', () => {
    const event: EvaluationCompletedEvent = {
      type: 'evaluation:completed',
      timestamp: new Date().toISOString(),
      result: { permitted: false, allMatches: [] },
      action: 'delete',
      resource: '/system',
    };
    metrics.record(event);

    const denied = meter.counters.get('nobulex.evaluations.denied')!;
    expect(denied.total).toBe(1);
  });

  it('does not increment nobulex.evaluations.denied when evaluation is permitted', () => {
    const event: EvaluationCompletedEvent = {
      type: 'evaluation:completed',
      timestamp: new Date().toISOString(),
      result: { permitted: true, allMatches: [] },
      action: 'read',
      resource: '/data',
    };
    metrics.record(event);

    const denied = meter.counters.get('nobulex.evaluations.denied')!;
    expect(denied.total).toBe(0);
  });

  it('handles multiple events cumulatively', () => {
    metrics.record({
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    } as CovenantCreatedEvent);
    metrics.record({
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    } as CovenantCreatedEvent);
    metrics.record({
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    } as CovenantCreatedEvent);

    const counter = meter.counters.get('nobulex.covenants.created')!;
    expect(counter.total).toBe(3);
  });

  it('handles unknown event types gracefully', () => {
    // Events like covenant:countersigned should not throw
    const event = {
      type: 'covenant:countersigned' as const,
      timestamp: new Date().toISOString(),
      document: {} as any,
      signerRole: 'auditor' as const,
    } satisfies CovenantCountersignedEvent;

    expect(() => metrics.record(event)).not.toThrow();
  });

  it('records duration via recordDuration()', () => {
    metrics.recordDuration(42.5, { operation: 'createCovenant' });

    const histogram = meter.histograms.get('nobulex.operation.duration')!;
    expect(histogram.calls).toHaveLength(1);
    expect(histogram.calls[0]!.value).toBe(42.5);
    expect(histogram.calls[0]!.attributes).toEqual({ operation: 'createCovenant' });
  });
});

// ─── NobulexMetrics — bindToClient ────────────────────────────────────────────

describe('NobulexMetrics — bindToClient()', () => {
  let meter: MockMeter;
  let metrics: NobulexMetrics;
  let source: MockEventSource;

  beforeEach(() => {
    meter = new MockMeter();
    metrics = new NobulexMetrics(meter);
    source = new MockEventSource();
  });

  it('subscribes to all event types', () => {
    metrics.bindToClient(source);

    const expectedEvents: NobulexEventType[] = [
      'covenant:created',
      'covenant:verified',
      'covenant:countersigned',
      'identity:created',
      'identity:evolved',
      'chain:resolved',
      'chain:validated',
      'evaluation:completed',
    ];

    for (const event of expectedEvents) {
      expect(source.handlerCount(event)).toBe(1);
    }
  });

  it('returns disposal functions for all subscriptions', () => {
    const disposers = metrics.bindToClient(source);
    expect(disposers).toHaveLength(8);
    expect(disposers.every((d) => typeof d === 'function')).toBe(true);
  });

  it('disposal functions remove subscriptions', () => {
    const disposers = metrics.bindToClient(source);
    for (const dispose of disposers) {
      dispose();
    }

    expect(source.handlerCount('covenant:created')).toBe(0);
    expect(source.handlerCount('evaluation:completed')).toBe(0);
  });

  it('auto-records covenant:created events', () => {
    metrics.bindToClient(source);

    source.emit('covenant:created', {
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    });

    const counter = meter.counters.get('nobulex.covenants.created')!;
    expect(counter.total).toBe(1);
  });

  it('auto-records evaluation:completed events', () => {
    metrics.bindToClient(source);

    source.emit('evaluation:completed', {
      type: 'evaluation:completed',
      timestamp: new Date().toISOString(),
      result: { permitted: false, allMatches: [] },
      action: 'delete',
      resource: '/system',
    });

    const total = meter.counters.get('nobulex.evaluations.total')!;
    const denied = meter.counters.get('nobulex.evaluations.denied')!;
    expect(total.total).toBe(1);
    expect(denied.total).toBe(1);
  });

  it('auto-records covenant:verified events', () => {
    metrics.bindToClient(source);

    source.emit('covenant:verified', {
      type: 'covenant:verified',
      timestamp: new Date().toISOString(),
      result: { valid: true, checks: [] } as any,
    });

    const counter = meter.counters.get('nobulex.covenants.verified')!;
    expect(counter.total).toBe(1);
  });
});

// ─── NoopTracer and NoopMeter ───────────────────────────────────────────────

describe('NoopTracer', () => {
  it('returns a NoopSpan from startSpan', () => {
    const tracer = new NoopTracer();
    const span = tracer.startSpan('test');
    expect(span).toBeInstanceOf(NoopSpan);
  });

  it('returned span accepts all operations without error', () => {
    const tracer = new NoopTracer();
    const span = tracer.startSpan('test', { attributes: { key: 'value' } });

    expect(() => {
      span.setAttribute('key', 'value');
      span.setAttribute('num', 42);
      span.setAttribute('bool', true);
      span.setStatus({ code: SpanStatusCode.OK });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'fail' });
      span.recordException(new Error('test'));
      span.end();
    }).not.toThrow();
  });
});

describe('NoopMeter', () => {
  it('returns a NoopCounter from createCounter', () => {
    const meter = new NoopMeter();
    const counter = meter.createCounter('test');
    expect(counter).toBeInstanceOf(NoopCounter);
  });

  it('returns a NoopHistogram from createHistogram', () => {
    const meter = new NoopMeter();
    const histogram = meter.createHistogram('test');
    expect(histogram).toBeInstanceOf(NoopHistogram);
  });

  it('NoopCounter.add does not throw', () => {
    const meter = new NoopMeter();
    const counter = meter.createCounter('test', { description: 'desc' });
    expect(() => {
      counter.add(1);
      counter.add(5, { key: 'val' });
    }).not.toThrow();
  });

  it('NoopHistogram.record does not throw', () => {
    const meter = new NoopMeter();
    const histogram = meter.createHistogram('test', { description: 'desc' });
    expect(() => {
      histogram.record(42);
      histogram.record(100, { key: 'val' });
    }).not.toThrow();
  });
});

// ─── createTelemetry factory ────────────────────────────────────────────────

describe('createTelemetry()', () => {
  it('returns an object with middleware and metrics', () => {
    const result = createTelemetry();
    expect(result).toHaveProperty('middleware');
    expect(result).toHaveProperty('metrics');
  });

  it('middleware is a valid NobulexMiddleware', () => {
    const { middleware } = createTelemetry();
    expect(middleware.name).toBe('telemetry');
    expect(middleware.before).toBeDefined();
    expect(middleware.after).toBeDefined();
    expect(middleware.onError).toBeDefined();
  });

  it('metrics is a NobulexMetrics instance', () => {
    const { metrics } = createTelemetry();
    expect(metrics).toBeInstanceOf(NobulexMetrics);
  });

  it('works with no-op defaults (no tracer/meter provided)', async () => {
    const { middleware, metrics } = createTelemetry();

    // Middleware should work in a pipeline
    const pipeline = new MiddlewarePipeline();
    pipeline.use(middleware);
    const result = await pipeline.execute('test', {}, echoOp('ok'));
    expect(result).toBe('ok');

    // Metrics should record without error
    expect(() => {
      metrics.record({
        type: 'covenant:created',
        timestamp: new Date().toISOString(),
        document: {} as any,
      } as CovenantCreatedEvent);
    }).not.toThrow();
  });

  it('uses provided tracer for spans', async () => {
    const tracer = new MockTracer();
    const { middleware } = createTelemetry({ tracer });

    const pipeline = new MiddlewarePipeline();
    pipeline.use(middleware);
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-1' }));

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.attributes['nobulex.operation']).toBe('createCovenant');
  });

  it('uses provided meter for metrics', () => {
    const meter = new MockMeter();
    const { metrics } = createTelemetry({ meter });

    metrics.record({
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    } as CovenantCreatedEvent);

    const counter = meter.counters.get('nobulex.covenants.created')!;
    expect(counter.total).toBe(1);
  });

  it('middleware and metrics work together end-to-end', async () => {
    const tracer = new MockTracer();
    const meter = new MockMeter();
    const source = new MockEventSource();
    const { middleware, metrics } = createTelemetry({ tracer, meter });

    // Set up pipeline
    const pipeline = new MiddlewarePipeline();
    pipeline.use(middleware);

    // Bind metrics to event source
    metrics.bindToClient(source);

    // Execute an operation through the pipeline
    await pipeline.execute('createCovenant', {}, echoOp({ id: 'cov-end-to-end' }));

    // Simulate the client emitting an event
    source.emit('covenant:created', {
      type: 'covenant:created',
      timestamp: new Date().toISOString(),
      document: {} as any,
    });

    // Verify span was created
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.attributes['nobulex.covenant.id']).toBe('cov-end-to-end');
    expect(tracer.spans[0]!.status!.code).toBe(SpanStatusCode.OK);

    // Verify metric was recorded
    const counter = meter.counters.get('nobulex.covenants.created')!;
    expect(counter.total).toBe(1);
  });
});

// ─── Telemetry middleware — uses NoopTracer by default ───────────────────────

describe('telemetryMiddleware — defaults', () => {
  it('works without providing options', async () => {
    const mw = telemetryMiddleware();
    const pipeline = new MiddlewarePipeline();
    pipeline.use(mw);

    const result = await pipeline.execute('test', {}, echoOp('value'));
    expect(result).toBe('value');
  });

  it('has the name "telemetry"', () => {
    const mw = telemetryMiddleware();
    expect(mw.name).toBe('telemetry');
  });

  it('cleans up metadata after successful operation', async () => {
    let capturedMetadata: Record<string, unknown> | undefined;
    const pipeline = new MiddlewarePipeline();

    // Register a capture middleware BEFORE telemetry so its after hook runs AFTER telemetry's
    pipeline.use({
      name: 'metaCapture',
      async after(ctx, result) {
        capturedMetadata = { ...ctx.metadata };
        return result;
      },
    });
    pipeline.use(telemetryMiddleware({ tracer: new MockTracer() }));

    await pipeline.execute('test', {}, echoOp('ok'));

    expect(capturedMetadata).toBeDefined();
    expect(capturedMetadata!._telemetrySpan).toBeUndefined();
    expect(capturedMetadata!._telemetryStart).toBeUndefined();
  });
});
