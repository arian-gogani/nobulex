/**
 * @stele/verifier — Standalone verification engine for third-party auditors.
 *
 * Provides a stateful {@link Verifier} class that wraps the core
 * `verifyCovenant` function with history tracking, batch processing,
 * chain integrity validation, and action-level evaluation.
 *
 * @packageDocumentation
 */

import {
  verifyCovenant,
  computeId,
  canonicalForm,
  validateChainNarrowing,
  MAX_CHAIN_DEPTH,
} from '@stele/core';

import type {
  CovenantDocument,
  VerificationResult,
} from '@stele/core';

import {
  parse,
  evaluate,
  matchAction,
  matchResource,
  validateNarrowing,
} from '@stele/ccl';

import type { EvaluationContext } from '@stele/ccl';

import { generateId } from '@stele/crypto';

import type {
  VerifierOptions,
  VerificationReport,
  ChainVerificationReport,
  ChainDocumentResult,
  ChainIntegrityCheck,
  NarrowingCheckResult,
  ActionVerificationReport,
  BatchVerificationReport,
  BatchSummary,
  VerificationRecord,
  VerificationKind,
} from './types.js';

// Re-export all types for consumers
export type {
  VerifierOptions,
  VerificationReport,
  ChainVerificationReport,
  ChainDocumentResult,
  ChainIntegrityCheck,
  NarrowingCheckResult,
  ActionVerificationReport,
  BatchVerificationReport,
  BatchSummary,
  VerificationRecord,
  VerificationKind,
} from './types.js';

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function elapsed(startMs: number): number {
  return Date.now() - startMs;
}

/**
 * Build a VerificationReport from a core VerificationResult,
 * adding timing, verifier ID, and warnings.
 */
function toReport(
  result: VerificationResult,
  verifierId: string,
  startMs: number,
  warnings: string[],
  strictMode: boolean,
): VerificationReport {
  let valid = result.valid;

  // In strict mode, any warning causes the report to be invalid
  if (strictMode && warnings.length > 0) {
    valid = false;
  }

  return {
    ...result,
    valid,
    verifierId,
    timestamp: now(),
    durationMs: elapsed(startMs),
    warnings,
  };
}

/**
 * Collect warnings about a document (non-fatal issues).
 */
function collectWarnings(doc: CovenantDocument): string[] {
  const warnings: string[] = [];

  if (!doc.metadata) {
    warnings.push('Document has no metadata');
  }

  if (!doc.expiresAt) {
    warnings.push('Document has no expiration date');
  }

  if (doc.constraints.trim().length === 0) {
    warnings.push('Constraints are empty');
  }

  return warnings;
}

// ─── Verifier class ─────────────────────────────────────────────────────────────

/**
 * A stateful verification engine that tracks verification history
 * and supports single, chain, action, and batch verification.
 */
export class Verifier {
  /** Unique identifier for this verifier instance. */
  readonly verifierId: string;

  private readonly strictMode: boolean;
  private readonly maxHistorySize: number;
  private readonly maxChainDepth: number;
  private history: VerificationRecord[] = [];

  constructor(options?: VerifierOptions) {
    this.verifierId = options?.verifierId ?? generateId(16);
    this.strictMode = options?.strictMode ?? false;
    this.maxHistorySize = options?.maxHistorySize ?? DEFAULT_MAX_HISTORY;
    this.maxChainDepth = options?.maxChainDepth ?? MAX_CHAIN_DEPTH;
  }

  // ── History management ──────────────────────────────────────────────────

  private recordHistory(
    kind: VerificationKind,
    documentIds: string[],
    valid: boolean,
    durationMs: number,
  ): void {
    const record: VerificationRecord = {
      kind,
      documentIds,
      valid,
      timestamp: now(),
      durationMs,
    };

    this.history.push(record);

    // Evict oldest entries when the limit is exceeded
    while (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /** Returns a copy of the verification history. */
  getHistory(): VerificationRecord[] {
    return [...this.history];
  }

  /** Clears all verification history. */
  clearHistory(): void {
    this.history = [];
  }

  // ── Single document verification ───────────────────────────────────────

  /**
   * Verify a single covenant document.
   *
   * Runs all core verification checks plus optional strict-mode
   * warnings. The result is recorded in history.
   */
  async verify(doc: CovenantDocument): Promise<VerificationReport> {
    const startMs = Date.now();
    const warnings = collectWarnings(doc);

    const coreResult = await verifyCovenant(doc);
    const report = toReport(coreResult, this.verifierId, startMs, warnings, this.strictMode);

    this.recordHistory('single', [doc.id], report.valid, report.durationMs);

    return report;
  }

  // ── Chain verification ─────────────────────────────────────────────────

  /**
   * Verify an ordered chain of covenant documents.
   *
   * The `docs` array must be ordered root-first (index 0 is the
   * root / most-distant ancestor, last element is the leaf).
   *
   * Checks performed:
   * 1. Each document is individually valid.
   * 2. Chain depth does not exceed the configured limit.
   * 3. Parent references are consistent (child.chain.parentId === parent.id).
   * 4. Depths are monotonically increasing.
   * 5. Narrowing: each child only restricts (never broadens) its parent.
   */
  async verifyChain(docs: CovenantDocument[]): Promise<ChainVerificationReport> {
    const startMs = Date.now();
    const documentResults: ChainDocumentResult[] = [];
    const integrityChecks: ChainIntegrityCheck[] = [];
    const narrowingResults: NarrowingCheckResult[] = [];

    // ── Empty chain check ───────────────────────────────────────────────
    if (docs.length === 0) {
      const report: ChainVerificationReport = {
        valid: false,
        documentResults: [],
        integrityChecks: [{
          name: 'chain_non_empty',
          passed: false,
          message: 'Chain is empty',
        }],
        narrowingResults: [],
        verifierId: this.verifierId,
        timestamp: now(),
        durationMs: elapsed(startMs),
      };
      this.recordHistory('chain', [], false, report.durationMs);
      return report;
    }

    // ── 1. Verify each document individually ────────────────────────────
    for (const doc of docs) {
      const docReport = await this.verify(doc);
      documentResults.push({ document: doc, report: docReport });
    }

    const allDocsValid = documentResults.every((r) => r.report.valid);
    integrityChecks.push({
      name: 'all_documents_valid',
      passed: allDocsValid,
      message: allDocsValid
        ? 'All documents in the chain are individually valid'
        : 'One or more documents in the chain failed verification',
    });

    // ── 2. Chain depth check ────────────────────────────────────────────
    const depthOk = docs.length <= this.maxChainDepth;
    integrityChecks.push({
      name: 'chain_depth',
      passed: depthOk,
      message: depthOk
        ? `Chain depth ${docs.length} is within limit of ${this.maxChainDepth}`
        : `Chain depth ${docs.length} exceeds limit of ${this.maxChainDepth}`,
    });

    // ── 3. Parent reference consistency ─────────────────────────────────
    let parentRefsOk = true;
    for (let i = 1; i < docs.length; i++) {
      const child = docs[i]!;
      const parent = docs[i - 1]!;

      if (!child.chain) {
        parentRefsOk = false;
        integrityChecks.push({
          name: `parent_ref_${i}`,
          passed: false,
          message: `Document at index ${i} (${child.id}) has no chain reference but is not the root`,
        });
      } else if (child.chain.parentId !== parent.id) {
        parentRefsOk = false;
        integrityChecks.push({
          name: `parent_ref_${i}`,
          passed: false,
          message: `Document at index ${i} references parent ${child.chain.parentId} but expected ${parent.id}`,
        });
      }
    }

    if (parentRefsOk) {
      integrityChecks.push({
        name: 'parent_refs_consistent',
        passed: true,
        message: 'All parent references are consistent',
      });
    }

    // ── 4. Depth monotonicity ───────────────────────────────────────────
    let depthMonotonic = true;
    for (let i = 1; i < docs.length; i++) {
      const child = docs[i]!;
      if (child.chain) {
        const expectedDepth = i;
        if (child.chain.depth !== expectedDepth) {
          depthMonotonic = false;
        }
      }
    }
    integrityChecks.push({
      name: 'depth_monotonic',
      passed: depthMonotonic,
      message: depthMonotonic
        ? 'Chain depths are monotonically increasing'
        : 'Chain depths are not monotonically increasing',
    });

    // ── 5. Narrowing validation ─────────────────────────────────────────
    for (let i = 1; i < docs.length; i++) {
      const child = docs[i]!;
      const parent = docs[i - 1]!;

      const narrowing = await validateChainNarrowing(child, parent);

      narrowingResults.push({
        childId: child.id,
        parentId: parent.id,
        valid: narrowing.valid,
        violations: narrowing.violations,
      });
    }

    const allNarrowingValid = narrowingResults.every((r) => r.valid);
    integrityChecks.push({
      name: 'narrowing_valid',
      passed: allNarrowingValid,
      message: allNarrowingValid
        ? 'All child documents correctly narrow their parents'
        : 'One or more child documents broaden their parent constraints',
    });

    // ── Aggregate ───────────────────────────────────────────────────────
    const valid = allDocsValid
      && depthOk
      && parentRefsOk
      && depthMonotonic
      && allNarrowingValid;

    const report: ChainVerificationReport = {
      valid,
      documentResults,
      integrityChecks,
      narrowingResults,
      verifierId: this.verifierId,
      timestamp: now(),
      durationMs: elapsed(startMs),
    };

    this.recordHistory(
      'chain',
      docs.map((d) => d.id),
      valid,
      report.durationMs,
    );

    return report;
  }

  // ── Action verification ────────────────────────────────────────────────

  /**
   * Check whether a specific action on a resource is permitted
   * by the document's CCL constraints.
   *
   * Also verifies the document itself and reports on document validity.
   */
  async verifyAction(
    doc: CovenantDocument,
    action: string,
    resource: string,
    context?: EvaluationContext,
  ): Promise<ActionVerificationReport> {
    const startMs = Date.now();

    // Verify the document first
    const coreResult = await verifyCovenant(doc);

    // Parse and evaluate CCL
    const ctx = context ?? {};
    let permitted = false;
    let matchedRule: ActionVerificationReport['matchedRule'];
    let allMatches: ActionVerificationReport['allMatches'] = [];
    let reason = '';
    let severity: ActionVerificationReport['severity'];

    try {
      const cclDoc = parse(doc.constraints);
      const evalResult = evaluate(cclDoc, action, resource, ctx);

      permitted = evalResult.permitted;
      matchedRule = evalResult.matchedRule;
      allMatches = evalResult.allMatches;
      reason = evalResult.reason ?? '';
      severity = evalResult.severity;
    } catch (err) {
      reason = `CCL evaluation error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // If the document itself is not valid, the action cannot be trusted
    if (!coreResult.valid) {
      permitted = false;
      reason = `Document is invalid: ${reason}`;
    }

    const durationMs = elapsed(startMs);

    const report: ActionVerificationReport = {
      permitted,
      document: doc,
      documentValid: coreResult.valid,
      matchedRule,
      allMatches,
      reason,
      severity,
      context: ctx,
      verifierId: this.verifierId,
      timestamp: now(),
      durationMs,
    };

    this.recordHistory('action', [doc.id], permitted, durationMs);

    return report;
  }
}

// ─── Batch verification (standalone) ────────────────────────────────────────────

/**
 * Verify a batch of covenant documents in parallel.
 *
 * Returns a {@link BatchVerificationReport} with per-document results
 * and aggregate summary statistics.
 *
 * This is a standalone function that creates a temporary Verifier
 * internally. For history tracking across calls, use the Verifier class.
 */
export async function verifyBatch(
  docs: CovenantDocument[],
  options?: VerifierOptions,
): Promise<BatchVerificationReport> {
  const startMs = Date.now();
  const verifier = new Verifier(options);

  // Run all verifications concurrently
  const reports = await Promise.all(
    docs.map((doc) => verifier.verify(doc)),
  );

  const passed = reports.filter((r) => r.valid).length;
  const failed = reports.length - passed;

  const summary: BatchSummary = {
    total: docs.length,
    passed,
    failed,
    durationMs: elapsed(startMs),
  };

  return {
    reports,
    summary,
    verifierId: verifier.verifierId,
    timestamp: now(),
  };
}
