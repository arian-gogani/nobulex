import { describe, it, expect } from 'vitest';
import { Tracer, ActiveSpan, InMemoryCollector, createTracer } from './tracing';
import type { Span, SpanCollector } from './tracing';

const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));

describe('Tracer', () => {
  it('factory + constructor produce Tracer instances; startSpan returns an ActiveSpan', () => {
    expect(new Tracer()).toBeInstanceOf(Tracer);
    const tracer = createTracer();
    expect(tracer).toBeInstanceOf(Tracer);
    const span = tracer.startSpan('my-op');
    expect(span).toBeInstanceOf(ActiveSpan);
    expect(span.name).toBe('my-op');
    span.end();
  });

  it('propagates serviceName option to span attributes', () => {
    const tracer = createTracer({ serviceName: 'test-service' });
    tracer.startSpan('op').end();
    expect(tracer.getCompletedSpans()[0]!.attributes['service.name']).toBe('test-service');
  });

  it('generates unique hex trace/span IDs per span', () => {
    const tracer = createTracer();
    const s1 = tracer.startSpan('a');
    const s2 = tracer.startSpan('b');
    expect(s1.traceId).not.toBe(s2.traceId);
    expect(s1.spanId).not.toBe(s2.spanId);
    expect(s1.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(s1.spanId).toMatch(/^[0-9a-f]{32}$/);
    s1.end();
    s2.end();
  });

  it('tracks active and completed spans, clearCompletedSpans empties completed', () => {
    const tracer = createTracer();
    expect(tracer.getActiveSpans()).toHaveLength(0);
    const s1 = tracer.startSpan('a');
    const s2 = tracer.startSpan('b');
    expect(tracer.getActiveSpans()).toHaveLength(2);

    s1.end();
    expect(tracer.getActiveSpans()).toHaveLength(1);
    expect(tracer.getActiveSpans()[0]!.spanId).toBe(s2.spanId);
    expect(tracer.getCompletedSpans()).toHaveLength(1);

    s2.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
    expect(tracer.getCompletedSpans()).toHaveLength(2);

    tracer.clearCompletedSpans();
    expect(tracer.getCompletedSpans()).toHaveLength(0);
  });

  it('getActiveSpans and getCompletedSpans return copies, not references', () => {
    const tracer = createTracer();
    const s = tracer.startSpan('a');
    const active = tracer.getActiveSpans();
    s.end();
    expect(active).toHaveLength(1); // snapshot

    const completed = tracer.getCompletedSpans();
    tracer.clearCompletedSpans();
    expect(completed).toHaveLength(1); // snapshot
  });

  it('forwards completed spans to the configured collector', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });
    tracer.startSpan('op').end();
    expect(collector.getSpans()).toHaveLength(1);
    expect(collector.getSpans()[0]!.name).toBe('op');
  });
});

describe('ActiveSpan', () => {
  it('isEnded toggles; attributes, events, and status are captured on end()', async () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op', { initial: true });
    expect(span.isEnded).toBe(false);

    span.setAttribute('key1', 'value1');
    span.setAttribute('key2', 42);
    span.addEvent('cache-miss');
    span.addEvent('retry', { attempt: 1 });
    span.setStatus('error');
    await tick(5);

    const result = span.end();
    expect(span.isEnded).toBe(true);
    expect(result.attributes.initial).toBe(true);
    expect(result.attributes.key1).toBe('value1');
    expect(result.attributes.key2).toBe(42);
    expect(result.status).toBe('error');

    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.name).toBe('cache-miss');
    expect(result.events[0]).not.toHaveProperty('attributes');
    expect(result.events[1]!.name).toBe('retry');
    expect(result.events[1]!.attributes).toEqual({ attempt: 1 });
    // Event timestamp is a valid ISO string
    expect(new Date(result.events[0]!.timestamp).toISOString()).toBe(result.events[0]!.timestamp);

    // Timing data
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs!).toBeGreaterThanOrEqual(0);
    expect(new Date(result.startTime).toISOString()).toBe(result.startTime);
    expect(new Date(result.endTime!).toISOString()).toBe(result.endTime);
  });

  it('defaults status to ok', () => {
    const tracer = createTracer();
    const result = tracer.startSpan('op').end();
    expect(result.status).toBe('ok');
  });

  it('throws on any use after end (end/setAttribute/addEvent/setStatus/child)', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('op');
    span.end();
    expect(() => span.end()).toThrow('Span "op" has already ended');
    expect(() => span.setAttribute('k', 'v')).toThrow('has already ended');
    expect(() => span.addEvent('e')).toThrow('has already ended');
    expect(() => span.setStatus('error')).toThrow('has already ended');
    expect(() => span.child('sub')).toThrow('has already ended');
  });
});

describe('Child spans', () => {
  it('children share traceId, get unique spanId, set parentSpanId, and inherit initial attrs', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child', { extra: 'data' });
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    const cResult = child.end();
    expect(cResult.parentSpanId).toBe(parent.spanId);
    expect(cResult.attributes.extra).toBe('data');

    const rootResult = parent.end();
    expect(rootResult.parentSpanId).toBeUndefined();
  });

  it('deeply nested spans form a chain sharing a traceId', () => {
    const tracer = createTracer();
    const root = tracer.startSpan('root');
    const mid = root.child('mid');
    const leaf = mid.child('leaf');
    const leafR = leaf.end();
    const midR = mid.end();
    const rootR = root.end();
    expect(leafR.parentSpanId).toBe(mid.spanId);
    expect(midR.parentSpanId).toBe(root.spanId);
    expect(rootR.parentSpanId).toBeUndefined();
    expect(leafR.traceId).toBe(rootR.traceId);
    expect(midR.traceId).toBe(rootR.traceId);
  });

  it('child spans appear in the tracer active list', () => {
    const tracer = createTracer();
    const parent = tracer.startSpan('parent');
    const child = parent.child('child');
    expect(tracer.getActiveSpans()).toHaveLength(2);
    child.end();
    parent.end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
  });
});

describe('InMemoryCollector', () => {
  it('starts empty, collects spans, returns copies, and supports clear()', () => {
    const collector = new InMemoryCollector();
    expect(collector.getSpans()).toHaveLength(0);
    const tracer = createTracer({ collector });
    tracer.startSpan('a').end();
    tracer.startSpan('b').end();
    expect(collector.getSpans()).toHaveLength(2);

    const snap = collector.getSpans();
    collector.clear();
    expect(snap).toHaveLength(2);
    expect(collector.getSpans()).toHaveLength(0);
  });

  it('collects parent and child spans independently', () => {
    const collector = new InMemoryCollector();
    const tracer = createTracer({ collector });
    const parent = tracer.startSpan('parent');
    parent.child('child').end();
    parent.end();
    const names = collector.getSpans().map(s => s.name);
    expect(names).toContain('parent');
    expect(names).toContain('child');
  });
});

describe('Concurrent spans and custom collectors', () => {
  it('supports many concurrent spans ended in any order', () => {
    const tracer = createTracer();
    const spans = Array.from({ length: 5 }, (_, i) => tracer.startSpan(`span-${i}`));
    expect(tracer.getActiveSpans()).toHaveLength(5);
    spans[2].end();
    spans[4].end();
    spans[0].end();
    spans[1].end();
    spans[3].end();
    expect(tracer.getActiveSpans()).toHaveLength(0);
    expect(tracer.getCompletedSpans()).toHaveLength(5);
  });

  it('custom SpanCollector receives each span exactly once', () => {
    const received: Span[] = [];
    const custom: SpanCollector = { onSpanEnd: (span) => received.push(span) };
    const tracer = createTracer({ collector: custom });
    tracer.startSpan('a').end();
    tracer.startSpan('b').end();
    expect(received).toHaveLength(2);
    expect(received.map(s => s.name)).toEqual(['a', 'b']);
  });
});
