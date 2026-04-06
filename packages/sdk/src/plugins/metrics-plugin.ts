/**
 * Metrics middleware plugin for the Nobulex SDK.
 *
 * Automatically records operational metrics using the @nobulex/types
 * MetricsRegistry. Tracks total operations, errors, duration, and
 * active operation count.
 */

import { MetricsRegistry, createMetricsRegistry } from '@nobulex/types';
import type { NobulexMiddleware, MiddlewareContext } from '../middleware.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration options for the metrics middleware. */
export interface MetricsPluginOptions {
  /** Optional pre-existing MetricsRegistry to use. Creates a new one if omitted. */
  registry?: MetricsRegistry;
  /** Prefix for all metric names. Default: "nobulex". */
  prefix?: string;
}

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * Create a metrics middleware that records operational telemetry.
 *
 * Records the following metrics (prefixed with the configured prefix):
 * - `{prefix}.operations.total` — Counter: total operations by name
 * - `{prefix}.operations.errors` — Counter: total errors by name
 * - `{prefix}.operations.duration` — Histogram: operation duration in ms
 * - `{prefix}.operations.active` — Gauge: currently active operations
 *
 * @param options - Optional metrics configuration.
 * @returns A NobulexMiddleware with an exposed `registry` property.
 */
export function metricsMiddleware(
  options?: MetricsPluginOptions,
): NobulexMiddleware & { registry: MetricsRegistry } {
  const registry = options?.registry ?? createMetricsRegistry();
  const prefix = options?.prefix ?? 'nobulex';

  const totalCounter = registry.counter(
    `${prefix}.operations.total`,
    'Total number of operations',
  );
  const errorCounter = registry.counter(
    `${prefix}.operations.errors`,
    'Total number of operation errors',
  );
  const durationHistogram = registry.histogram(
    `${prefix}.operations.duration`,
    [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    'Operation duration in milliseconds',
  );
  const activeGauge = registry.gauge(
    `${prefix}.operations.active`,
    'Number of currently active operations',
  );

  const middleware: NobulexMiddleware & { registry: MetricsRegistry } = {
    name: 'metrics',

    async before(ctx: MiddlewareContext) {
      totalCounter.increment();
      activeGauge.increment();
      ctx.metadata._metricsStart = performance.now();
      return { proceed: true };
    },

    async after(ctx: MiddlewareContext, result: unknown) {
      activeGauge.decrement();
      const start = ctx.metadata._metricsStart as number;
      if (typeof start === 'number') {
        const duration = performance.now() - start;
        durationHistogram.observe(duration);
        delete ctx.metadata._metricsStart;
      }
      return result;
    },

    async onError(ctx: MiddlewareContext, _error: Error) {
      errorCounter.increment();
      activeGauge.decrement();
      const start = ctx.metadata._metricsStart as number;
      if (typeof start === 'number') {
        const duration = performance.now() - start;
        durationHistogram.observe(duration);
        delete ctx.metadata._metricsStart;
      }
    },

    registry,
  };

  return middleware;
}
