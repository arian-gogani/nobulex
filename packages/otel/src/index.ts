// Separate package so teams that already run OpenTelemetry can drop this
// in without dragging the rest of the SDK along, and teams that don't use
// otel don't pay for it. The otel API surface is also large enough that
// version-pinning it independently of the core saves us some pain.

/**
 * @nobulex/otel -- Production-grade OpenTelemetry SpanProcessor for evidence generation.
 *
 * Intercepts OTel spans, extracts action metadata, generates signed evidence items,
 * and feeds them to a Merkle epoch aggregator. Supports span filtering, batch
 * processing, retry policies, metrics collection, multiple exporters, processor
 * pipelines, and span enrichment.
 *
 * Minimal integration:
 * ```typescript
 * import { EvidenceSpanProcessor } from '@nobulex/otel';
 * const processor = new EvidenceSpanProcessor({ agentDid, keyPair });
 * provider.addSpanProcessor(processor);
 * ```
 *
 */

import {
  sha256String,
  timestamp as nowISO,
  canonicalizeJson,
} from '@nobulex/crypto';
import type { KeyPair } from '@nobulex/crypto';
import type { EvidenceItem, EvidenceInput } from '@nobulex/evidence-core';
import { EvidenceChainBuilder } from '@nobulex/evidence-core';
import { EpochAggregator } from '@nobulex/merkle';
import type { EpochConfig, Epoch } from '@nobulex/merkle';

// ============================================================================
// OTel-compatible interfaces
// ============================================================================

// Minimal OTel-compatible Span interface
export interface ReadableSpan {
  readonly name: string;
  readonly kind: number;
  readonly startTime: readonly [number, number]; // [seconds, nanoseconds]
  readonly endTime: readonly [number, number];
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  readonly status: { readonly code: number; readonly message?: string };
  readonly parentSpanId?: string;
  readonly spanContext: () => { readonly traceId: string; readonly spanId: string };
}

// OTel attribute value
export type AttributeValue = string | number | boolean | undefined;

/** Minimal OTel SpanProcessor interface. */
export interface SpanProcessor {
  onStart(span: ReadableSpan): void;
  onEnd(span: ReadableSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

// ============================================================================
// 1. Span Filtering Rules
// ============================================================================

/** A single span filter rule descriptor. */
export interface SpanFilterRule {
  readonly type: 'include-name' | 'exclude-name' | 'include-attr' | 'exclude-attr'
    | 'min-duration' | 'max-duration' | 'include-kind';
  readonly pattern?: string | RegExp;
  readonly key?: string;
  readonly value?: AttributeValue;
  readonly durationMs?: number;
  readonly kind?: number;
}

/** Compiled filter function that accepts a span and returns true to keep it. */
export type SpanFilterFn = (span: ReadableSpan) => boolean;

/** Compute span duration in milliseconds from hrtime tuples. */
function spanDurationMs(span: ReadableSpan): number {
  const startMs = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
  const endMs = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;
  // edge case: empty input is handled by the guard above
  return endMs - startMs;
}

// Test whether a string matches a pattern (string equality or RegExp)
function matchesPattern(value: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(value);
  }
  return value === pattern;
}

/**
 * Fluent builder for composing span filter rules.
 *
 * Include rules form a union (any match keeps the span). Exclude rules
 * are applied after includes -- any exclude match drops the span.
 * Duration and kind constraints are AND-ed.
 */
export class FilterBuilder {
  private readonly rules: SpanFilterRule[] = [];

  /** Include spans whose name matches the pattern (string or RegExp). */
  includeByName(pattern: string | RegExp): this {
    this.rules.push({ type: 'include-name', pattern });
    return this;
  }

  /** Exclude spans whose name matches the pattern. */
  excludeByName(pattern: string | RegExp): this {
    this.rules.push({ type: 'exclude-name', pattern });
    return this;
  }

  // Include spans that have the given attribute key/value pair
  includeByAttribute(key: string, value: AttributeValue): this {
    this.rules.push({ type: 'include-attr', key, value });
    return this;
  }

  /** Exclude spans that have the given attribute key/value pair. */
  excludeByAttribute(key: string, value: AttributeValue): this {
    this.rules.push({ type: 'exclude-attr', key, value });
    return this;
  }

  /** Only include spans with at least the given duration. */
  minDuration(ms: number): this {
    this.rules.push({ type: 'min-duration', durationMs: ms });
    return this;
  }

  /** Only include spans with at most the given duration. */
  maxDuration(ms: number): this {
    this.rules.push({ type: 'max-duration', durationMs: ms });
    return this;
  }

  // Only include spans of the given OTel span kind
  includeByKind(kind: number): this {
    this.rules.push({ type: 'include-kind', kind });
    return this;
  }

  // Return the accumulated rules array
  getRules(): readonly SpanFilterRule[] {
    return [...this.rules];
  }

  /** Compile accumulated rules into a single filter function. */
  build(): SpanFilterFn {
    const includeNameRules = this.rules.filter(r => r.type === 'include-name');
    const excludeNameRules = this.rules.filter(r => r.type === 'exclude-name');
    const includeAttrRules = this.rules.filter(r => r.type === 'include-attr');
    const excludeAttrRules = this.rules.filter(r => r.type === 'exclude-attr');
    const minDurationRules = this.rules.filter(r => r.type === 'min-duration');
    const maxDurationRules = this.rules.filter(r => r.type === 'max-duration');
    const includeKindRules = this.rules.filter(r => r.type === 'include-kind');

    return (span: ReadableSpan): boolean => {
      // Evaluate include-name rules: if any exist, span must match at least one
      if (includeNameRules.length > 0) {
        const anyNameMatch = includeNameRules.some(r => matchesPattern(span.name, r.pattern!));
        if (!anyNameMatch) return false;
      }

      // Evaluate include-attr rules: if any exist, span must match at least one
      if (includeAttrRules.length > 0) {
        const anyAttrMatch = includeAttrRules.some(
          r => span.attributes[r.key!] === r.value,
        );
        if (!anyAttrMatch) return false;
      }

      // Evaluate include-kind rules: if any exist, span must match at least one
      if (includeKindRules.length > 0) {
        const anyKindMatch = includeKindRules.some(r => span.kind === r.kind);
        if (!anyKindMatch) return false;
      }

      // Evaluate exclude-name rules: any match drops the span
      for (const rule of excludeNameRules) {
        if (matchesPattern(span.name, rule.pattern!)) return false;
      }

      // Evaluate exclude-attr rules: any match drops the span
      for (const rule of excludeAttrRules) {
        if (span.attributes[rule.key!] === rule.value) return false;
      }

      // Duration constraints are AND-ed
      const duration = spanDurationMs(span);
      for (const rule of minDurationRules) {
        if (duration < rule.durationMs!) return false;
      }
      for (const rule of maxDurationRules) {
        if (duration > rule.durationMs!) return false;
      }

      return true;
    };
  }
}

/**
 * Convenience: create a filter function that matches spans by attribute key/value.
 */
export function createAttributeFilter(key: string, value: AttributeValue): SpanFilterFn {
  return (span: ReadableSpan) => span.attributes[key] === value;
}

/**
 * Convenience: create a filter function that matches spans by name pattern.
 * Accepts a string (exact match) or RegExp.
 */
export function createNameFilter(pattern: string | RegExp): SpanFilterFn {
  return (span: ReadableSpan) => matchesPattern(span.name, pattern);
}

/**
 * Convenience: create a filter function that matches spans by kind.
 * Accepts one or more span kind numbers.
 */
export function createKindFilter(kinds: number | number[]): SpanFilterFn {
  const kindSet = new Set(Array.isArray(kinds) ? kinds : [kinds]);
  return (span: ReadableSpan) => kindSet.has(span.kind);
}

// Compose multiple filter functions using AND or OR logic
export class SpanFilterChain {
  private readonly filters: SpanFilterFn[];
  private readonly mode: 'and' | 'or';

  /**
   * @param filters - Array of filter functions to compose.
   * @param mode - 'and' requires all filters to pass; 'or' requires at least one.
   */
  constructor(filters: SpanFilterFn[], mode: 'and' | 'or' = 'and') {
    this.filters = [...filters];
    this.mode = mode;
  }

  /** Add a filter to the chain. */
  add(filter: SpanFilterFn): this {
    this.filters.push(filter);
    return this;
  }

  /** Get the number of filters in the chain. */
  get length(): number {
    return this.filters.length;
  }

  /** Evaluate the filter chain against a span. */
  evaluate(span: ReadableSpan): boolean {
    if (this.filters.length === 0) return true;
    if (this.mode === 'and') {
      return this.filters.every(f => f(span));
    }
    return this.filters.some(f => f(span));
  }

  /** Return the composed filter as a single SpanFilterFn. */
  toFilter(): SpanFilterFn {
    return (span: ReadableSpan) => this.evaluate(span);
  }
}

// ============================================================================
// 2. Custom Attribute Extraction
// ============================================================================

/** Extracted evidence-relevant attributes from a span. */
export interface ExtractedAttributes {
  readonly toolName?: string;
  readonly actionType?: string;
  readonly inputHash?: string;
  readonly outputHash?: string;
}

// Interface for extracting evidence-relevant attributes from a span
export interface AttributeExtractor {
  /** Name of this extractor for debugging. */
  readonly name: string;
  /** Returns true if this extractor can handle the given span. */
  canExtract(span: ReadableSpan): boolean;
  /** Extract evidence-relevant attributes from the span. */
  extract(span: ReadableSpan): ExtractedAttributes;
}

// Mapping definition for creating custom extractors
export interface AttributeMapping {
  // Span attribute key to read the tool name from
  readonly toolNameKey?: string;
  /** Span attribute key to read the action type from. */
  readonly actionTypeKey?: string;
  /** Span attribute keys whose values are hashed to produce inputHash. */
  readonly inputKeys?: readonly string[];
  /** Span attribute keys whose values are hashed to produce outputHash. */
  readonly outputKeys?: readonly string[];
  // A predicate to check if this mapping applies
  readonly predicate?: (span: ReadableSpan) => boolean;
}

/** Create a custom AttributeExtractor from a mapping definition. */
export function createExtractor(name: string, mapping: AttributeMapping): AttributeExtractor {
  return {
    name,
    canExtract(span: ReadableSpan): boolean {
      if (mapping.predicate) return mapping.predicate(span);
      // Default: check if any expected keys are present
      const keys = [
        mapping.toolNameKey,
        mapping.actionTypeKey,
        ...(mapping.inputKeys ?? []),
        ...(mapping.outputKeys ?? []),
      ].filter(Boolean) as string[];
      return keys.some(k => span.attributes[k] !== undefined);
    },
    extract(span: ReadableSpan): ExtractedAttributes {
      const result: Record<string, string | undefined> = {};

      if (mapping.toolNameKey && span.attributes[mapping.toolNameKey] !== undefined) {
        result.toolName = String(span.attributes[mapping.toolNameKey]);
      }
      if (mapping.actionTypeKey && span.attributes[mapping.actionTypeKey] !== undefined) {
        result.actionType = String(span.attributes[mapping.actionTypeKey]);
      }
      if (mapping.inputKeys && mapping.inputKeys.length > 0) {
        const inputData: Record<string, AttributeValue> = {};
        for (const k of mapping.inputKeys) {
          if (span.attributes[k] !== undefined) {
            inputData[k] = span.attributes[k];
          }
        }
        if (Object.keys(inputData).length > 0) {
          result.inputHash = sha256String(canonicalizeJson(inputData));
        }
      }
      if (mapping.outputKeys && mapping.outputKeys.length > 0) {
        const outputData: Record<string, AttributeValue> = {};
        for (const k of mapping.outputKeys) {
          if (span.attributes[k] !== undefined) {
            outputData[k] = span.attributes[k];
          }
        }
        if (Object.keys(outputData).length > 0) {
          result.outputHash = sha256String(canonicalizeJson(outputData));
        }
      }

      return result as ExtractedAttributes;
    },
  };
}

/** Built-in extractor for HTTP spans. Extracts method, url, status_code. */
export const httpExtractor: AttributeExtractor = createExtractor('http', {
  toolNameKey: 'http.method',
  actionTypeKey: 'http.method',
  inputKeys: ['http.method', 'http.url'],
  outputKeys: ['http.status_code'],
  predicate: (span) =>
    span.attributes['http.method'] !== undefined ||
    span.attributes['http.url'] !== undefined,
});

/** Built-in extractor for RPC spans. Extracts service, method. */
export const rpcExtractor: AttributeExtractor = createExtractor('rpc', {
  toolNameKey: 'rpc.method',
  actionTypeKey: 'rpc.system',
  inputKeys: ['rpc.service', 'rpc.method'],
  outputKeys: ['rpc.grpc.status_code'],
  predicate: (span) =>
    span.attributes['rpc.system'] !== undefined ||
    span.attributes['rpc.method'] !== undefined,
});

// Built-in extractor for database spans
export const dbExtractor: AttributeExtractor = createExtractor('db', {
  toolNameKey: 'db.system',
  actionTypeKey: 'db.system',
  inputKeys: ['db.system', 'db.statement'],
  outputKeys: ['db.statement'],
  predicate: (span) =>
    span.attributes['db.system'] !== undefined ||
    span.attributes['db.statement'] !== undefined,
});

/**
 * Default attribute extractor using span name and standard OTel conventions.
 * Always returns results (canExtract always returns true).
 */
export class DefaultAttributeExtractor implements AttributeExtractor {
  readonly name = 'default';

  canExtract(_span: ReadableSpan): boolean {
    return true;
  }

  extract(span: ReadableSpan): ExtractedAttributes {
    return {
      toolName: extractToolName(span),
      actionType: extractActionType(span),
      inputHash: extractInputHash(span),
      outputHash: extractOutputHash(span),
    };
  }
}

/**
 * Composite extractor that tries multiple extractors in order.
 * The first extractor whose canExtract() returns true wins.
 * Falls back to the DefaultAttributeExtractor if none match.
 */
export class CompositeExtractor implements AttributeExtractor {
  readonly name = 'composite';
  private readonly extractors: AttributeExtractor[];
  private readonly fallback: DefaultAttributeExtractor;

  constructor(extractors: AttributeExtractor[]) {
    this.extractors = [...extractors];
    this.fallback = new DefaultAttributeExtractor();
  }

  /** Add an extractor to the end of the chain. */
  addExtractor(extractor: AttributeExtractor): void {
    this.extractors.push(extractor);
  }

  /** Get the number of extractors (not counting fallback). */
  get extractorCount(): number {
    return this.extractors.length;
  }

  canExtract(_span: ReadableSpan): boolean {
    return true; // Always can extract via fallback
  }

  extract(span: ReadableSpan): ExtractedAttributes {
    for (const ext of this.extractors) {
      if (ext.canExtract(span)) {
        return ext.extract(span);
      }
    }
    return this.fallback.extract(span);
  }
}

// ============================================================================
// 3. Error Handling and Retry
// ============================================================================

// Retry policy configuration for failed evidence creation
export interface RetryPolicy {
  // Maximum number of retry attempts
  readonly maxRetries: number;
  /** Initial backoff in milliseconds. */
  readonly backoffMs: number;
  /** Maximum backoff in milliseconds. */
  readonly maxBackoffMs: number;
  /** Optional predicate: return true to retry this specific error. */
  readonly shouldRetry?: (error: Error) => boolean;
}

// Record of a failed span processing attempt
export interface ErrorRecord {
  readonly span: ReadableSpan;
  readonly error: Error;
  readonly timestamp: string;
  readonly retryCount: number;
}

/** Default retry policy. */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  backoffMs: 100,
  maxBackoffMs: 5000,
};

/** Compute delay for a given retry attempt with exponential backoff + jitter. */
function computeBackoff(attempt: number, policy: RetryPolicy): number {
  const exponentialMs = policy.backoffMs * Math.pow(2, attempt);
  const cappedMs = Math.min(exponentialMs, policy.maxBackoffMs);
  // Add small jitter (up to 10%)
  const jitter = cappedMs * 0.1 * Math.random();
  return cappedMs + jitter;
}

/** Sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps any SpanProcessor with retry logic.
 * If onEnd throws, it retries according to the provided RetryPolicy.
 * Uses a sequential queue to maintain hash chain integrity.
 */
export class ResilientSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor;
  private readonly retryPolicy: RetryPolicy;
  private readonly errors: ErrorRecord[] = [];
  private readonly onError?: (record: ErrorRecord) => void;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    inner: SpanProcessor,
    retryPolicy?: Partial<RetryPolicy>,
    onError?: (record: ErrorRecord) => void,
  ) {
    this.inner = inner;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...retryPolicy };
    this.onError = onError;
  }

  onStart(span: ReadableSpan): void {
    this.inner.onStart(span);
  }

  onEnd(span: ReadableSpan): void {
    // Sequential queue to maintain ordering for any underlying chain-building.
    this.queue = this.queue.then(() => this.processWithRetry(span));
  }

  private async processWithRetry(span: ReadableSpan): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        this.inner.onEnd(span);
        // If the inner processor is async via a queue, we need to flush to
        // discover errors. However, the OTel SpanProcessor.onEnd() is void.
        // So if it does not throw synchronously, we consider it succeeded.
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.retryPolicy.shouldRetry && !this.retryPolicy.shouldRetry(lastError)) {
          break;
        }
        if (attempt < this.retryPolicy.maxRetries) {
          const delay = computeBackoff(attempt, this.retryPolicy);
          await sleep(delay);
        }
      }
    }

    const record: ErrorRecord = {
      span,
      error: lastError!,
      timestamp: nowISO(),
      retryCount: this.retryPolicy.maxRetries,
    };
    this.errors.push(record);
    if (this.onError) {
      this.onError(record);
    }
  }

  // Get all error records
  getErrorRecords(): readonly ErrorRecord[] {
    return [...this.errors];
  }

  async forceFlush(): Promise<void> {
    await this.queue;
    await this.inner.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.queue;
    await this.inner.shutdown();
  }
}

// ============================================================================
// 4. Metrics Collection
// ============================================================================

/** Snapshot of processor metrics. */
export interface MetricsSnapshot {
  readonly evidenceItemsCreated: number;
  readonly evidenceItemsFailed: number;
  readonly averageProcessingTimeMs: number;
  readonly chainLength: number;
  readonly epochsSealed: number;
  readonly totalSpansReceived: number;
  readonly totalSpansFiltered: number;
}

/**
 * Tracks processor metrics. Thread-safe via synchronous operations only.
 */
export class ProcessorMetrics {
  private _evidenceItemsCreated = 0;
  private _evidenceItemsFailed = 0;
  private _totalProcessingTimeMs = 0;
  private _chainLength = 0;
  private _epochsSealed = 0;
  private _totalSpansReceived = 0;
  private _totalSpansFiltered = 0;

  /** Record a successfully created evidence item. */
  recordCreated(processingTimeMs: number): void {
    this._evidenceItemsCreated++;
    this._totalProcessingTimeMs += processingTimeMs;
    this._chainLength++;
  }

  // Record a failed evidence creation attempt
  recordFailed(): void {
    this._evidenceItemsFailed++;
  }

  // Record a span received
  recordSpanReceived(): void {
    this._totalSpansReceived++;
  }

  /** Record a span filtered out. */
  recordSpanFiltered(): void {
    this._totalSpansFiltered++;
  }

  /** Record an epoch sealed. */
  recordEpochSealed(): void {
    this._epochsSealed++;
  }

  /** Get a snapshot of current metrics. */
  getMetrics(): MetricsSnapshot {
    return {
      evidenceItemsCreated: this._evidenceItemsCreated,
      evidenceItemsFailed: this._evidenceItemsFailed,
      averageProcessingTimeMs: this._evidenceItemsCreated > 0
        ? this._totalProcessingTimeMs / this._evidenceItemsCreated
        : 0,
      chainLength: this._chainLength,
      epochsSealed: this._epochsSealed,
      totalSpansReceived: this._totalSpansReceived,
      totalSpansFiltered: this._totalSpansFiltered,
    };
  }

  resetMetrics(): void {
    this._evidenceItemsCreated = 0;
    this._evidenceItemsFailed = 0;
    this._totalProcessingTimeMs = 0;
    this._chainLength = 0;
    this._epochsSealed = 0;
    this._totalSpansReceived = 0;
    this._totalSpansFiltered = 0;
  }
}

// Standalone metrics collector that can be shared across multiple processors
export class MetricsCollector {
  private readonly inner = new ProcessorMetrics();

  /** Record a created evidence item with processing time. */
  record(event: 'created', processingTimeMs: number): void;
  /** Record a failed, received, filtered, or epoch-sealed event. */
  record(event: 'failed' | 'received' | 'filtered' | 'epochSealed'): void;
  record(event: string, processingTimeMs?: number): void {
    switch (event) {
      case 'created':
        this.inner.recordCreated(processingTimeMs ?? 0);
        break;
      case 'failed':
        this.inner.recordFailed();
        break;
      case 'received':
        this.inner.recordSpanReceived();
        break;
      case 'filtered':
        this.inner.recordSpanFiltered();
        break;
      case 'epochSealed':
        this.inner.recordEpochSealed();
        break;
    }
  }

  /** Get a snapshot of current metrics. */
  getMetrics(): MetricsSnapshot {
    return this.inner.getMetrics();
  }

  // Reset all metrics to zero
  reset(): void {
    this.inner.resetMetrics();
  }
}

// ============================================================================
// 5. Multiple Exporter Support
// ============================================================================

/** Interface for evidence item exporters. */
export interface Exporter {
  export(items: readonly EvidenceItem[]): Promise<void>;
  /** Graceful shutdown. */
  shutdown(): Promise<void>;
}

/** Exporter that logs evidence items to the console. */
export class ConsoleExporter implements Exporter {
  private readonly prefix: string;

  constructor(prefix = '[nobulex-evidence]') {
    this.prefix = prefix;
  }

  async export(items: readonly EvidenceItem[]): Promise<void> {
    for (const item of items) {
      console.log(`${this.prefix} id=${item.id} action=${item.actionType} tool=${item.toolName} hash=${item.hash}`);
    }
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up.
  }
}

// Exporter that invokes a callback with each batch of items
export class CallbackExporter implements Exporter {
  private readonly callback: (items: readonly EvidenceItem[]) => void | Promise<void>;

  constructor(callback: (items: readonly EvidenceItem[]) => void | Promise<void>) {
    this.callback = callback;
  }

  async export(items: readonly EvidenceItem[]): Promise<void> {
    await this.callback(items);
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up.
  }
}

// Multiplexer that sends evidence items to multiple exporters
export class MultiExporter implements Exporter {
  private readonly exporters: Exporter[] = [];

  constructor(exporters?: Exporter[]) {
    if (exporters) {
      this.exporters.push(...exporters);
    }
  }

  /** Add an exporter to the set. */
  addExporter(exporter: Exporter): void {
    this.exporters.push(exporter);
  }

  /** Remove an exporter from the set. Returns true if it was found. */
  removeExporter(exporter: Exporter): boolean {
    const idx = this.exporters.indexOf(exporter);
    if (idx >= 0) {
      this.exporters.splice(idx, 1);
      return true;
    }
    // intentionally swallowing — caller decides what to do with the Result
    return false;
  }

  /** Get the count of registered exporters. */
  get exporterCount(): number {
    return this.exporters.length;
  }

  // Export to all registered exporters
  async export(items: readonly EvidenceItem[]): Promise<void> {
    const results = await Promise.allSettled(
      this.exporters.map(e => e.export(items)),
    );
    // Collect errors for debugging but do not throw.
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      const reasons = failures.map(f => (f as PromiseRejectedResult).reason);
      console.error(`[MultiExporter] ${failures.length} exporter(s) failed:`, reasons);
    }
  }

  /** Shut down all exporters. */
  async shutdown(): Promise<void> {
    await Promise.allSettled(this.exporters.map(e => e.shutdown()));
  }
}

// ============================================================================
// 6. Evidence Sink (fan-out to multiple sinks)
// ============================================================================

/** Interface for evidence sinks that receive items and epoch-sealed events. */
export interface EvidenceSink {
  /** Called when a new evidence item is produced. */
  onEvidence(item: EvidenceItem): void | Promise<void>;
  // Called when an epoch is sealed
  onEpochSealed(epoch: Epoch): void | Promise<void>;
}

/**
 * Processor that fans out evidence items and epoch events to multiple sinks.
 * Wraps an EvidenceSpanProcessor and intercepts evidence creation and epoch
 * sealing to notify all registered sinks.
 */
export class MultiSinkProcessor implements SpanProcessor {
  private readonly inner: EvidenceSpanProcessor;
  private readonly sinks: EvidenceSink[] = [];

  constructor(config: EvidenceProcessorConfig, sinks?: EvidenceSink[]) {
    // Wrap onEpochSealed to also notify sinks.
    const originalOnEpochSealed = config.onEpochSealed;
    const wrappedConfig: EvidenceProcessorConfig = {
      ...config,
      onEpochSealed: (epoch: Epoch) => {
        if (originalOnEpochSealed) originalOnEpochSealed(epoch);
        for (const sink of this.sinks) {
          try {
            sink.onEpochSealed(epoch);
          } catch {
            // Sink errors are non-fatal.
          }
        }
      },
      // Wrap exporter to also notify sinks.
      exporter: new CallbackExporter(async (items) => {
        if (config.exporter) {
          await config.exporter.export(items);
        }
        for (const item of items) {
          for (const sink of this.sinks) {
            try {
              await sink.onEvidence(item);
            } catch {
              // Sink errors are non-fatal.
            }
          }
        }
      }),
    };

    this.inner = new EvidenceSpanProcessor(wrappedConfig);
    if (sinks) {
      this.sinks.push(...sinks);
    }
  }

  /** Add a sink. */
  addSink(sink: EvidenceSink): void {
    this.sinks.push(sink);
  }

  /** Remove a sink. Returns true if found. */
  removeSink(sink: EvidenceSink): boolean {
    const idx = this.sinks.indexOf(sink);
    if (idx >= 0) {
      this.sinks.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Get the number of registered sinks
  get sinkCount(): number {
    return this.sinks.length;
  }

  // Get the underlying EvidenceSpanProcessor
  getInner(): EvidenceSpanProcessor {
    return this.inner;
  }

  onStart(span: ReadableSpan): void {
    this.inner.onStart(span);
  }

  onEnd(span: ReadableSpan): void {
    this.inner.onEnd(span);
  }

  async forceFlush(): Promise<void> {
    await this.inner.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown();
  }
}

// ============================================================================
// 7. Span Enrichment
// ============================================================================

/** Function that decorates an EvidenceInput before it is committed to the chain. */
export type EnricherFn = (input: EvidenceInput, span: ReadableSpan) => EvidenceInput;

/** Interface for stateful span enrichers. */
export interface SpanEnricher {
  /** Name of this enricher for debugging. */
  readonly name: string;
  /** Enrich the evidence input. Must return a new (or the same) input object. */
  enrich(input: EvidenceInput, span: ReadableSpan): EvidenceInput;
}

// ============================================================================
// Configuration
// ============================================================================

// Configuration for the evidence span processor
export interface EvidenceProcessorConfig {
  /** DID of the agent generating evidence. */
  readonly agentDid: string;
  /** Key pair for signing evidence items. */
  readonly keyPair: KeyPair;
  /** Model version string. */
  readonly modelVersion?: string;
  // Epoch aggregator configuration
  readonly epochConfig?: EpochConfig;
  /**
   * Filter function: return true to generate evidence for this span.
   * Default: generate for all spans.
   */
  readonly filter?: (span: ReadableSpan) => boolean;
  /** Callback when an epoch is sealed. */
  readonly onEpochSealed?: (epoch: Epoch) => void;
  /** Attribute extractors tried in order. First matching extractor wins. */
  readonly extractors?: readonly AttributeExtractor[];
  // Retry policy for failed evidence creation
  readonly retryPolicy?: RetryPolicy;
  // Error callback
  readonly onError?: (record: ErrorRecord) => void;
  /** Evidence item exporter(s). */
  readonly exporter?: Exporter;
  /** Span enrichers applied in order. */
  readonly enrichers?: readonly (SpanEnricher | EnricherFn)[];
}

// ============================================================================
// Span metadata extraction (default)
// ============================================================================

function hrtimeToISO(hrtime: readonly [number, number]): string {
  const ms = hrtime[0] * 1000 + hrtime[1] / 1_000_000;
  return new Date(ms).toISOString();
}

function extractToolName(span: ReadableSpan): string {
  return (span.attributes['tool.name'] as string)
    ?? (span.attributes['rpc.method'] as string)
    ?? (span.attributes['http.method'] as string)
    ?? span.name;
}

function extractActionType(span: ReadableSpan): string {
  return (span.attributes['nobulex.action_type'] as string)
    ?? (span.attributes['rpc.system'] as string)
    ?? 'span';
}

function extractInputHash(span: ReadableSpan): string {
  const explicit = span.attributes['nobulex.input_hash'] as string | undefined;
  if (explicit) return explicit;
  const inputData = canonicalizeJson({
    name: span.name,
    kind: span.kind,
    attributes: span.attributes,
  });
  return sha256String(inputData);
}

function extractOutputHash(span: ReadableSpan): string {
  const explicit = span.attributes['nobulex.output_hash'] as string | undefined;
  if (explicit) return explicit;
  return sha256String(canonicalizeJson({
    status: span.status,
    endTime: span.endTime,
  }));
}

/**
 * Apply configured extractors to a span, falling back to defaults.
 * Returns a partial EvidenceInput with the extracted fields.
 */
function applyExtractors(
  span: ReadableSpan,
  extractors?: readonly AttributeExtractor[],
): { toolName: string; actionType: string; inputHash: string; outputHash: string } {
  if (extractors && extractors.length > 0) {
    for (const ext of extractors) {
      if (ext.canExtract(span)) {
        const extracted = ext.extract(span);
        return {
          toolName: extracted.toolName ?? extractToolName(span),
          actionType: extracted.actionType ?? extractActionType(span),
          inputHash: extracted.inputHash ?? extractInputHash(span),
          outputHash: extracted.outputHash ?? extractOutputHash(span),
        };
      }
    }
  }
  return {
    toolName: extractToolName(span),
    actionType: extractActionType(span),
    inputHash: extractInputHash(span),
    outputHash: extractOutputHash(span),
  };
}

// Apply enrichers to an EvidenceInput
function applyEnrichers(
  input: EvidenceInput,
  span: ReadableSpan,
  enrichers?: readonly (SpanEnricher | EnricherFn)[],
): EvidenceInput {
  if (!enrichers || enrichers.length === 0) return input;
  let result = input;
  for (const enricher of enrichers) {
    if (typeof enricher === 'function') {
      result = enricher(result, span);
    } else {
      result = enricher.enrich(result, span);
    }
  }
  return result;
}

// ============================================================================
// EvidenceSpanProcessor
// ============================================================================

/**
 * OpenTelemetry SpanProcessor that intercepts completed spans and generates
 * signed evidence items, feeding them into a Merkle epoch aggregator.
 *
 * Supports custom extractors, enrichers, retry, metrics, and export.
 */
export class EvidenceSpanProcessor implements SpanProcessor {
  private readonly chain: EvidenceChainBuilder;
  private readonly aggregator: EpochAggregator;
  private readonly config: EvidenceProcessorConfig;
  private readonly metrics: ProcessorMetrics;
  private readonly retryPolicy: RetryPolicy;
  private readonly errorRecords: ErrorRecord[] = [];
  /** Sequential queue ensures hash chain integrity across async appends. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: EvidenceProcessorConfig) {
    this.config = config;
    this.chain = new EvidenceChainBuilder(config.agentDid, config.keyPair);
    this.aggregator = new EpochAggregator(config.epochConfig);
    this.metrics = new ProcessorMetrics();
    this.retryPolicy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  /** No-op on start -- evidence is generated on span end. */
  onStart(_span: ReadableSpan): void {
    // Evidence items are created when spans end.
  }

  /** Generate an evidence item from the completed span. */
  onEnd(span: ReadableSpan): void {
    this.metrics.recordSpanReceived();

    if (this.config.filter && !this.config.filter(span)) {
      this.metrics.recordSpanFiltered();
      return;
    }

    const extracted = applyExtractors(span, this.config.extractors);

    let input: EvidenceInput = {
      agentDid: this.config.agentDid,
      actionType: extracted.actionType,
      toolName: extracted.toolName,
      inputHash: extracted.inputHash,
      outputHash: extracted.outputHash,
      modelVersion: this.config.modelVersion ?? 'unknown',
      parentActionId: span.parentSpanId ?? null,
      timestamp: hrtimeToISO(span.endTime),
    };

    input = applyEnrichers(input, span, this.config.enrichers);

    // Chain appends sequentially to maintain hash chain integrity.
    this.queue = this.queue.then(() => this.processSpanWithRetry(span, input));
  }

  /** Internal: process a single span with retry logic. */
  private async processSpanWithRetry(span: ReadableSpan, input: EvidenceInput): Promise<void> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        const item = await this.chain.append(input);
        const epochCountBefore = this.aggregator.epochCount;
        this.aggregator.add(item.hash);
        const epochCountAfter = this.aggregator.epochCount;

        const elapsed = Date.now() - startTime;
        this.metrics.recordCreated(elapsed);

        // Export if exporter is configured.
        if (this.config.exporter) {
          try {
            await this.config.exporter.export([item]);
          } catch {
            // Exporter failures are non-fatal; metrics already recorded.
          }
        }

        // Detect auto-seal that happened inside aggregator.add().
        if (epochCountAfter > epochCountBefore) {
          const epoch = this.aggregator.getLatestEpoch();
          if (epoch) {
            this.metrics.recordEpochSealed();
            if (this.config.onEpochSealed) {
              this.config.onEpochSealed(epoch);
            }
          }
        }

        // Also check time-based sealing.
        if (this.aggregator.shouldSeal()) {
          const epoch = this.aggregator.seal();
          if (epoch) {
            this.metrics.recordEpochSealed();
            if (this.config.onEpochSealed) {
              this.config.onEpochSealed(epoch);
            }
          }
        }

        return; // Success, exit retry loop.
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.retryPolicy.shouldRetry && !this.retryPolicy.shouldRetry(lastError)) {
          break;
        }
        if (attempt < this.retryPolicy.maxRetries) {
          const delay = computeBackoff(attempt, this.retryPolicy);
          await sleep(delay);
        }
      }
    }

    // All retries exhausted.
    this.metrics.recordFailed();
    const record: ErrorRecord = {
      span,
      error: lastError!,
      timestamp: nowISO(),
      retryCount: this.retryPolicy.maxRetries,
    };
    this.errorRecords.push(record);
    if (this.config.onError) {
      this.config.onError(record);
    }
  }

  // Flush pending evidence items and seal the current epoch
  async forceFlush(): Promise<void> {
    await this.queue;

    const epoch = this.aggregator.seal();
    if (epoch) {
      this.metrics.recordEpochSealed();
      if (this.config.onEpochSealed) {
        this.config.onEpochSealed(epoch);
      }
    }

    // Flush exporter.
    if (this.config.exporter) {
      try {
        // Nothing to flush beyond the per-item exports already done.
      } catch {
        // Ignored.
      }
    }
  }

  /** Shutdown: flush, seal, and shut down exporters. */
  async shutdown(): Promise<void> {
    await this.forceFlush();
    if (this.config.exporter) {
      await this.config.exporter.shutdown();
    }
  }

  /** Get the evidence chain builder (for inspection/testing). */
  getChain(): EvidenceChainBuilder {
    return this.chain;
  }

  /** Get the epoch aggregator (for inspection/testing). */
  getAggregator(): EpochAggregator {
    return this.aggregator;
  }

  /** Get all evidence items generated so far. */
  async getEvidenceItems(): Promise<readonly EvidenceItem[]> {
    await this.queue;
    return this.chain.entries();
  }

  // Get the metrics tracker
  getMetrics(): ProcessorMetrics {
    return this.metrics;
  }

  /** Get a snapshot of current metrics. */
  getMetricsSnapshot(): MetricsSnapshot {
    return this.metrics.getMetrics();
  }

  /** Reset metrics. */
  resetMetrics(): void {
    this.metrics.resetMetrics();
  }

  /** Get all error records. */
  getErrorRecords(): readonly ErrorRecord[] {
    return [...this.errorRecords];
  }
}

// ============================================================================
// 8. Batch Processing
// ============================================================================

/**
 * Wraps an EvidenceSpanProcessor with batching support.
 * Accumulates spans and forwards them to the underlying processor
 * in configurable batches.
 */
export class BatchProcessor implements SpanProcessor {
  private readonly inner: EvidenceSpanProcessor;
  private buffer: ReadableSpan[] = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private maxQueueSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private isShutdown = false;
  private _droppedCount = 0;

  constructor(
    inner: EvidenceSpanProcessor,
    batchSize = 50,
    flushIntervalMs = 5000,
    maxQueueSize = 2048,
  ) {
    this.inner = inner;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.maxQueueSize = maxQueueSize;
    this.startFlushTimer();
  }

  // Set the batch size
  setBatchSize(n: number): void {
    this.batchSize = n;
  }

  /** Set the flush interval in milliseconds. */
  setFlushInterval(ms: number): void {
    this.flushIntervalMs = ms;
    this.stopFlushTimer();
    this.startFlushTimer();
  }

  /** Get the current batch size. */
  getBatchSize(): number {
    return this.batchSize;
  }

  /** Get the current flush interval. */
  getFlushInterval(): number {
    return this.flushIntervalMs;
  }

  // Get the maximum queue size
  getMaxQueueSize(): number {
    return this.maxQueueSize;
  }

  /** Number of spans currently buffered. */
  get pendingCount(): number {
    return this.buffer.length;
  }

  /** Number of spans dropped due to queue overflow. */
  get droppedCount(): number {
    return this._droppedCount;
  }

  /** Get the underlying processor. */
  getInner(): EvidenceSpanProcessor {
    return this.inner;
  }

  onStart(span: ReadableSpan): void {
    this.inner.onStart(span);
  }

  onEnd(span: ReadableSpan): void {
    if (this.isShutdown) return;
    if (this.buffer.length >= this.maxQueueSize) {
      this._droppedCount++;
      return;
    }
    this.buffer.push(span);
    if (this.buffer.length >= this.batchSize) {
      void this.flushBuffer();
    }
  }

  // Flush the buffered spans to the inner processor
  async flushBuffer(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;
    this.isFlushing = true;
    try {
      const batch = this.buffer.splice(0, this.batchSize);
      for (const span of batch) {
        this.inner.onEnd(span);
      }
      await this.inner.forceFlush();
    } finally {
      this.isFlushing = false;
    }
  }

  async forceFlush(): Promise<void> {
    // Flush all buffered spans, not just one batch.
    while (this.buffer.length > 0) {
      this.isFlushing = true;
      const batch = this.buffer.splice(0, this.batchSize);
      for (const span of batch) {
        this.inner.onEnd(span);
      }
      this.isFlushing = false;
    }
    await this.inner.forceFlush();
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.stopFlushTimer();
    await this.forceFlush();
    await this.inner.shutdown();
  }

  private startFlushTimer(): void {
    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flushBuffer();
      }, this.flushIntervalMs);
      // Unref so the timer does not keep the process alive.
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        (this.flushTimer as NodeJS.Timeout).unref();
      }
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ============================================================================
// 9. Processor Pipeline
// ============================================================================

/**
 * Chains multiple SpanProcessors together. Each span flows through all
 * processors in the order they were added.
 */
export class ProcessorPipeline implements SpanProcessor {
  private readonly processors: SpanProcessor[] = [];

  /** Add a processor to the pipeline. */
  addProcessor(processor: SpanProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /** Remove a processor from the pipeline. Returns true if found. */
  removeProcessor(processor: SpanProcessor): boolean {
    const idx = this.processors.indexOf(processor);
    if (idx >= 0) {
      this.processors.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Get the number of processors in the pipeline. */
  get processorCount(): number {
    return this.processors.length;
  }

  onStart(span: ReadableSpan): void {
    for (const p of this.processors) {
      p.onStart(span);
    }
  }

  onEnd(span: ReadableSpan): void {
    for (const p of this.processors) {
      p.onEnd(span);
    }
  }

  async forceFlush(): Promise<void> {
    for (const p of this.processors) {
      await p.forceFlush();
    }
  }

  async shutdown(): Promise<void> {
    for (const p of this.processors) {
      await p.shutdown();
    }
  }
}
