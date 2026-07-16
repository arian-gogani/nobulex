/**
 * Agent Reliability Index, Scoring Functions
 *
 * Pure functions that take raw measurements and produce per-prompt scores,
 * per-endpoint weekly aggregates, and the composite CVRI.
 *
 * All scoring functions are pure (no I/O) so they're trivially testable.
 *
 * The weights and thresholds are loaded from observatory/methodology-v0.1.json
 * (committed alongside this code) so methodology versioning is a config change,
 * not a code change.
 */

import type {
  RawRunResult,
  PerPromptScore,
  EndpointWeekly,
  VendorWeekly,
  VendorId,
} from "./types.js";

// ============================================================================
// Methodology weights (Charter Issue v0.1)
// ============================================================================

export const METHODOLOGY_V0_1 = {
  version: "v0.1",
  weights: {
    outputStability: 0.30,
    confidenceCalibration: 0.15,
    refusalRate: 0.20,
    latencyVariance: 0.10,
    toolUseReliability: 0.25,
  },
  // Sub-weights for the composite stability score within a single prompt
  stabilitySubWeights: {
    lexical: 0.30,
    semantic: 0.50,
    structural: 0.20,
  },
  drift: {
    promptLevelSigmaThreshold: 2.0, // standard deviations
    rollingBaselineWeeks: 4, // for prompt-level
    vendorBaselineWeeks: 12, // for endpoint-level z-scores
    vendorLevelMinDriftedPromptFraction: 0.15,
    vendorLevelMinCvriDelta: 5.0,
  },
} as const;

// ============================================================================
// Statistical helpers
// ============================================================================

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Z-score of `value` against a sample baseline.
 * Returns 0 if baseline has fewer than 2 observations.
 */
export function zscore(value: number, baseline: number[]): number {
  if (baseline.length < 2) return 0;
  const s = stddev(baseline);
  if (s === 0 || Number.isNaN(s)) return 0;
  return (value - mean(baseline)) / s;
}

// ============================================================================
// Per-prompt composite stability
// ============================================================================

/**
 * Combine lexical/semantic/structural similarity scores into one stability number.
 * All inputs are in [0, 1] where 1.0 = identical to prior week.
 */
export function compositeStability(
  lexical: number,
  semantic: number,
  structural: number,
  weights = METHODOLOGY_V0_1.stabilitySubWeights,
): number {
  return (
    weights.lexical * lexical +
    weights.semantic * semantic +
    weights.structural * structural
  );
}

/**
 * Score one prompt for one endpoint for one week.
 *
 * `currentRun` is this week's measurement.
 * `priorRuns` are last week's measurements for the same prompt+endpoint.
 * `recentStability` is the composite stability for the prior 4 weeks (for z-score).
 */
export function scorePrompt(args: {
  currentRun: RawRunResult;
  lexicalSimilarity: number;
  semanticSimilarity: number;
  structuralSimilarity: number;
  recentStability: number[]; // last 4 weeks of compositeStability
  week: string;
}): PerPromptScore {
  const composite = compositeStability(
    args.lexicalSimilarity,
    args.semanticSimilarity,
    args.structuralSimilarity,
  );
  const z = zscore(composite, args.recentStability);
  const driftFlagged =
    Math.abs(z) > METHODOLOGY_V0_1.drift.promptLevelSigmaThreshold;

  return {
    promptId: args.currentRun.promptId,
    endpointId: args.currentRun.endpointId,
    week: args.week,
    lexicalSimilarity: args.lexicalSimilarity,
    semanticSimilarity: args.semanticSimilarity,
    structuralSimilarity: args.structuralSimilarity,
    compositeStability: composite,
    stabilityZ: z,
    driftFlagged,
  };
}

// ============================================================================
// Endpoint-level aggregate (the 5 dimensions)
// ============================================================================

/** Compute per-endpoint dimension metrics from this week's raw run results. */
export function aggregateEndpointMetrics(runs: RawRunResult[]): {
  outputStability: number; // mean composite stability across all prompts for this endpoint, this week
  meanStatedConfidence: number;
  varStatedConfidence: number;
  refusalRate: number;
  safetyFilterRate: number;
  meanLatencyMs: number;
  varLatencyMs: number;
  toolUseSuccessRate: number;
} {
  const stabilityValues = runs.map((r) => r.outputHash).length; // placeholder
  // In practice, stability comes from scorePrompt(); not from raw runs alone.
  // This helper focuses on the dimensions derivable directly from a single week's runs.

  const confidenceValues = runs
    .map((r) => r.statedConfidence)
    .filter((c) => !Number.isNaN(c));

  const refusals = runs.filter((r) => r.isRefusal).length;
  const safetyFilters = runs.filter((r) => r.safetyFilterInvoked).length;

  const latencies = runs.map((r) => r.totalLatencyMs);

  const toolUseRuns = runs.filter((r) => r.toolUse !== null);
  const toolUseSuccessSum = toolUseRuns.reduce(
    (acc, r) => acc + (r.toolUse?.successScore ?? 0),
    0,
  );

  return {
    outputStability: NaN, // computed externally from scorePrompt
    meanStatedConfidence: confidenceValues.length > 0 ? mean(confidenceValues) : NaN,
    varStatedConfidence:
      confidenceValues.length > 1 ? stddev(confidenceValues) ** 2 : NaN,
    refusalRate: runs.length > 0 ? refusals / runs.length : 0,
    safetyFilterRate: runs.length > 0 ? safetyFilters / runs.length : 0,
    meanLatencyMs: latencies.length > 0 ? mean(latencies) : NaN,
    varLatencyMs: latencies.length > 1 ? stddev(latencies) ** 2 : NaN,
    toolUseSuccessRate:
      toolUseRuns.length > 0 ? toolUseSuccessSum / toolUseRuns.length : NaN,
  };
}

/**
 * Compute the CVRI composite score for an endpoint, given this week's dimension
 * z-scores. The z-scores are computed externally against the 12-week baseline
 * by the caller (typically in run-weekly.ts).
 *
 * Formula:
 *   CVRI = 100 - sum(w_i * |z_i|)
 *
 * The score is clamped to [0, 100]; in practice severely-drifted endpoints
 * can produce raw CVRI < 0 which we clamp to 0 for presentation.
 */
export function computeCvri(zscores: {
  outputStabilityZ: number;
  confidenceCalibrationZ: number;
  refusalRateZ: number;
  latencyVarianceZ: number;
  toolUseReliabilityZ: number;
}): number {
  const w = METHODOLOGY_V0_1.weights;
  const raw =
    100 -
    (w.outputStability * Math.abs(zscores.outputStabilityZ) +
      w.confidenceCalibration * Math.abs(zscores.confidenceCalibrationZ) +
      w.refusalRate * Math.abs(zscores.refusalRateZ) +
      w.latencyVariance * Math.abs(zscores.latencyVarianceZ) +
      w.toolUseReliability * Math.abs(zscores.toolUseReliabilityZ));
  return Math.max(0, Math.min(100, raw));
}

/** CVRI status bands per Methodology v0.1. */
export function cvriStatus(cvri: number): "ok" | "advisory" | "regression" | "critical" {
  if (cvri >= 95) return "ok";
  if (cvri >= 85) return "advisory";
  if (cvri >= 70) return "regression";
  return "critical";
}

// ============================================================================
// Vendor-level rollup
// ============================================================================

/**
 * Aggregate per-endpoint CVRI scores into a single per-vendor CVRI.
 * Weights endpoints by relative traffic (default: equal weight if not provided).
 */
export function rollupVendorCvri(
  endpoints: EndpointWeekly[],
  trafficWeights?: Record<string, number>,
): number {
  if (endpoints.length === 0) return NaN;
  if (!trafficWeights) {
    return mean(endpoints.map((e) => e.cvri));
  }
  let weightedSum = 0;
  let totalWeight = 0;
  for (const e of endpoints) {
    const w = trafficWeights[e.endpointId] ?? 1.0;
    weightedSum += w * e.cvri;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : NaN;
}

// ============================================================================
// Vendor-level drift event detection
// ============================================================================

/**
 * Check whether this week's per-endpoint metrics constitute a vendor-level
 * drift event per Methodology v0.1.
 */
export function isVendorLevelDrift(
  driftedPromptCount: number,
  totalPromptCount: number,
  cvriDelta: number,
): boolean {
  if (totalPromptCount === 0) return false;
  const fraction = driftedPromptCount / totalPromptCount;
  return (
    fraction >= METHODOLOGY_V0_1.drift.vendorLevelMinDriftedPromptFraction &&
    Math.abs(cvriDelta) >= METHODOLOGY_V0_1.drift.vendorLevelMinCvriDelta
  );
}
