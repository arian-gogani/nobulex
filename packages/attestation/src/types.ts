/**
 * @nobulex/attestation — Behavioral Attestation Records
 *
 * Aggregates per-session proof chains into a portable, verifiable
 * behavioral history for an agent. Think of it as a "credit report"
 * for agent behavior — shows lifetime compliance without exposing
 * the raw covenant details or action logs.
 *
 */

// attestation summary

/**
 * Violation breakdown by category.
 * Helps insurers/verifiers understand *what kind* of rules
 * the agent tends to push against.
 */
export interface ViolationBreakdown {
  /** Action class that was violated (e.g., "transfer", "delete", "admin") */
  readonly category: string;
  // How many violations in this category across all sessions
  readonly count: number;
  /** Most recent violation timestamp */
  readonly lastOccurrence: string;
}

/**
 * Metrics from a single deployment/session.
 * This is what gets extracted from a proof chain — the summary
 * without the raw data.
 */
export interface SessionDigest {
  readonly sessionId: string;
  /** When this session started */
  readonly startedAt: string;
  // When this session ended
  readonly endedAt: string;
  /** Total actions in this session's proof chain */
  readonly totalActions: number;
  /** Actions that were blocked by enforcement */
  readonly blockedActions: number;
  /** Number of covenant violations detected */
  readonly violationCount: number;
  // SHA-256 hash of the covenant used (not the covenant itself)
  readonly covenantHash: string;
  /** Number of statements in the covenant (complexity signal) */
  readonly covenantStatementCount: number;
  /** Head hash of the action log — proves integrity without exposing the log */
  readonly logHeadHash: string;
  // Platform or deployment context identifier
  readonly platform?: string;
}

/**
 * A single attestation record — a signed snapshot of an agent's
 * cumulative behavioral history at a point in time.
 *
 * These chain together: each record references the hash of the
 * previous one, creating a tamper-evident history of histories.
 */
export interface AttestationRecord {
  /** Monotonically increasing version number */
  readonly version: number;
  /** The agent this record belongs to */
  readonly agentDid: string;
  /** When this attestation was generated */
  readonly generatedAt: string;

  // ---
  /** Total actions across all sessions, ever */
  readonly lifetimeActions: number;
  /** Total blocked actions across all sessions */
  readonly lifetimeBlocked: number;
  /** Total violations across all sessions */
  readonly lifetimeViolations: number;
  /** Compliance rate: (actions - violations) / actions */
  readonly complianceRate: number;
  // Number of unique covenants this agent has operated under
  readonly uniqueCovenants: number;
  /** Weighted complexity score across all covenants (higher = more restrictive) */
  readonly covenantComplexity: number;
  /** Total sessions recorded */
  readonly totalSessions: number;

  // ---
  // Compliance rate over last 30 days (or null if not enough data)
  readonly recentComplianceRate: number | null;
  /** Whether compliance is trending up, down, or stable */
  readonly complianceTrend: 'improving' | 'declining' | 'stable';
  /** First session timestamp — how long this agent has been tracked */
  readonly operationalSince: string;

  // violation analysis
  // Breakdown of violations by category
  readonly violationBreakdown: readonly ViolationBreakdown[];

  // ---
  /** Hash of the previous attestation record, null for the first */
  readonly previousAttestationHash: string | null;
  /** SHA-256 hash of this record */
  readonly hash: string;
  /** Ed25519 signature over the hash */
  readonly signature: string;

  // exports
  readonly recentSessions: readonly SessionDigest[];
}

// ---

// Privacy-preserving risk profile for external consumers (insurers, auditors)
export interface RiskProfile {
  readonly agentDid: string;
  readonly complianceRate: number;
  readonly operationalDays: number;
  readonly totalSessions: number;
  readonly lifetimeActions: number;
  readonly highSeverityViolations: number;
  readonly covenantComplexity: number;
  readonly complianceTrend: 'improving' | 'declining' | 'stable';
  /** Hash of the latest attestation record — verifiers can check this */
  readonly latestAttestationHash: string;
  /** When this profile was generated */
  readonly generatedAt: string;
  /** Signature so the profile can't be forged */
  readonly signature: string;
}

// ---

/**
 * A complete chain of attestation records for an agent.
 * The chain itself is the agent's behavioral "credit history."
 */
export interface AttestationChain {
  readonly agentDid: string;
  readonly records: readonly AttestationRecord[];
  readonly latestHash: string | null;
  readonly length: number;
}
