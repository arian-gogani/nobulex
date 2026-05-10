/**
 * Tests for Agent Reliability Index scoring functions.
 *
 * The scoring is methodologically sensitive — small bugs here would produce
 * wrong public weekly issues. Test coverage matters.
 */

import { describe, it, expect } from "vitest";
import {
  mean,
  stddev,
  zscore,
  compositeStability,
  scorePrompt,
  computeCvri,
  cvriStatus,
  rollupVendorCvri,
  isVendorLevelDrift,
  METHODOLOGY_V0_1,
} from "./scoring.js";
import type { EndpointWeekly, RawRunResult } from "./types.js";

// ============================================================================
// Statistical helpers
// ============================================================================

describe("statistical helpers", () => {
  describe("mean", () => {
    it("returns NaN for empty array", () => {
      expect(mean([])).toBeNaN();
    });
    it("returns the value for single element", () => {
      expect(mean([42])).toBe(42);
    });
    it("returns the average for multiple elements", () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });
    it("handles negative numbers", () => {
      expect(mean([-2, 0, 2])).toBe(0);
    });
  });

  describe("stddev", () => {
    it("returns NaN for < 2 elements", () => {
      expect(stddev([])).toBeNaN();
      expect(stddev([5])).toBeNaN();
    });
    it("returns 0 for identical values (with 2+ elements)", () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });
    it("computes sample standard deviation (n-1 denominator)", () => {
      // sample std dev of [2, 4, 4, 4, 5, 5, 7, 9]:
      //   mean = 5, sum of squared deviations = 32
      //   variance = 32/7 ≈ 4.571, stddev ≈ 2.138
      expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    });
  });

  describe("zscore", () => {
    it("returns 0 for empty baseline", () => {
      expect(zscore(5, [])).toBe(0);
    });
    it("returns 0 for single-element baseline", () => {
      expect(zscore(5, [3])).toBe(0);
    });
    it("returns 0 when baseline has zero variance", () => {
      expect(zscore(5, [3, 3, 3, 3])).toBe(0);
    });
    it("computes z-score correctly for typical baseline", () => {
      const baseline = [10, 12, 14, 16, 18];
      // mean = 14, stddev (sample) = sqrt(((-4)^2 + (-2)^2 + 0 + 2^2 + 4^2) / 4) = sqrt(10) ≈ 3.162
      // z(20) = (20 - 14) / sqrt(10) ≈ 1.897
      expect(zscore(20, baseline)).toBeCloseTo(1.897, 3);
    });
  });
});

// ============================================================================
// Composite stability
// ============================================================================

describe("compositeStability", () => {
  it("returns 1.0 when all sub-metrics are 1.0", () => {
    expect(compositeStability(1, 1, 1)).toBeCloseTo(1.0, 5);
  });
  it("returns 0.0 when all sub-metrics are 0.0", () => {
    expect(compositeStability(0, 0, 0)).toBe(0);
  });
  it("respects default weights (lexical 0.30, semantic 0.50, structural 0.20)", () => {
    // If lexical=1, semantic=0, structural=0, expect 0.30
    expect(compositeStability(1, 0, 0)).toBeCloseTo(0.30, 5);
    // If lexical=0, semantic=1, structural=0, expect 0.50
    expect(compositeStability(0, 1, 0)).toBeCloseTo(0.50, 5);
    // If lexical=0, semantic=0, structural=1, expect 0.20
    expect(compositeStability(0, 0, 1)).toBeCloseTo(0.20, 5);
  });
  it("respects custom weights", () => {
    const result = compositeStability(1, 0, 0, { lexical: 0.5, semantic: 0.3, structural: 0.2 });
    expect(result).toBeCloseTo(0.5, 5);
  });
});

// ============================================================================
// scorePrompt
// ============================================================================

describe("scorePrompt", () => {
  const baseRun: RawRunResult = {
    promptId: "info_extract_001",
    endpointId: "anthropic:claude-flagship",
    runAt: "2026-05-11T00:00:00Z",
    settings: { temperature: 0, seed: 42, maxTokens: 1000 },
    outputText: "Sample output",
    outputTokens: 100,
    outputHash: "abc123",
    statedConfidence: 0.9,
    isRefusal: false,
    safetyFilterInvoked: false,
    ttftMs: 200,
    totalLatencyMs: 1500,
    throughputTps: 50,
    toolUse: null,
  };

  it("flags drift when stability composite is >2σ below baseline", () => {
    // Baseline is ~0.95 with low variance; this week's 0.40 is far below
    const result = scorePrompt({
      currentRun: baseRun,
      lexicalSimilarity: 0.4,
      semanticSimilarity: 0.4,
      structuralSimilarity: 0.4,
      recentStability: [0.95, 0.96, 0.94, 0.95],
      week: "2026-W19",
    });
    expect(result.driftFlagged).toBe(true);
    expect(result.stabilityZ).toBeLessThan(-METHODOLOGY_V0_1.drift.promptLevelSigmaThreshold);
  });

  it("does not flag drift for normal week-over-week variation", () => {
    const result = scorePrompt({
      currentRun: baseRun,
      lexicalSimilarity: 0.94,
      semanticSimilarity: 0.95,
      structuralSimilarity: 0.96,
      recentStability: [0.95, 0.96, 0.94, 0.95],
      week: "2026-W19",
    });
    expect(result.driftFlagged).toBe(false);
  });

  it("does not flag drift when baseline is too short for z-score", () => {
    const result = scorePrompt({
      currentRun: baseRun,
      lexicalSimilarity: 0.1,
      semanticSimilarity: 0.1,
      structuralSimilarity: 0.1,
      recentStability: [], // empty baseline
      week: "2026-W19",
    });
    expect(result.driftFlagged).toBe(false);
    expect(result.stabilityZ).toBe(0);
  });
});

// ============================================================================
// CVRI composite
// ============================================================================

describe("computeCvri", () => {
  it("returns 100 when all z-scores are 0 (no drift)", () => {
    const cvri = computeCvri({
      outputStabilityZ: 0,
      confidenceCalibrationZ: 0,
      refusalRateZ: 0,
      latencyVarianceZ: 0,
      toolUseReliabilityZ: 0,
    });
    expect(cvri).toBe(100);
  });

  it("subtracts weighted absolute z-scores from 100", () => {
    // Pure output_stability drift of 2.0σ: expect 100 - 0.30 * 2.0 = 99.4
    const cvri = computeCvri({
      outputStabilityZ: 2.0,
      confidenceCalibrationZ: 0,
      refusalRateZ: 0,
      latencyVarianceZ: 0,
      toolUseReliabilityZ: 0,
    });
    expect(cvri).toBeCloseTo(99.4, 5);
  });

  it("treats positive and negative z-scores identically (drift in either direction)", () => {
    const positive = computeCvri({
      outputStabilityZ: 3,
      confidenceCalibrationZ: 0,
      refusalRateZ: 0,
      latencyVarianceZ: 0,
      toolUseReliabilityZ: 0,
    });
    const negative = computeCvri({
      outputStabilityZ: -3,
      confidenceCalibrationZ: 0,
      refusalRateZ: 0,
      latencyVarianceZ: 0,
      toolUseReliabilityZ: 0,
    });
    expect(positive).toBeCloseTo(negative, 5);
  });

  it("clamps to [0, 100] for severe drift", () => {
    const cvri = computeCvri({
      outputStabilityZ: 1000,
      confidenceCalibrationZ: 1000,
      refusalRateZ: 1000,
      latencyVarianceZ: 1000,
      toolUseReliabilityZ: 1000,
    });
    expect(cvri).toBe(0);
  });
});

// ============================================================================
// CVRI status bands
// ============================================================================

describe("cvriStatus", () => {
  it("classifies score bands per methodology v0.1", () => {
    expect(cvriStatus(100)).toBe("ok");
    expect(cvriStatus(95)).toBe("ok");
    expect(cvriStatus(94.99)).toBe("advisory");
    expect(cvriStatus(85)).toBe("advisory");
    expect(cvriStatus(84.99)).toBe("regression");
    expect(cvriStatus(70)).toBe("regression");
    expect(cvriStatus(69.99)).toBe("critical");
    expect(cvriStatus(0)).toBe("critical");
  });
});

// ============================================================================
// Vendor rollup
// ============================================================================

describe("rollupVendorCvri", () => {
  const mkEndpoint = (id: string, cvri: number): EndpointWeekly => ({
    endpointId: id,
    vendor: "anthropic",
    week: "2026-W19",
    outputStabilityZ: 0,
    confidenceCalibrationZ: 0,
    refusalRateZ: 0,
    latencyVarianceZ: 0,
    toolUseReliabilityZ: 0,
    cvri,
    driftedPromptCount: 0,
    vendorLevelDrift: false,
    incidentCounts: { informational: 0, advisory: 0, regression: 0, critical: 0 },
  });

  it("returns NaN for empty endpoint list", () => {
    expect(rollupVendorCvri([])).toBeNaN();
  });

  it("uses simple mean when no traffic weights provided", () => {
    const result = rollupVendorCvri([
      mkEndpoint("a", 100),
      mkEndpoint("b", 90),
    ]);
    expect(result).toBeCloseTo(95, 5);
  });

  it("uses weighted mean when traffic weights provided", () => {
    // a has 9x the traffic of b
    const result = rollupVendorCvri(
      [mkEndpoint("a", 100), mkEndpoint("b", 0)],
      { a: 9, b: 1 },
    );
    expect(result).toBeCloseTo(90, 5);
  });
});

// ============================================================================
// Vendor-level drift detection
// ============================================================================

describe("isVendorLevelDrift", () => {
  it("does not flag when fewer than 15% of prompts drifted", () => {
    expect(isVendorLevelDrift(10, 100, 10)).toBe(false);
  });

  it("does not flag when CVRI delta is less than 5", () => {
    expect(isVendorLevelDrift(20, 100, 2)).toBe(false);
  });

  it("flags when both thresholds are met", () => {
    expect(isVendorLevelDrift(20, 100, 6)).toBe(true);
    expect(isVendorLevelDrift(15, 100, 5)).toBe(true);
  });

  it("treats positive and negative CVRI delta identically", () => {
    expect(isVendorLevelDrift(20, 100, -6)).toBe(true);
  });

  it("does not flag for empty prompt set", () => {
    expect(isVendorLevelDrift(0, 0, 10)).toBe(false);
  });
});
