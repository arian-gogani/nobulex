/**
 * Lightweight metrics collection for the Stele SDK.
 *
 * Provides Counter, Gauge, Histogram, and a MetricsRegistry for
 * collecting operational metrics without any external dependencies.
 */

// ─── Snapshot interfaces ─────────────────────────────────────────────────────────

/** A point-in-time snapshot of histogram observations. */
export interface HistogramSnapshot {
  /** Total number of observations. */
  count: number;
  /** Sum of all observed values. */
  sum: number;
  /** Minimum observed value (Infinity if no observations). */
  min: number;
  /** Maximum observed value (-Infinity if no observations). */
  max: number;
  /** Arithmetic mean of all observations (0 if no observations). */
  avg: number;
  /** 50th percentile (median). */
  p50: number;
  /** 90th percentile. */
  p90: number;
  /** 95th percentile. */
  p95: number;
  /** 99th percentile. */
  p99: number;
  /** Cumulative counts per bucket boundary. Each key is `le_<boundary>`. */
  bucketCounts: Record<string, number>;
}

/** A point-in-time snapshot of all metrics in a registry. */
export interface MetricsSnapshot {
  /** Current counter values keyed by name. */
  counters: Record<string, number>;
  /** Current gauge values keyed by name. */
  gauges: Record<string, number>;
  /** Current histogram snapshots keyed by name. */
  histograms: Record<string, HistogramSnapshot>;
}

// ─── Counter ─────────────────────────────────────────────────────────────────────

/**
 * A monotonically increasing counter.
 *
 * Counters track cumulative values that only go up (e.g. total requests,
 * total errors). Use {@link Counter.reset} to explicitly zero it out.
 */
export class Counter {
  readonly name: string;
  readonly description: string;
  private value = 0;

  constructor(name: string, description?: string) {
    this.name = name;
    this.description = description ?? '';
  }

  /**
   * Increment the counter by 1 or by the given positive value.
   *
   * @param value - Amount to add (defaults to 1). Must be >= 0.
   */
  increment(value?: number): void {
    const v = value ?? 1;
    if (v < 0) {
      throw new Error('Counter increment value must be non-negative');
    }
    this.value += v;
  }

  /** Return the current counter value. */
  get(): number {
    return this.value;
  }

  /** Reset the counter to zero. */
  reset(): void {
    this.value = 0;
  }
}

// ─── Gauge ───────────────────────────────────────────────────────────────────────

/**
 * A gauge that can go up and down.
 *
 * Gauges track values that fluctuate (e.g. active connections,
 * current queue depth, temperature).
 */
export class Gauge {
  readonly name: string;
  readonly description: string;
  private value = 0;

  constructor(name: string, description?: string) {
    this.name = name;
    this.description = description ?? '';
  }

  /** Set the gauge to an exact value. */
  set(value: number): void {
    this.value = value;
  }

  /**
   * Increment the gauge by 1 or by the given value.
   *
   * @param value - Amount to add (defaults to 1).
   */
  increment(value?: number): void {
    this.value += value ?? 1;
  }

  /**
   * Decrement the gauge by 1 or by the given value.
   *
   * @param value - Amount to subtract (defaults to 1).
   */
  decrement(value?: number): void {
    this.value -= value ?? 1;
  }

  /** Return the current gauge value. */
  get(): number {
    return this.value;
  }
}

// ─── Histogram ───────────────────────────────────────────────────────────────────

/** Default bucket boundaries used when none are supplied. */
const DEFAULT_BUCKETS: readonly number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

/**
 * A histogram that records observed values and computes percentiles.
 *
 * Observations are stored in memory so percentile calculations are exact.
 * For high-cardinality production use you may want a streaming quantile
 * algorithm, but for SDK-level telemetry this is sufficient.
 */
export class Histogram {
  readonly name: string;
  readonly description: string;
  readonly buckets: readonly number[];
  private observations: number[] = [];

  constructor(name: string, buckets?: number[], description?: string) {
    this.name = name;
    this.description = description ?? '';
    this.buckets = buckets ? [...buckets].sort((a, b) => a - b) : DEFAULT_BUCKETS;
  }

  /**
   * Record an observed value.
   *
   * @param value - The value to record.
   */
  observe(value: number): void {
    this.observations.push(value);
  }

  /**
   * Return a point-in-time snapshot of all recorded observations.
   *
   * Percentiles are computed using nearest-rank interpolation on the sorted
   * observation set. Bucket counts are cumulative — each bucket key
   * `le_<boundary>` counts all observations <= that boundary.
   */
  get(): HistogramSnapshot {
    const count = this.observations.length;

    if (count === 0) {
      const bucketCounts: Record<string, number> = {};
      for (const b of this.buckets) {
        bucketCounts[`le_${b}`] = 0;
      }
      return {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        bucketCounts,
      };
    }

    const sorted = [...this.observations].sort((a, b) => a - b);

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.observations) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const avg = sum / count;

    const percentile = (p: number): number => {
      const rank = Math.ceil((p / 100) * count) - 1;
      return sorted[Math.max(0, rank)] ?? 0;
    };

    const bucketCounts: Record<string, number> = {};
    for (const b of this.buckets) {
      let c = 0;
      for (const v of this.observations) {
        if (v <= b) c++;
      }
      bucketCounts[`le_${b}`] = c;
    }

    return {
      count,
      sum,
      min,
      max,
      avg,
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      bucketCounts,
    };
  }

  /** Reset the histogram, discarding all recorded observations. */
  reset(): void {
    this.observations = [];
  }
}

// ─── MetricsRegistry ─────────────────────────────────────────────────────────────

/**
 * Central registry that manages named Counter, Gauge, and Histogram instances.
 *
 * Uses get-or-create semantics: requesting the same name twice returns the
 * same metric instance so callers don't need to coordinate.
 */
export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  /**
   * Get or create a counter with the given name.
   *
   * If a counter with this name already exists, the existing instance is
   * returned and the description parameter is ignored.
   */
  counter(name: string, description?: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, description);
      this.counters.set(name, c);
    }
    return c;
  }

  /**
   * Get or create a gauge with the given name.
   *
   * If a gauge with this name already exists, the existing instance is
   * returned and the description parameter is ignored.
   */
  gauge(name: string, description?: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, description);
      this.gauges.set(name, g);
    }
    return g;
  }

  /**
   * Get or create a histogram with the given name.
   *
   * If a histogram with this name already exists, the existing instance is
   * returned and the buckets/description parameters are ignored.
   */
  histogram(name: string, buckets?: number[], description?: string): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, buckets, description);
      this.histograms.set(name, h);
    }
    return h;
  }

  /** Return a snapshot of all metrics in the registry. */
  getAll(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [name, c] of this.counters) {
      counters[name] = c.get();
    }

    const gauges: Record<string, number> = {};
    for (const [name, g] of this.gauges) {
      gauges[name] = g.get();
    }

    const histograms: Record<string, HistogramSnapshot> = {};
    for (const [name, h] of this.histograms) {
      histograms[name] = h.get();
    }

    return { counters, gauges, histograms };
  }

  /** Reset all metrics in the registry to their initial state. */
  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.set(0);
    for (const h of this.histograms.values()) h.reset();
  }

  /** Return a JSON-serializable snapshot of all metrics. */
  toJSON(): Record<string, unknown> {
    const snapshot = this.getAll();
    return {
      counters: snapshot.counters,
      gauges: snapshot.gauges,
      histograms: snapshot.histograms,
    };
  }
}

// ─── Factory & default instance ──────────────────────────────────────────────────

/**
 * Create a new, empty MetricsRegistry.
 *
 * Useful when you want isolated registries for different subsystems.
 */
export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry();
}

/**
 * Pre-created global metrics registry.
 *
 * Most callers should use this rather than creating their own registry
 * so that metrics are centrally visible.
 */
export const defaultMetrics: MetricsRegistry = createMetricsRegistry();
