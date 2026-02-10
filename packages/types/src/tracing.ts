/**
 * Lightweight tracing utilities for the Stele SDK.
 * Provides Span-based instrumentation without OpenTelemetry dependency.
 *
 * @packageDocumentation
 */

import { generateId } from '@stele/crypto';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Status of a completed span. */
export type SpanStatus = 'ok' | 'error';

/** An event recorded during the lifetime of a span. */
export interface SpanEvent {
  /** Human-readable name of the event. */
  name: string;
  /** ISO 8601 timestamp when the event occurred. */
  timestamp: string;
  /** Optional key-value attributes attached to the event. */
  attributes?: Record<string, unknown>;
}

/**
 * A completed or in-progress span representing a unit of work.
 *
 * Spans form a tree via `parentSpanId` references, sharing a common
 * `traceId` across the entire distributed trace.
 */
export interface Span {
  /** Unique identifier for the entire trace. */
  traceId: string;
  /** Unique identifier for this span within the trace. */
  spanId: string;
  /** Human-readable name describing the operation. */
  name: string;
  /** ISO 8601 timestamp when the span started. */
  startTime: string;
  /** ISO 8601 timestamp when the span ended (undefined while active). */
  endTime?: string;
  /** Final status of the span. */
  status: SpanStatus;
  /** Key-value attributes attached to the span. */
  attributes: Record<string, unknown>;
  /** Events recorded during the span's lifetime. */
  events: SpanEvent[];
  /** Span ID of the parent span (undefined for root spans). */
  parentSpanId?: string;
  /** Duration in milliseconds (set when the span ends). */
  durationMs?: number;
}

/**
 * Receives completed spans for collection, export, or analysis.
 */
export interface SpanCollector {
  /** Called when a span ends. */
  onSpanEnd(span: Span): void;
}

// ─── ActiveSpan ─────────────────────────────────────────────────────────────────

/**
 * A mutable, in-progress span that can accumulate attributes and events
 * before being finalized via {@link ActiveSpan.end}.
 */
export class ActiveSpan {
  /** Unique identifier for the entire trace. */
  readonly traceId: string;
  /** Unique identifier for this span. */
  readonly spanId: string;
  /** Human-readable name of the operation. */
  readonly name: string;

  private _isEnded = false;
  private _status: SpanStatus = 'ok';
  private readonly _startTime: string;
  private readonly _attributes: Record<string, unknown>;
  private readonly _events: SpanEvent[] = [];
  private readonly _parentSpanId?: string;
  private readonly _tracer: Tracer;

  /** @internal — use {@link Tracer.startSpan} instead. */
  constructor(
    traceId: string,
    spanId: string,
    name: string,
    tracer: Tracer,
    attributes?: Record<string, unknown>,
    parentSpanId?: string,
  ) {
    this.traceId = traceId;
    this.spanId = spanId;
    this.name = name;
    this._tracer = tracer;
    this._startTime = new Date().toISOString();
    this._attributes = { ...attributes };
    this._parentSpanId = parentSpanId;
  }

  /** Whether this span has already been ended. */
  get isEnded(): boolean {
    return this._isEnded;
  }

  /**
   * Set a key-value attribute on this span.
   *
   * @throws Error if the span has already ended.
   */
  setAttribute(key: string, value: unknown): void {
    this._assertNotEnded();
    this._attributes[key] = value;
  }

  /**
   * Record a timestamped event on this span.
   *
   * @throws Error if the span has already ended.
   */
  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this._assertNotEnded();
    const event: SpanEvent = {
      name,
      timestamp: new Date().toISOString(),
      ...(attributes !== undefined ? { attributes } : {}),
    };
    this._events.push(event);
  }

  /**
   * Set the final status of this span.
   *
   * @throws Error if the span has already ended.
   */
  setStatus(status: SpanStatus): void {
    this._assertNotEnded();
    this._status = status;
  }

  /**
   * Finalize this span, computing its duration and notifying the tracer.
   *
   * @returns The completed {@link Span} record.
   * @throws Error if the span has already ended.
   */
  end(): Span {
    this._assertNotEnded();
    this._isEnded = true;
    const endTime = new Date().toISOString();
    const durationMs =
      new Date(endTime).getTime() - new Date(this._startTime).getTime();

    const span: Span = {
      traceId: this.traceId,
      spanId: this.spanId,
      name: this.name,
      startTime: this._startTime,
      endTime,
      status: this._status,
      attributes: { ...this._attributes },
      events: [...this._events],
      ...(this._parentSpanId !== undefined
        ? { parentSpanId: this._parentSpanId }
        : {}),
      durationMs,
    };

    this._tracer['_onSpanEnd'](span, this);
    return span;
  }

  /**
   * Create a child span that shares this span's trace ID and references
   * this span as its parent.
   */
  child(name: string, attributes?: Record<string, unknown>): ActiveSpan {
    this._assertNotEnded();
    const childSpanId = generateId(16);
    const child = new ActiveSpan(
      this.traceId,
      childSpanId,
      name,
      this._tracer,
      attributes,
      this.spanId,
    );
    this._tracer['_activeSpans'].push(child);
    return child;
  }

  /** @internal */
  private _assertNotEnded(): void {
    if (this._isEnded) {
      throw new Error(`Span "${this.name}" has already ended`);
    }
  }
}

// ─── Tracer ─────────────────────────────────────────────────────────────────────

/** Options for creating a {@link Tracer}. */
export interface TracerOptions {
  /** Logical service name attached to spans. */
  serviceName?: string;
  /** Optional collector that receives completed spans. */
  collector?: SpanCollector;
}

/**
 * Lightweight tracer that creates and manages spans.
 *
 * ```ts
 * const tracer = createTracer({ serviceName: 'my-service' });
 * const span = tracer.startSpan('operation');
 * span.setAttribute('key', 'value');
 * span.end();
 * ```
 */
export class Tracer {
  private readonly _serviceName?: string;
  private readonly _collector?: SpanCollector;
  private readonly _activeSpans: ActiveSpan[] = [];
  private readonly _completedSpans: Span[] = [];

  constructor(options?: TracerOptions) {
    this._serviceName = options?.serviceName;
    this._collector = options?.collector;
  }

  /**
   * Start a new root span.
   *
   * @param name       - Human-readable name for the operation.
   * @param attributes - Optional initial attributes.
   */
  startSpan(name: string, attributes?: Record<string, unknown>): ActiveSpan {
    const traceId = generateId(16);
    const spanId = generateId(16);
    const baseAttributes: Record<string, unknown> = {
      ...(this._serviceName !== undefined
        ? { 'service.name': this._serviceName }
        : {}),
      ...attributes,
    };
    const span = new ActiveSpan(traceId, spanId, name, this, baseAttributes);
    this._activeSpans.push(span);
    return span;
  }

  /** Return all spans that are currently active (not yet ended). */
  getActiveSpans(): ActiveSpan[] {
    return [...this._activeSpans];
  }

  /** Return all completed span records. */
  getCompletedSpans(): Span[] {
    return [...this._completedSpans];
  }

  /** Clear the list of completed spans. */
  clearCompletedSpans(): void {
    this._completedSpans.length = 0;
  }

  /** @internal — called by ActiveSpan.end() */
  private _onSpanEnd(span: Span, active: ActiveSpan): void {
    const idx = this._activeSpans.indexOf(active);
    if (idx !== -1) {
      this._activeSpans.splice(idx, 1);
    }
    this._completedSpans.push(span);
    this._collector?.onSpanEnd(span);
  }
}

// ─── InMemoryCollector ──────────────────────────────────────────────────────────

/**
 * A {@link SpanCollector} that accumulates spans in an in-memory array.
 *
 * Useful for testing and debugging.
 */
export class InMemoryCollector implements SpanCollector {
  private readonly _spans: Span[] = [];

  /** Receive a completed span. */
  onSpanEnd(span: Span): void {
    this._spans.push(span);
  }

  /** Return all collected spans. */
  getSpans(): Span[] {
    return [...this._spans];
  }

  /** Clear all collected spans. */
  clear(): void {
    this._spans.length = 0;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create a new {@link Tracer} instance.
 *
 * Convenience wrapper around `new Tracer(options)`.
 */
export function createTracer(options?: TracerOptions): Tracer {
  return new Tracer(options);
}
