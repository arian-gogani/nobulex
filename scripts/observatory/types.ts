/**
 * Agent Reliability Index, Type Definitions
 *
 * Schema for the weekly observatory measurements. Public; intentionally open
 * so vendors and contributors can audit the methodology.
 *
 * The actual 100-prompt set is held privately to prevent vendors from training
 * on it (which would defeat the measurement). The shape of the prompts and the
 * statistical properties of the set ARE public.
 *
 * See docs/AGENT-RELIABILITY-INDEX.md for the full methodology spec.
 */

// ============================================================================
// Vendors and endpoints
// ============================================================================

export type VendorId =
  | "anthropic"
  | "openai"
  | "google"
  | "microsoft"
  | "meta";

export interface VendorEndpoint {
  /** Stable ID, e.g. "anthropic:claude-flagship" */
  id: string;
  vendor: VendorId;
  /** Vendor's own name for this endpoint (e.g. "claude-sonnet-4-5") */
  modelName: string;
  /** Whether this is the flagship or default-deployed endpoint for this vendor */
  tier: "flagship" | "default" | "experimental";
  /** Vendor's API endpoint URL */
  apiUrl: string;
  /** Whether the endpoint supports temperature=0 */
  supportsZeroTemperature: boolean;
  /** Whether the endpoint supports a fixed seed */
  supportsFixedSeed: boolean;
  /** Tool-use capability, whether tool-use reliability is measurable */
  supportsToolUse: boolean;
}

// ============================================================================
// Prompts and task classes
// ============================================================================

export type TaskClass =
  | "information_extraction"
  | "code_generation"
  | "agentic_tool_use"
  | "multi_step_reasoning"
  | "summarization"
  | "classification"
  | "refusal_handling"
  | "instruction_following"
  | "factual_recall"
  | "format_adherence";

/**
 * The structural shape of a prompt. The actual prompt text is held in the
 * private prompt set; the shape and metadata are public.
 */
export interface PromptDescriptor {
  /** Stable ID, e.g. "info_extract_001" */
  id: string;
  taskClass: TaskClass;
  /** Whether the prompt has a deterministic expected output */
  hasGroundTruth: boolean;
  /**
   * Expected output structure. Useful for the "structural similarity" sub-metric
   * even when the exact text varies.
   */
  expectedFormat: "free_text" | "json" | "code" | "structured_list" | "single_token" | "refusal";
  /** Hash of the prompt text, published so anyone can verify the prompt set hasn't been modified between runs */
  promptHash: string;
  /** Version of the prompt set this prompt belongs to */
  setVersion: string;
}

/** The full prompt set descriptor, published. The text itself is not. */
export interface PromptSetDescriptor {
  version: string;
  releasedAt: string;
  /** Frozen for the first 12 weeks of any version */
  frozenUntil: string;
  /** 10 prompts per task class, 10 task classes, 100 total */
  prompts: PromptDescriptor[];
  /** Hash of all prompt hashes concatenated, a single fingerprint for the set */
  setFingerprint: string;
  /** Statistical properties of the set */
  statistics: {
    averageInputLength: number;
    averageExpectedOutputLength: number;
    refusalProbeCount: number;
    toolUseScenarioCount: number;
  };
}

// ============================================================================
// Raw measurements (per prompt × per endpoint × per week)
// ============================================================================

export interface RawRunResult {
  promptId: string;
  endpointId: string;
  runAt: string;
  /** Settings actually used (some vendors don't support all settings) */
  settings: {
    temperature: number;
    seed: number | null;
    maxTokens: number;
  };
  outputText: string;
  outputTokens: number;
  /** Hash of the full response, for change detection without storing all history */
  outputHash: string;
  /** Stated confidence extracted from the response (NaN if none stated) */
  statedConfidence: number;
  /** Was this a refusal? */
  isRefusal: boolean;
  /** Was a safety filter invoked? */
  safetyFilterInvoked: boolean;
  /** Time to first token (ms) */
  ttftMs: number;
  /** Total latency (ms) */
  totalLatencyMs: number;
  /** Token throughput (tokens/sec) */
  throughputTps: number;
  /** Tool-use specific (null if not a tool-use prompt) */
  toolUse: ToolUseResult | null;
}

export interface ToolUseResult {
  /** Did the agent successfully call the expected tool? */
  correctToolCalled: boolean;
  /** Were the tool arguments valid (parseable, matching schema)? */
  validArguments: boolean;
  /** Did the tool return a result that was processed? */
  resultProcessed: boolean;
  /** Composite success score: 1.0 = full success, 0.0 = full failure */
  successScore: number;
}

// ============================================================================
// Per-prompt scores (vs. baseline)
// ============================================================================

export interface PerPromptScore {
  promptId: string;
  endpointId: string;
  week: string; // ISO week, e.g. "2026-W19"
  /** Lexical similarity vs. last week (BLEU/ROUGE-L composite) */
  lexicalSimilarity: number;
  /** Semantic similarity vs. last week (embedding cosine) */
  semanticSimilarity: number;
  /** Structural similarity vs. expected format (presence of keys, refusal patterns, etc.) */
  structuralSimilarity: number;
  /** Composite stability score: weighted average of the three above */
  compositeStability: number;
  /** Z-score of composite vs. 4-week rolling baseline */
  stabilityZ: number;
  /** Flagged as prompt-level drift event? */
  driftFlagged: boolean;
}

// ============================================================================
// Per-endpoint weekly aggregate
// ============================================================================

export interface EndpointWeekly {
  endpointId: string;
  vendor: VendorId;
  week: string;
  /** Dimension z-scores vs. 12-week baseline */
  outputStabilityZ: number;
  confidenceCalibrationZ: number;
  refusalRateZ: number;
  latencyVarianceZ: number;
  toolUseReliabilityZ: number;
  /** Composite CVRI score, 0–100 */
  cvri: number;
  /** Number of prompts that triggered prompt-level drift this week */
  driftedPromptCount: number;
  /** Was a vendor-level drift event flagged? */
  vendorLevelDrift: boolean;
  /** Number of incidents this week, by severity */
  incidentCounts: {
    informational: number;
    advisory: number;
    regression: number;
    critical: number;
  };
}

// ============================================================================
// Vendor-level weekly summary
// ============================================================================

export interface VendorWeekly {
  vendor: VendorId;
  week: string;
  /** Aggregate CVRI across all this vendor's tracked endpoints (weighted by traffic) */
  cvri: number;
  /** Δ from last week */
  cvriDelta: number;
  /** Drift events broken down by classification */
  drift: {
    silentDriftEvents: DriftEvent[];
    announcedDriftEvents: DriftEvent[];
  };
  status: "ok" | "advisory" | "regression" | "critical";
}

export interface DriftEvent {
  endpointId: string;
  taskClasses: TaskClass[];
  dimensionsAffected: Array<keyof EndpointWeekly>;
  magnitude: number; // standard deviations from baseline
  detectedAt: string;
  vendorDisclosure: {
    type: "none" | "release_note" | "model_card" | "status_page" | "blog_post";
    url: string | null;
    publishedAt: string | null;
  };
  editorialAnnotation: string; // 1–3 sentences interpreting likely cause
}

// ============================================================================
// Issue: the published artifact
// ============================================================================

export interface Issue {
  /** Issue number, e.g. 1 for charter */
  number: number;
  volume: number;
  week: string;
  publishedAt: string;
  methodologyVersion: string;
  promptSetVersion: string;
  /** One-paragraph editorial headline */
  headline: string;
  /** Per-vendor scorecards */
  vendors: VendorWeekly[];
  /** Notable incidents this week (cross-referenced from AI Incident Database etc.) */
  incidents: PublicIncident[];
  /** Pending methodology changes, vendor disputes, disclosure items */
  methodologyNotes: {
    pendingChanges: string[];
    vendorDisputes: VendorDispute[];
    disclosureItems: string[];
  };
  /** Forward-looking editorial */
  lookingAhead: string;
}

export interface PublicIncident {
  id: string;
  severity: "informational" | "advisory" | "regression" | "critical";
  vendor: VendorId | "other";
  product: string;
  sourceUrl: string;
  summary: string;
  implications: string;
}

export interface VendorDispute {
  vendor: VendorId;
  receivedAt: string;
  disputedFinding: string; // verbatim from vendor
  nobulexResponse: string;
  resolved: boolean;
  methodologyAdjustment: string | null;
}
