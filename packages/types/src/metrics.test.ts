import { describe, it, expect, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  createMetricsRegistry,
  defaultMetrics,
} from './metrics';
import type { MetricsSnapshot } from './metrics';

describe('Counter', () => {
  let counter: Counter;
  beforeEach(() => {
    counter = new Counter('test_counter', 'A test counter');
  });

  it('tracks name/description, starts at 0, accumulates increments, resets', () => {
    expect(counter.name).toBe('test_counter');
    expect(counter.description).toBe('A test counter');
    expect(new Counter('bare').description).toBe('');
    expect(counter.get()).toBe(0);

    counter.increment();
    counter.increment(3);
    counter.increment(7);
    expect(counter.get()).toBe(11);
    counter.increment(0);
    expect(counter.get()).toBe(11);

    counter.reset();
    expect(counter.get()).toBe(0);

    counter.increment(0.5);
    counter.increment(0.5);
    expect(counter.get()).toBe(1);
  });

  it('throws on negative increments', () => {
    expect(() => counter.increment(-1)).toThrow('Counter increment value must be non-negative');
  });
});

describe('Gauge', () => {
  let gauge: Gauge;
  beforeEach(() => {
    gauge = new Gauge('test_gauge', 'A test gauge');
  });

  it('supports set/increment/decrement, negative values, and combines all three', () => {
    expect(gauge.name).toBe('test_gauge');
    expect(gauge.description).toBe('A test gauge');
    expect(new Gauge('bare').description).toBe('');
    expect(gauge.get()).toBe(0);

    gauge.set(10);
    expect(gauge.get()).toBe(10);
    gauge.set(20);
    expect(gauge.get()).toBe(20);

    gauge.increment();
    expect(gauge.get()).toBe(21);
    gauge.increment(5);
    expect(gauge.get()).toBe(26);
    gauge.decrement();
    expect(gauge.get()).toBe(25);
    gauge.decrement(10);
    expect(gauge.get()).toBe(15);

    // Combined
    gauge.set(50);
    gauge.increment(10);
    gauge.decrement(25);
    expect(gauge.get()).toBe(35);

    // Negative values are allowed
    gauge.set(-100);
    expect(gauge.get()).toBe(-100);
    const g2 = new Gauge('g');
    g2.decrement(5);
    expect(g2.get()).toBe(-5);
  });
});

describe('Histogram', () => {
  it('exposes name/description/buckets, sorts custom buckets, uses defaults when unspecified', () => {
    const h = new Histogram('test_histogram', undefined, 'desc');
    expect(h.name).toBe('test_histogram');
    expect(h.description).toBe('desc');
    expect(h.buckets).toEqual([1, 5, 10, 25, 50, 100, 250, 500, 1000]);

    expect(new Histogram('bare').description).toBe('');
    expect(new Histogram('custom', [100, 10, 50]).buckets).toEqual([10, 50, 100]);
  });

  it('empty histogram: count/sum/avg=0, min=+Inf, max=-Inf, percentiles=0, bucketCounts=0', () => {
    const h = new Histogram('h');
    const snap = h.get();
    expect(snap.count).toBe(0);
    expect(snap.sum).toBe(0);
    expect(snap.avg).toBe(0);
    expect(snap.min).toBe(Infinity);
    expect(snap.max).toBe(-Infinity);
    expect(snap.p50).toBe(0);
    expect(snap.p90).toBe(0);
    expect(snap.p95).toBe(0);
    expect(snap.p99).toBe(0);
    for (const v of Object.values(snap.bucketCounts)) expect(v).toBe(0);
  });

  it('single observation: count=1, min/max/avg/percentiles all equal the observation', () => {
    const h = new Histogram('h');
    h.observe(42);
    const snap = h.get();
    expect(snap.count).toBe(1);
    expect(snap.sum).toBe(42);
    expect(snap.min).toBe(42);
    expect(snap.max).toBe(42);
    expect(snap.avg).toBe(42);
    expect(snap.p50).toBe(42);
    expect(snap.p99).toBe(42);
  });

  it('computes stats and cumulative bucket counts for 1..100 distribution', () => {
    const h = new Histogram('h');
    for (let i = 1; i <= 100; i++) h.observe(i);
    const snap = h.get();
    expect(snap.count).toBe(100);
    expect(snap.sum).toBe(5050);
    expect(snap.min).toBe(1);
    expect(snap.max).toBe(100);
    expect(snap.avg).toBe(50.5);
    expect(snap.p50).toBe(50);
    expect(snap.p90).toBe(90);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
    expect(snap.bucketCounts['le_1']).toBe(1);
    expect(snap.bucketCounts['le_5']).toBe(5);
    expect(snap.bucketCounts['le_10']).toBe(10);
    expect(snap.bucketCounts['le_25']).toBe(25);
    expect(snap.bucketCounts['le_50']).toBe(50);
    expect(snap.bucketCounts['le_100']).toBe(100);
  });

  it('handles large datasets and custom bucket boundaries, supports reset', () => {
    const large = new Histogram('large');
    for (let i = 1; i <= 1000; i++) large.observe(i);
    const snap = large.get();
    expect(snap.count).toBe(1000);
    expect(snap.sum).toBe(500500);
    expect(snap.avg).toBe(500.5);
    expect(snap.p50).toBe(500);
    expect(snap.p99).toBe(990);

    const custom = new Histogram('c', [10, 20, 30]);
    for (let i = 1; i <= 30; i++) custom.observe(i);
    expect(custom.get().bucketCounts['le_10']).toBe(10);
    expect(custom.get().bucketCounts['le_20']).toBe(20);
    expect(custom.get().bucketCounts['le_30']).toBe(30);

    const h = new Histogram('h');
    h.observe(10);
    h.observe(20);
    h.reset();
    expect(h.get().count).toBe(0);
    expect(h.get().sum).toBe(0);
  });
});

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;
  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('creates typed counters/gauges/histograms and get-or-create returns same instance', () => {
    const c = registry.counter('requests', 'Total requests');
    expect(c).toBeInstanceOf(Counter);
    expect(c.name).toBe('requests');
    expect(c.description).toBe('Total requests');

    const g = registry.gauge('connections', 'Active connections');
    expect(g).toBeInstanceOf(Gauge);
    expect(g.name).toBe('connections');

    const h = registry.histogram('latency', [10, 50, 100], 'Request latency');
    expect(h).toBeInstanceOf(Histogram);
    expect(h.buckets).toEqual([10, 50, 100]);

    expect(registry.counter('req')).toBe(registry.counter('req'));
    expect(registry.gauge('conn')).toBe(registry.gauge('conn'));
    expect(registry.histogram('lat')).toBe(registry.histogram('lat'));

    registry.counter('shared').increment(10);
    expect(registry.counter('shared').get()).toBe(10);
  });

  it('getAll produces a complete snapshot, toJSON round-trips, reset clears', () => {
    registry.counter('req').increment(5);
    registry.gauge('conn').set(3);
    registry.histogram('lat').observe(42);

    const snap: MetricsSnapshot = registry.getAll();
    expect(snap.counters['req']).toBe(5);
    expect(snap.gauges['conn']).toBe(3);
    expect(snap.histograms['lat'].count).toBe(1);
    expect(snap.histograms['lat'].sum).toBe(42);

    const roundTripped = JSON.parse(JSON.stringify(registry.toJSON()));
    expect(roundTripped).toHaveProperty('counters');
    expect(roundTripped).toHaveProperty('gauges');
    expect(roundTripped).toHaveProperty('histograms');
    expect(roundTripped.counters.req).toBe(5);
    expect(roundTripped.histograms.lat.sum).toBe(42);

    registry.reset();
    const after = registry.getAll();
    expect(after.counters['req']).toBe(0);
    expect(after.gauges['conn']).toBe(0);
    expect(after.histograms['lat'].count).toBe(0);

    expect(new MetricsRegistry().getAll()).toEqual({ counters: {}, gauges: {}, histograms: {} });
  });
});

describe('createMetricsRegistry / defaultMetrics', () => {
  it('creates independent registries and defaultMetrics is a shared, usable instance', () => {
    const r1 = createMetricsRegistry();
    const r2 = createMetricsRegistry();
    expect(r1).toBeInstanceOf(MetricsRegistry);
    r1.counter('x').increment();
    expect(r2.getAll().counters).toEqual({});

    expect(defaultMetrics).toBeInstanceOf(MetricsRegistry);
    const shared = defaultMetrics.counter('default_test_counter');
    shared.increment();
    expect(defaultMetrics.counter('default_test_counter').get()).toBe(1);
    shared.reset();
  });
});
