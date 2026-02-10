import { describe, it, expect, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  createMetricsRegistry,
  defaultMetrics,
} from './metrics';
import type { HistogramSnapshot, MetricsSnapshot } from './metrics';

// ─── Counter ─────────────────────────────────────────────────────────────────────

describe('Counter', () => {
  let counter: Counter;

  beforeEach(() => {
    counter = new Counter('test_counter', 'A test counter');
  });

  it('should start at 0', () => {
    expect(counter.get()).toBe(0);
  });

  it('should store name and description', () => {
    expect(counter.name).toBe('test_counter');
    expect(counter.description).toBe('A test counter');
  });

  it('should default description to empty string', () => {
    const c = new Counter('bare');
    expect(c.description).toBe('');
  });

  it('should increment by 1 when called with no argument', () => {
    counter.increment();
    expect(counter.get()).toBe(1);
  });

  it('should increment by the given value', () => {
    counter.increment(5);
    expect(counter.get()).toBe(5);
  });

  it('should accumulate multiple increments', () => {
    counter.increment();
    counter.increment(3);
    counter.increment(7);
    expect(counter.get()).toBe(11);
  });

  it('should reset to 0', () => {
    counter.increment(42);
    counter.reset();
    expect(counter.get()).toBe(0);
  });

  it('should allow increment by 0', () => {
    counter.increment(0);
    expect(counter.get()).toBe(0);
  });

  it('should throw on negative increment', () => {
    expect(() => counter.increment(-1)).toThrow('Counter increment value must be non-negative');
  });

  it('should handle fractional increments', () => {
    counter.increment(0.5);
    counter.increment(0.5);
    expect(counter.get()).toBe(1);
  });
});

// ─── Gauge ───────────────────────────────────────────────────────────────────────

describe('Gauge', () => {
  let gauge: Gauge;

  beforeEach(() => {
    gauge = new Gauge('test_gauge', 'A test gauge');
  });

  it('should start at 0', () => {
    expect(gauge.get()).toBe(0);
  });

  it('should store name and description', () => {
    expect(gauge.name).toBe('test_gauge');
    expect(gauge.description).toBe('A test gauge');
  });

  it('should default description to empty string', () => {
    const g = new Gauge('bare');
    expect(g.description).toBe('');
  });

  it('should set to an exact value', () => {
    gauge.set(42);
    expect(gauge.get()).toBe(42);
  });

  it('should overwrite previous value on set', () => {
    gauge.set(10);
    gauge.set(20);
    expect(gauge.get()).toBe(20);
  });

  it('should increment by 1 when called with no argument', () => {
    gauge.increment();
    expect(gauge.get()).toBe(1);
  });

  it('should increment by a given value', () => {
    gauge.increment(5);
    expect(gauge.get()).toBe(5);
  });

  it('should decrement by 1 when called with no argument', () => {
    gauge.set(10);
    gauge.decrement();
    expect(gauge.get()).toBe(9);
  });

  it('should decrement by a given value', () => {
    gauge.set(10);
    gauge.decrement(3);
    expect(gauge.get()).toBe(7);
  });

  it('should go negative', () => {
    gauge.decrement(5);
    expect(gauge.get()).toBe(-5);
  });

  it('should handle set to negative value', () => {
    gauge.set(-100);
    expect(gauge.get()).toBe(-100);
  });

  it('should combine set, increment, and decrement', () => {
    gauge.set(50);
    gauge.increment(10);
    gauge.decrement(25);
    expect(gauge.get()).toBe(35);
  });
});

// ─── Histogram ───────────────────────────────────────────────────────────────────

describe('Histogram', () => {
  let histogram: Histogram;

  beforeEach(() => {
    histogram = new Histogram('test_histogram', undefined, 'A test histogram');
  });

  it('should store name and description', () => {
    expect(histogram.name).toBe('test_histogram');
    expect(histogram.description).toBe('A test histogram');
  });

  it('should default description to empty string', () => {
    const h = new Histogram('bare');
    expect(h.description).toBe('');
  });

  it('should use default buckets when none supplied', () => {
    expect(histogram.buckets).toEqual([1, 5, 10, 25, 50, 100, 250, 500, 1000]);
  });

  it('should use custom buckets sorted ascending', () => {
    const h = new Histogram('custom', [100, 10, 50]);
    expect(h.buckets).toEqual([10, 50, 100]);
  });

  describe('empty histogram', () => {
    it('should return count 0', () => {
      const snap = histogram.get();
      expect(snap.count).toBe(0);
    });

    it('should return sum 0', () => {
      expect(histogram.get().sum).toBe(0);
    });

    it('should return min as Infinity', () => {
      expect(histogram.get().min).toBe(Infinity);
    });

    it('should return max as -Infinity', () => {
      expect(histogram.get().max).toBe(-Infinity);
    });

    it('should return avg 0', () => {
      expect(histogram.get().avg).toBe(0);
    });

    it('should return percentiles as 0', () => {
      const snap = histogram.get();
      expect(snap.p50).toBe(0);
      expect(snap.p90).toBe(0);
      expect(snap.p95).toBe(0);
      expect(snap.p99).toBe(0);
    });

    it('should return all bucket counts as 0', () => {
      const snap = histogram.get();
      for (const key of Object.keys(snap.bucketCounts)) {
        expect(snap.bucketCounts[key]).toBe(0);
      }
    });
  });

  describe('single observation', () => {
    beforeEach(() => {
      histogram.observe(42);
    });

    it('should have count 1', () => {
      expect(histogram.get().count).toBe(1);
    });

    it('should have sum equal to the observation', () => {
      expect(histogram.get().sum).toBe(42);
    });

    it('should have min and max equal to the observation', () => {
      const snap = histogram.get();
      expect(snap.min).toBe(42);
      expect(snap.max).toBe(42);
    });

    it('should have avg equal to the observation', () => {
      expect(histogram.get().avg).toBe(42);
    });

    it('should have all percentiles equal to the observation', () => {
      const snap = histogram.get();
      expect(snap.p50).toBe(42);
      expect(snap.p90).toBe(42);
      expect(snap.p95).toBe(42);
      expect(snap.p99).toBe(42);
    });
  });

  describe('known distribution', () => {
    beforeEach(() => {
      // Observations 1..100 — easy to reason about percentiles.
      for (let i = 1; i <= 100; i++) {
        histogram.observe(i);
      }
    });

    it('should have count 100', () => {
      expect(histogram.get().count).toBe(100);
    });

    it('should compute sum correctly', () => {
      // sum of 1..100 = 5050
      expect(histogram.get().sum).toBe(5050);
    });

    it('should compute min and max', () => {
      const snap = histogram.get();
      expect(snap.min).toBe(1);
      expect(snap.max).toBe(100);
    });

    it('should compute avg', () => {
      expect(histogram.get().avg).toBe(50.5);
    });

    it('should compute p50 (median)', () => {
      expect(histogram.get().p50).toBe(50);
    });

    it('should compute p90', () => {
      expect(histogram.get().p90).toBe(90);
    });

    it('should compute p95', () => {
      expect(histogram.get().p95).toBe(95);
    });

    it('should compute p99', () => {
      expect(histogram.get().p99).toBe(99);
    });

    it('should compute bucket counts', () => {
      const snap = histogram.get();
      // cumulative: le_1 => values <= 1 => 1
      expect(snap.bucketCounts['le_1']).toBe(1);
      // le_5 => values 1..5 => 5
      expect(snap.bucketCounts['le_5']).toBe(5);
      // le_10 => values 1..10 => 10
      expect(snap.bucketCounts['le_10']).toBe(10);
      // le_25 => 25
      expect(snap.bucketCounts['le_25']).toBe(25);
      // le_50 => 50
      expect(snap.bucketCounts['le_50']).toBe(50);
      // le_100 => all 100
      expect(snap.bucketCounts['le_100']).toBe(100);
    });
  });

  describe('reset', () => {
    it('should clear all observations', () => {
      histogram.observe(10);
      histogram.observe(20);
      histogram.reset();
      const snap = histogram.get();
      expect(snap.count).toBe(0);
      expect(snap.sum).toBe(0);
    });
  });

  describe('large dataset (1000 observations)', () => {
    it('should handle 1000 observations correctly', () => {
      const h = new Histogram('large');
      for (let i = 1; i <= 1000; i++) {
        h.observe(i);
      }
      const snap = h.get();
      expect(snap.count).toBe(1000);
      expect(snap.sum).toBe(500500); // sum of 1..1000
      expect(snap.min).toBe(1);
      expect(snap.max).toBe(1000);
      expect(snap.avg).toBe(500.5);
      expect(snap.p50).toBe(500);
      expect(snap.p99).toBe(990);
    });
  });

  describe('histogram with custom buckets', () => {
    it('should compute bucket counts using custom boundaries', () => {
      const h = new Histogram('custom_buckets', [10, 20, 30]);
      for (let i = 1; i <= 30; i++) {
        h.observe(i);
      }
      const snap = h.get();
      expect(snap.bucketCounts['le_10']).toBe(10);
      expect(snap.bucketCounts['le_20']).toBe(20);
      expect(snap.bucketCounts['le_30']).toBe(30);
    });
  });
});

// ─── MetricsRegistry ─────────────────────────────────────────────────────────────

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('should create a counter', () => {
    const c = registry.counter('requests', 'Total requests');
    expect(c).toBeInstanceOf(Counter);
    expect(c.name).toBe('requests');
    expect(c.description).toBe('Total requests');
  });

  it('should create a gauge', () => {
    const g = registry.gauge('connections', 'Active connections');
    expect(g).toBeInstanceOf(Gauge);
    expect(g.name).toBe('connections');
  });

  it('should create a histogram', () => {
    const h = registry.histogram('latency', [10, 50, 100], 'Request latency');
    expect(h).toBeInstanceOf(Histogram);
    expect(h.name).toBe('latency');
    expect(h.buckets).toEqual([10, 50, 100]);
  });

  describe('get-or-create semantics', () => {
    it('should return the same counter for the same name', () => {
      const c1 = registry.counter('req');
      const c2 = registry.counter('req');
      expect(c1).toBe(c2);
    });

    it('should return the same gauge for the same name', () => {
      const g1 = registry.gauge('conn');
      const g2 = registry.gauge('conn');
      expect(g1).toBe(g2);
    });

    it('should return the same histogram for the same name', () => {
      const h1 = registry.histogram('lat');
      const h2 = registry.histogram('lat');
      expect(h1).toBe(h2);
    });

    it('should share state when the same metric is retrieved twice', () => {
      const c1 = registry.counter('shared');
      c1.increment(10);
      const c2 = registry.counter('shared');
      expect(c2.get()).toBe(10);
    });
  });

  describe('getAll', () => {
    it('should return a snapshot of all metrics', () => {
      registry.counter('req').increment(5);
      registry.gauge('conn').set(3);
      registry.histogram('lat').observe(42);

      const snapshot: MetricsSnapshot = registry.getAll();

      expect(snapshot.counters['req']).toBe(5);
      expect(snapshot.gauges['conn']).toBe(3);
      expect(snapshot.histograms['lat'].count).toBe(1);
      expect(snapshot.histograms['lat'].sum).toBe(42);
    });

    it('should return empty objects when no metrics exist', () => {
      const snapshot = registry.getAll();
      expect(snapshot.counters).toEqual({});
      expect(snapshot.gauges).toEqual({});
      expect(snapshot.histograms).toEqual({});
    });
  });

  describe('toJSON', () => {
    it('should return a JSON-serializable object', () => {
      registry.counter('req').increment(2);
      registry.gauge('mem').set(1024);

      const json = registry.toJSON();

      expect(json).toHaveProperty('counters');
      expect(json).toHaveProperty('gauges');
      expect(json).toHaveProperty('histograms');
      expect((json.counters as Record<string, number>)['req']).toBe(2);
      expect((json.gauges as Record<string, number>)['mem']).toBe(1024);
    });

    it('should survive JSON round-trip', () => {
      registry.counter('c').increment(7);
      registry.histogram('h').observe(99);

      const roundTripped = JSON.parse(JSON.stringify(registry.toJSON()));

      expect(roundTripped.counters.c).toBe(7);
      expect(roundTripped.histograms.h.count).toBe(1);
      expect(roundTripped.histograms.h.sum).toBe(99);
    });
  });

  describe('reset', () => {
    it('should reset all counters, gauges, and histograms', () => {
      registry.counter('req').increment(100);
      registry.gauge('conn').set(50);
      registry.histogram('lat').observe(200);

      registry.reset();

      const snapshot = registry.getAll();
      expect(snapshot.counters['req']).toBe(0);
      expect(snapshot.gauges['conn']).toBe(0);
      expect(snapshot.histograms['lat'].count).toBe(0);
    });
  });
});

// ─── Factory & default registry ──────────────────────────────────────────────────

describe('createMetricsRegistry', () => {
  it('should create a new registry', () => {
    const r = createMetricsRegistry();
    expect(r).toBeInstanceOf(MetricsRegistry);
  });

  it('should create independent registries', () => {
    const r1 = createMetricsRegistry();
    const r2 = createMetricsRegistry();
    r1.counter('x').increment();
    expect(r2.getAll().counters).toEqual({});
  });
});

describe('defaultMetrics', () => {
  it('should be a MetricsRegistry instance', () => {
    expect(defaultMetrics).toBeInstanceOf(MetricsRegistry);
  });

  it('should be usable as a shared registry', () => {
    const c = defaultMetrics.counter('default_test_counter');
    c.increment();
    expect(defaultMetrics.counter('default_test_counter').get()).toBe(1);
    // Clean up
    c.reset();
  });
});
