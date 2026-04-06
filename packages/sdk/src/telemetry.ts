/**
 * OpenTelemetry-compatible instrumentation for the Nobulex SDK.
 *
 * Follows the "bring your own tracer" pattern: all OTel interfaces are
 * defined inline so consumers can plug in their own OTel SDK without
 * introducing any external dependency on `@opentelemetry/*` packages.
 *
 * @packageDocumentation
 */

import type { NobulexMiddleware, MiddlewareContext, MiddlewareResult } from './middleware.js';
import type {
  NobulexEventType,
  NobulexEventMap,
  NobulexEvent,
  CovenantCreatedEvent,
  CovenantVerifiedEvent,
  EvaluationCompletedEvent,
} from './types.js';

// ─── OTel-compatible interfaces ──────────────────────────────────────────────

/** Status code constants compatible with @opentelemetry/api SpanStatusCode. */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/** Minimal Span interface compatible with @opentelemetry/api. */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: Error): void;
  end(): void;
}

/** Minimal Tracer interface compatible with @opentelemetry/api. */
export interface Tracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): Span;
}

/** Minimal Counter interface compatible with @opentelemetry/api. */
export interface Counter {
  add(value: number, attributes?: Record<string, string>): void;
}

/** Minimal Histogram interface compatible with @opentelemetry/api. */
export interface Histogram {
  record(value: number, attributes?: Record<string, string>): void;
}

/** Minimal Meter interface compatible with @opentelemetry/api. */
export interface Meter {
  createCounter(name: string, options?: { description?: string }): Counter;
  createHistogram(name: string, options?: { description?: string }): Histogram;
}

// ─── No-op implementations ──────────────────────────────────────────────────

/** No-op Span that silently discards all calls. */
export class NoopSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_status: { code: number; message?: string }): void {}
  recordException(_error: Error): void {}
  end(): void {}
}

/** No-op Counter that silently discards all calls. */
export class NoopCounter implements Counter {
  add(_value: number, _attributes?: Record<string, string>): void {}
}

/** No-op Histogram that silently discards all calls. */
export class NoopHistogram implements Histogram {
  record(_value: number, _attributes?: Record<string, string>): void {}
}

/** No-op Tracer that returns NoopSpan instances. */
export class NoopTracer implements Tracer {
  startSpan(_name: string, _options?: { attributes?: Record<string, string | number | boolean> }): Span {
    return new NoopSpan();
  }
}

/** No-op Meter that returns NoopCounter and NoopHistogram instances. */
export class NoopMeter implements Meter {
  createCounter(_name: string, _options?: { description?: string }): Counter {
    return new NoopCounter();
  }
  createHistogram(_name: string, _options?: { description?: string }): Histogram {
    return new NoopHistogram();
  }
}

// ─── Telemetry middleware ────────────────────────────────────────────────────

/** Options for the telemetry middleware. */
export interface TelemetryMiddlewareOptions {
  /** Tracer instance for creating spans. Defaults to NoopTracer. */
  tracer?: Tracer;
}

/**
 * Create a NobulexMiddleware that wraps each operation with an OTel span.
 *
 * For every operation that passes through the middleware pipeline, this
 * middleware:
 * - Creates a span named after the operation (e.g. `nobulex.createCovenant`)
 * - Sets attributes: `nobulex.operation`, and any result-specific attributes
 *   such as `nobulex.covenant.id`, `nobulex.evaluation.permitted`
 * - Records duration via `nobulex.duration_ms`
 * - Sets the span status to OK or ERROR
 * - Records exceptions on failure
 *
 * @param options - Optional configuration with a custom tracer.
 * @returns A NobulexMiddleware instance.
 */
export function telemetryMiddleware(options?: TelemetryMiddlewareOptions): NobulexMiddleware {
  const tracer = options?.tracer ?? new NoopTracer();

  return {
    name: 'telemetry',

    async before(ctx: MiddlewareContext): Promise<MiddlewareResult> {
      const span = tracer.startSpan(`nobulex.${ctx.operation}`, {
        attributes: {
          'nobulex.operation': ctx.operation,
        },
      });
      ctx.metadata._telemetrySpan = span;
      ctx.metadata._telemetryStart = performance.now();
      return { proceed: true };
    },

    async after(ctx: MiddlewareContext, result: unknown): Promise<unknown> {
      const span = ctx.metadata._telemetrySpan as Span | undefined;
      if (span) {
        const start = ctx.metadata._telemetryStart as number;
        const durationMs = performance.now() - start;
        span.setAttribute('nobulex.duration_ms', durationMs);

        // Set result-specific attributes
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if ('id' in r && typeof r.id === 'string') {
            span.setAttribute('nobulex.covenant.id', r.id);
          }
          if ('valid' in r && typeof r.valid === 'boolean') {
            span.setAttribute('nobulex.verification.valid', r.valid);
          }
          if ('permitted' in r && typeof r.permitted === 'boolean') {
            span.setAttribute('nobulex.evaluation.permitted', r.permitted);
          }
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        delete ctx.metadata._telemetrySpan;
        delete ctx.metadata._telemetryStart;
      }
      return result;
    },

    async onError(ctx: MiddlewareContext, error: Error): Promise<void> {
      const span = ctx.metadata._telemetrySpan as Span | undefined;
      if (span) {
        const start = ctx.metadata._telemetryStart as number;
        const durationMs = performance.now() - start;
        span.setAttribute('nobulex.duration_ms', durationMs);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.recordException(error);
        span.end();

        delete ctx.metadata._telemetrySpan;
        delete ctx.metadata._telemetryStart;
      }
    },
  };
}

// ─── NobulexMetrics ───────────────────────────────────────────────────────────

/**
 * A minimal interface for an object that exposes `on()` for event subscription.
 *
 * This matches NobulexClient's public API without importing the class directly,
 * keeping the telemetry module loosely coupled.
 */
export interface EventSource {
  on<T extends NobulexEventType>(event: T, handler: (data: NobulexEventMap[T]) => void): () => void;
}

/**
 * Metrics collector for Nobulex SDK operations.
 *
 * Creates OTel-compatible counters and histograms and exposes a `record()`
 * method to update them from NobulexClient lifecycle events.
 */
export class NobulexMetrics {
  private readonly _covenantsCreated: Counter;
  private readonly _covenantsVerified: Counter;
  private readonly _evaluationsTotal: Counter;
  private readonly _evaluationsDenied: Counter;
  private readonly _operationDuration: Histogram;

  constructor(meter: Meter) {
    this._covenantsCreated = meter.createCounter('nobulex.covenants.created', {
      description: 'Number of covenants created',
    });
    this._covenantsVerified = meter.createCounter('nobulex.covenants.verified', {
      description: 'Number of covenants verified',
    });
    this._evaluationsTotal = meter.createCounter('nobulex.evaluations.total', {
      description: 'Total number of evaluations performed',
    });
    this._evaluationsDenied = meter.createCounter('nobulex.evaluations.denied', {
      description: 'Number of evaluations that were denied',
    });
    this._operationDuration = meter.createHistogram('nobulex.operation.duration', {
      description: 'Duration of operations in milliseconds',
    });
  }

  /**
   * Record a NobulexClient event, updating the appropriate metrics.
   *
   * @param event - A NobulexClient lifecycle event (from the `on()` callback).
   */
  record(event: NobulexEvent): void {
    switch (event.type) {
      case 'covenant:created':
        this._covenantsCreated.add(1);
        break;

      case 'covenant:verified':
        this._covenantsVerified.add(1);
        break;

      case 'evaluation:completed': {
        const evalEvent = event as EvaluationCompletedEvent;
        this._evaluationsTotal.add(1);
        if (!evalEvent.result.permitted) {
          this._evaluationsDenied.add(1);
        }
        break;
      }

      default:
        // Other event types are observed but do not drive specific counters.
        break;
    }
  }

  /**
   * Record an operation duration.
   *
   * @param durationMs - Duration in milliseconds.
   * @param attributes - Optional attributes to attach to the measurement.
   */
  recordDuration(durationMs: number, attributes?: Record<string, string>): void {
    this._operationDuration.record(durationMs, attributes);
  }

  /**
   * Subscribe to all NobulexClient events and automatically record metrics.
   *
   * @param client - An object with an `on()` method matching NobulexClient's API.
   * @returns An array of disposal functions that unsubscribe all listeners.
   */
  bindToClient(client: EventSource): (() => void)[] {
    const disposers: (() => void)[] = [];

    const eventTypes: NobulexEventType[] = [
      'covenant:created',
      'covenant:verified',
      'covenant:countersigned',
      'identity:created',
      'identity:evolved',
      'chain:resolved',
      'chain:validated',
      'evaluation:completed',
    ];

    for (const eventType of eventTypes) {
      const dispose = client.on(eventType, (data) => {
        this.record(data as NobulexEvent);
      });
      disposers.push(dispose);
    }

    return disposers;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/** Options for the `createTelemetry` factory. */
export interface CreateTelemetryOptions {
  /** Tracer for span creation. Defaults to NoopTracer. */
  tracer?: Tracer;
  /** Meter for metrics collection. Defaults to NoopMeter. */
  meter?: Meter;
}

/**
 * Create a matched pair of telemetry middleware and metrics collector.
 *
 * This is the recommended entry point for instrumenting the Nobulex SDK.
 * If no tracer or meter is provided, no-op implementations are used
 * so that application code compiles and runs without any OTel dependency.
 *
 * @param options - Optional tracer and meter instances.
 * @returns An object containing the middleware and metrics instances.
 *
 * @example
 * ```typescript
 * import { createTelemetry } from '@nobulex/sdk';
 *
 * // With real OTel SDK:
 * const { middleware, metrics } = createTelemetry({
 *   tracer: otelTrace.getTracer('my-app'),
 *   meter: otelMetrics.getMeter('my-app'),
 * });
 *
 * // Without OTel (no-op, zero overhead):
 * const { middleware, metrics } = createTelemetry();
 * ```
 */
export function createTelemetry(options?: CreateTelemetryOptions): {
  middleware: NobulexMiddleware;
  metrics: NobulexMetrics;
} {
  const tracer = options?.tracer ?? new NoopTracer();
  const meter = options?.meter ?? new NoopMeter();

  return {
    middleware: telemetryMiddleware({ tracer }),
    metrics: new NobulexMetrics(meter),
  };
}
