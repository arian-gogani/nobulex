/**
 * @stele/verifier type definitions.
 *
 * Report types, options, and records used by the Verifier class
 * and the standalone `verifyBatch` function.
 */

import type {
  CovenantDocument,
  VerificationResult,
  VerificationCheck,
} from '@stele/core';

import type { Statement, NarrowingViolation, EvaluationContext, Severity } from '@stele/ccl';

// ─── Options ────────────────────────────────────────────────────────────────────

/** Options accepted by the Verifier constructor. */
export interface VerifierOptions {
  /**
   * When true, warnings (e.g. missing optional fields) are treated as
   * failures and cause the overall result to be `valid: false`.
   */
  strictMode?: boolean;

  /**
   * Maximum number of verification records kept in history.
   * Oldest entries are evicted when the limit is exceeded.
   * Defaults to 1000.
   */
  maxHistorySize?: number;

  /**
   * An identifier for this verifier instance, included in every report.
   * Defaults to a generated UUID-like string.
   */
  verifierId?: string;

  /**
   * Optional maximum chain depth override.
   * Defaults to MAX_CHAIN_DEPTH from @stele/core (16).
   */
  maxChainDepth?: number;
}

// ─── Reports ────────────────────────────────────────────────────────────────────

/** Extends core's VerificationResult with timing and verifier metadata. */
export interface VerificationReport extends VerificationResult {
  /** Unique identifier of the verifier instance that produced this report. */
  verifierId: string;

  /** ISO 8601 timestamp when verification started. */
  timestamp: string;

  /** Duration of verification in milliseconds. */
  durationMs: number;

  /** Warnings generated during verification (non-fatal issues). */
  warnings: string[];
}

/** Result of a single document check within a chain. */
export interface ChainDocumentResult {
  /** The document that was verified. */
  document: CovenantDocument;

  /** The verification report for this document. */
  report: VerificationReport;
}

/** A narrowing check result for a parent-child pair. */
export interface NarrowingCheckResult {
  /** The child document ID. */
  childId: string;

  /** The parent document ID. */
  parentId: string;

  /** Whether narrowing is valid (child does not broaden parent). */
  valid: boolean;

  /** Details of any violations. */
  violations: NarrowingViolation[];
}

/** An integrity check for chain consistency. */
export interface ChainIntegrityCheck {
  /** Name of the integrity check. */
  name: string;

  /** Whether the check passed. */
  passed: boolean;

  /** Descriptive message. */
  message: string;
}

/** Report produced by verifyChain(). */
export interface ChainVerificationReport {
  /** Whether the entire chain is valid. */
  valid: boolean;

  /** Per-document verification results, ordered root-first. */
  documentResults: ChainDocumentResult[];

  /** Chain-level integrity checks. */
  integrityChecks: ChainIntegrityCheck[];

  /** Narrowing validation results for each parent-child pair. */
  narrowingResults: NarrowingCheckResult[];

  /** Unique identifier of the verifier instance. */
  verifierId: string;

  /** ISO 8601 timestamp when chain verification started. */
  timestamp: string;

  /** Total duration of chain verification in milliseconds. */
  durationMs: number;
}

/** Report produced by verifyAction(). */
export interface ActionVerificationReport {
  /** Whether the action is permitted by the document's constraints. */
  permitted: boolean;

  /** The document that was evaluated. */
  document: CovenantDocument;

  /** Whether the document itself is valid. */
  documentValid: boolean;

  /** The matched rule, if any. */
  matchedRule?: Statement;

  /** All matching rules. */
  allMatches: Statement[];

  /** Human-readable reason for the decision. */
  reason: string;

  /** The severity of the matched rule, if any. */
  severity?: Severity;

  /** The evaluation context used. */
  context: EvaluationContext;

  /** Unique identifier of the verifier instance. */
  verifierId: string;

  /** ISO 8601 timestamp. */
  timestamp: string;

  /** Duration in milliseconds. */
  durationMs: number;
}

/** Summary statistics for a batch verification. */
export interface BatchSummary {
  /** Total number of documents in the batch. */
  total: number;

  /** Number of documents that passed all checks. */
  passed: number;

  /** Number of documents that failed one or more checks. */
  failed: number;

  /** Total duration in milliseconds for the entire batch. */
  durationMs: number;
}

/** Report produced by verifyBatch(). */
export interface BatchVerificationReport {
  /** Individual reports for every document in the batch. */
  reports: VerificationReport[];

  /** Aggregate statistics. */
  summary: BatchSummary;

  /** Unique identifier of the verifier instance. */
  verifierId: string;

  /** ISO 8601 timestamp. */
  timestamp: string;
}

// ─── History ────────────────────────────────────────────────────────────────────

/** The kind of verification that was performed. */
export type VerificationKind = 'single' | 'chain' | 'action' | 'batch';

/** A history record kept by the Verifier. */
export interface VerificationRecord {
  /** What type of verification was performed. */
  kind: VerificationKind;

  /** The document ID(s) involved. */
  documentIds: string[];

  /** Whether the verification passed overall. */
  valid: boolean;

  /** ISO 8601 timestamp. */
  timestamp: string;

  /** Duration in milliseconds. */
  durationMs: number;
}
