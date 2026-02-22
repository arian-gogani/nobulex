import { describe, it, expect, vi } from 'vitest';
import {
  Tracer,
  ActiveSpan,
  InMemoryCollector,
  createTracer,
} from './tracing';
import type { Span, SpanEvent, SpanStatus, SpanCollector } from './tracing';
import { generateId } from '@nobulex/crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Small sleep to ensure measurable timing differences. */
const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Tracer ─────────────────────────────────────────────────────────────────────

describe('Tracer', () => {
  it('can be created with no arguments', () => {
    const tracer = new Tracer();
    expect(tracer).toBeInstanceOf(Tracer);
  });

  it('can be created via createTracer factory', () => {
    const tracer = createTracer();
    expect(tracer).toBeInstanceOf(Tracer);
  });

  it('accepts a serviceName option', () => {
    const tracer = createTracer({ serviceName: 'test-service' });
    const span = tracer.startSpan('op');
    span.end();
    const completed = tracer.getCompletedSpans();
    expect(completed[0]!.attributes['service.name']).toBe('test-service');
  });

  it('startSpan returns an ActiveSpan', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('my-op');
    expect(span).toBeInstanceOf(ActiveSpan);
    expect(span.name).toBe('my-op');
    span.end();
  });

  it('generates unique trace IDs for each root span', () => {
    const tracer = createTracer();
    const s1 = tracer.startSpan('a');
    const s2 = tracer.startSpan('b');
    expect(s1.traceId).not.toBe(s2.traceId);
    s1.end();
    s2.end();
  });

  it('generates unique span IDs for each span', () => {
    const tracer = createTracer();
    const s1 = tracer.startSpan('a');
    const s2 = tracer.startSpan('b');
    expect(s1.spanId).not.toBe(s2.spanId);
    s1.end();
    s2.end();
  });

  it('trace and span IDs are hex strings of expected length', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    // generateId(16) produces 32 hex chars
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{32}$/);
    span.end();
  });

  it('tracks active spans', () => {
    const tracer = createTracer();
    expect(tracer.getActiveSpans()).toHaveLength(0);

    const s1 = tracer.startSpan('a');
    const s2 = tracer.startSpan('b');
    expect(tracer.getActiveSpans()).toHaveLength(2);

    s1.end();
    expect(tracer.getActiveSpans()).toHaveLength(1);
    expect(tracer.getActiveSpans()[0]!.spanId).toBe(s2.spanId);

    s2.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
  });

  it('tracks completed spans', () => {
    const tracer = createTracer();
    expect(tracer.getCompletedSpans()).toHaveLength(0);

    const s1 = tracer.startSpan('a');
    s1.end();
    expect(tracer.getCompletedSpans()).toHaveLength(1);

    const s2 = tracer.startSpan('b');
    s2.end();
    expect(tracer.getCompletedSpans()).toHaveLength(2);
  });

  it('clearCompletedSpans empties the list', () => {
    const tracer = createTracer();
    tracer.startSpan('a').end();
    tracer.startSpan('b').end();
    expect(tracer.getCompletedSpans()).toHaveLength(2);

    tracer.clearCompletedSpans();
    expect(tracer.getCompletedSpans()).toHaveLength(0);
  });

  it('passes completed spans to the collector', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });

    const span = tracer.startSpan('op');
    span.end();

    expect(collector.getSpans()).toHaveLength(1);
    expect(collector.getSpans()[0]!.name).toBe('op');
  });

  it('getActiveSpans returns a copy, not a reference', () => {
    const tracer = createTracer();
    const s = tracer.startSpan('a');
    const active = tracer.getActiveSpans();
    s.end();
    // The previously retrieved array should not have changed
    expect(active).toHaveLength(1);
    expect(tracer.getActiveSpans()).toHaveLength(0);
  });

  it('getCompletedSpans returns a copy, not a reference', () => {
    const tracer = createTracer();
    tracer.startSpan('a').end();
    const completed = tracer.getCompletedSpans();
    tracer.clearCompletedSpans();
    expect(completed).toHaveLength(1);
    expect(tracer.getCompletedSpans()).toHaveLength(0);
  });
});

// ─── ActiveSpan ─────────────────────────────────────────────────────────────────

describe('ActiveSpan', () => {
  it('has traceId, spanId, and name properties', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('test-op');
    expect(typeof span.traceId).toBe('string');
    expect(typeof span.spanId).toBe('string');
    expect(span.name).toBe('test-op');
    span.end();
  });

  it('isEnded is false before end and true after', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    expect(span.isEnded).toBe(false);
    span.end();
    expect(span.isEnded).toBe(true);
  });

  it('setAttribute stores attributes on the span', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.setAttribute('key1', 'value1');
    span.setAttribute('key2', 42);
    const result = span.end();
    expect(result.attributes.key1).toBe('value1');
    expect(result.attributes.key2).toBe(42);
  });

  it('initial attributes are included in the finished span', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op', { initial: true });
    const result = span.end();
    expect(result.attributes.initial).toBe(true);
  });

  it('addEvent records an event', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.addEvent('cache-miss');
    span.addEvent('retry', { attempt: 1 });
    const result = span.end();
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.name).toBe('cache-miss');
    expect(result.events[1]!.name).toBe('retry');
    expect(result.events[1]!.attributes).toEqual({ attempt: 1 });
  });

  it('events have valid ISO timestamps', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.addEvent('e1');
    const result = span.end();
    expect(() => new Date(result.events[0]!.timestamp)).not.toThrow();
    expect(new Date(result.events[0]!.timestamp).toISOString()).toBe(
      result.events[0]!.timestamp,
    );
  });

  it('events without attributes do not have an attributes key', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.addEvent('bare-event');
    const result = span.end();
    expect(result.events[0]!).not.toHaveProperty('attributes');
  });

  it('setStatus changes the span status', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.setStatus('error');
    const result = span.end();
    expect(result.status).toBe('error');
  });

  it('default status is ok', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    const result = span.end();
    expect(result.status).toBe('ok');
  });

  it('end returns a Span with timing data', async () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    await tick(10);
    const result = span.end();

    expect(result.startTime).toBeDefined();
    expect(result.endTime).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it('end returns a Span with valid ISO timestamps', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    const result = span.end();

    expect(new Date(result.startTime).toISOString()).toBe(result.startTime);
    expect(new Date(result.endTime!).toISOString()).toBe(result.endTime);
  });

  it('throws on double end', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.end()).toThrow('Span "op" has already ended');
  });

  it('throws on setAttribute after end', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.setAttribute('k', 'v')).toThrow('has already ended');
  });

  it('throws on addEvent after end', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.addEvent('e')).toThrow('has already ended');
  });

  it('throws on setStatus after end', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.setStatus('error')).toThrow('has already ended');
  });

  it('throws on child after end', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.child('sub')).toThrow('has already ended');
  });
});

// ─── Child spans ────────────────────────────────────────────────────────────────

describe('Child spans', () => {
  it('child shares the parent traceId', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child');
    expect(child.traceId).toBe(parent.traceId);
    child.end();
    parent.end();
  });

  it('child has a different spanId from parent', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child');
    expect(child.spanId).not.toBe(parent.spanId);
    child.end();
    parent.end();
  });

  it('child span has parentSpanId set to parent spanId', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child');
    const result = child.end();
    expect(result.parentSpanId).toBe(parent.spanId);
    parent.end();
  });

  it('root spans do not have parentSpanId', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('root');
    const result = span.end();
    expect(result.parentSpanId).toBeUndefined();
  });

  it('child inherits initial attributes', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child', { extra: 'data' });
    const result = child.end();
    expect(result.attributes.extra).toBe('data');
    parent.end();
  });

  it('deeply nested spans form a chain', () => {
    const tracer = createTracer();
    const root = tracer.startSpan('root');
    const mid = root.child('mid');
    const leaf = mid.child('leaf');

    const leafResult = leaf.end();
    const midResult = mid.end();
    const rootResult = root.end();

    expect(leafResult.parentSpanId).toBe(mid.spanId);
    expect(midResult.parentSpanId).toBe(root.spanId);
    expect(rootResult.parentSpanId).toBeUndefined();

    // All share the same traceId
    expect(midResult.traceId).toBe(rootResult.traceId);
    expect(leafResult.traceId).toBe(rootResult.traceId);
  });

  it('child spans appear in the tracer active list', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    expect(tracer.getActiveSpans()).toHaveLength(1);

    const child = parent.child('child');
    expect(tracer.getActiveSpans()).toHaveLength(2);

    child.end();
    expect(tracer.getActiveSpans()).toHaveLength(1);

    parent.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
  });
});

// ─── InMemoryCollector ──────────────────────────────────────────────────────────

describe('InMemoryCollector', () => {
  it('starts empty', () => {
    const collector = new InMemoryCollector();
    expect(collector.getSpans()).toHaveLength(0);
  });

  it('collects spans via onSpanEnd', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });

    tracer.startSpan('a').end();
    tracer.startSpan('b').end();

    expect(collector.getSpans()).toHaveLength(2);
  });

  it('clear removes all collected spans', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });

    tracer.startSpan('a').end();
    expect(collector.getSpans()).toHaveLength(1);

    collector.clear();
    expect(collector.getSpans()).toHaveLength(0);
  });

  it('getSpans returns a copy', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });
    tracer.startSpan('a').end();

    const spans = collector.getSpans();
    collector.clear();
    expect(spans).toHaveLength(1);
    expect(collector.getSpans()).toHaveLength(0);
  });

  it('collects child spans independently', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });

    const parent = tracer.startSpan('parent');
    const child = parent.child('child');
    child.end();
    parent.end();

    expect(collector.getSpans()).toHaveLength(2);
    const names = collector.getSpans().map((s) => s.name);
    expect(names).toContain('parent');
    expect(names).toContain('child');
  });
});

// ─── Concurrent spans ───────────────────────────────────────────────────────────

describe('Concurrent spans', () => {
  it('multiple active spans can coexist', () => {
    const tracer = createTracer();
    const spans = Array.from({ length: 5 }, (_, i) =>
      tracer.startSpan(`span-${i}`),
    );
    expect(tracer.getActiveSpans()).toHaveLength(5);

    for (const s of spans) s.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
    expect(tracer.getCompletedSpans()).toHaveLength(5);
  });

  it('ending spans in different order is fine', () => {
    const tracer = createTracer();
    const s1 = tracer.startSpan('first');
    const s2 = tracer.startSpan('second');
    const s3 = tracer.startSpan('third');

    s2.end();
    expect(tracer.getActiveSpans()).toHaveLength(2);

    s3.end();
    expect(tracer.getActiveSpans()).toHaveLength(1);

    s1.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
    expect(tracer.getCompletedSpans()).toHaveLength(3);
  });
});

// ─── Custom SpanCollector ───────────────────────────────────────────────────────

describe('Custom SpanCollector', () => {
  it('receives each span exactly once', () => {
    const received: Span[] = [];
    const custom: SpanCollector = {
      onSpanEnd(span) {
        received.push(span);
      },
    };
    const tracer = createTracer({ collector: custom });

    tracer.startSpan('a').end();
    tracer.startSpan('b').end();

    expect(received).toHaveLength(2);
    expect(received[0]!.name).toBe('a');
    expect(received[1]!.name).toBe('b');
  });
});
