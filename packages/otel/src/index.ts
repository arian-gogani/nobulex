/**
 * @nobulex/otel — OpenTelemetry SpanProcessor for evidence generation.
 *
 * Intercepts OTel spans, extracts action metadata, generates evidence items,
 * and feeds them to a Merkle epoch aggregator. Works alongside existing
 * OTel exporters — just add it to the span processor pipeline.
 *
 * Integration is 3 lines:
 * ```typescript
 * import { EvidenceSpanProcessor } from '@nobulex/otel';
 * const processor = new EvidenceSpanProcessor({ agentDid, keyPair });
 * provider.addSpanProcessor(processor);
 * ```
 *
 * @packageDocumentation
 */

import {
  sha256String,
  toHex,
  sign,
  timestamp as nowISO,
  canonicalizeJson,
  generateId,
} from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';
import type { EvidenceItem, EvidenceInput } from '@nobulex/evidence-core';
import { EvidenceChainBuilder } from '@nobulex/evidence-core';
import { EpochAggregator } from '@nobulex/merkle';
import type { EpochConfig, Epoch } from '@nobulex/merkle';

// ─── OTel-compatible interfaces ─────────────────────────────────────────────
// Minimal interfaces so we don't require @opentelemetry/api as a dependency.

/** Minimal OTel-compatible Span interface. */
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

/** OTel attribute value. */
export type AttributeValue = string | number | boolean | undefined;

/** Minimal OTel SpanProcessor interface. */
export interface SpanProcessor {
  onStart(span: ReadableSpan): void;
  onEnd(span: ReadableSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the evidence span processor. */
export interface EvidenceProcessorConfig {
  /** DID of the agent generating evidence. */
  readonly agentDid: string;
  /** Key pair for signing evidence items. */
  readonly keyPair: KeyPair;
  /** Model version string. */
  readonly modelVersion?: string;
  /** Epoch aggregator configuration. */
  readonly epochConfig?: EpochConfig;
  /**
   * Filter function: return true to generate evidence for this span.
   * Default: generate for all spans.
   */
  readonly filter?: (span: ReadableSpan) => boolean;
  /** Callback when an epoch is sealed. */
  readonly onEpochSealed?: (epoch: Epoch) => void;
}

// ─── Span metadata extraction ───────────────────────────────────────────────

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
  // Hash the span attributes as input representation
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
  // Hash status + end time as output representation
  return sha256String(canonicalizeJson({
    status: span.status,
    endTime: span.endTime,
  }));
}

// ─── EvidenceSpanProcessor ──────────────────────────────────────────────────

/**
 * OpenTelemetry SpanProcessor that intercepts spans and generates
 * signed evidence items, feeding them into a Merkle epoch aggregator.
 */
export class EvidenceSpanProcessor implements SpanProcessor {
  private readonly chain: EvidenceChainBuilder;
  private readonly aggregator: EpochAggregator;
  private readonly config: EvidenceProcessorConfig;
  /** Sequential queue ensures hash chain integrity across async appends. */
  private queue: Promise<void> = Promise.resolve();

  constructor(config: EvidenceProcessorConfig) {
    this.config = config;
    this.chain = new EvidenceChainBuilder(config.agentDid, config.keyPair);
    this.aggregator = new EpochAggregator(config.epochConfig);
  }

  /** No-op on start — evidence is generated on span end. */
  onStart(_span: ReadableSpan): void {
    // Evidence items are created when spans end
  }

  /** Generate an evidence item from the completed span. */
  onEnd(span: ReadableSpan): void {
    if (this.config.filter && !this.config.filter(span)) return;

    const input: EvidenceInput = {
      agentDid: this.config.agentDid,
      actionType: extractActionType(span),
      toolName: extractToolName(span),
      inputHash: extractInputHash(span),
      outputHash: extractOutputHash(span),
      modelVersion: this.config.modelVersion ?? 'unknown',
      parentActionId: span.parentSpanId ?? null,
      timestamp: hrtimeToISO(span.endTime),
    };

    // Chain appends sequentially to maintain hash chain integrity
    this.queue = this.queue.then(async () => {
      const item = await this.chain.append(input);
      this.aggregator.add(item.hash);

      if (this.aggregator.shouldSeal()) {
        const epoch = this.aggregator.seal();
        if (epoch && this.config.onEpochSealed) {
          this.config.onEpochSealed(epoch);
        }
      }
    });
  }

  /** Flush pending evidence items and seal the current epoch. */
  async forceFlush(): Promise<void> {
    await this.queue;

    const epoch = this.aggregator.seal();
    if (epoch && this.config.onEpochSealed) {
      this.config.onEpochSealed(epoch);
    }
  }

  /** Shutdown: flush and seal. */
  async shutdown(): Promise<void> {
    await this.forceFlush();
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
}
