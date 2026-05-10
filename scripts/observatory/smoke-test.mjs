/**
 * Smoke test for Agent Reliability Index scoring math.
 *
 * Runs with plain node — no test framework dependency. Verifies the core
 * statistical functions produce expected results on hand-computed inputs.
 *
 * Run with:  node scripts/observatory/smoke-test.mjs
 *
 * This is intentionally minimal. The full vitest test suite is in
 * scoring.test.ts and runs in the normal test pipeline.
 */

import assert from "node:assert/strict";

// ----- inline copies of the scoring functions (kept in sync with scoring.ts) -----

const METHODOLOGY_V0_1 = {
  weights: {
    outputStability: 0.30,
    confidenceCalibration: 0.15,
    refusalRate: 0.20,
    latencyVariance: 0.10,
    toolUseReliability: 0.25,
  },
  stabilitySubWeights: { lexical: 0.30, semantic: 0.50, structural: 0.20 },
  drift: {
    promptLevelSigmaThreshold: 2.0,
    vendorLevelMinDriftedPromptFraction: 0.15,
    vendorLevelMinCvriDelta: 5.0,
  },
};

const mean = (xs) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

const stddev = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, v) => acc + (v - m) ** 2, 0) / (xs.length - 1));
};

const zscore = (value, baseline) => {
  if (baseline.length < 2) return 0;
  const s = stddev(baseline);
  if (s === 0 || Number.isNaN(s)) return 0;
  return (value - mean(baseline)) / s;
};

const compositeStability = (lex, sem, struct) =>
  METHODOLOGY_V0_1.stabilitySubWeights.lexical * lex +
  METHODOLOGY_V0_1.stabilitySubWeights.semantic * sem +
  METHODOLOGY_V0_1.stabilitySubWeights.structural * struct;

const computeCvri = (z) => {
  const w = METHODOLOGY_V0_1.weights;
  const raw =
    100 -
    (w.outputStability * Math.abs(z.outputStabilityZ) +
      w.confidenceCalibration * Math.abs(z.confidenceCalibrationZ) +
      w.refusalRate * Math.abs(z.refusalRateZ) +
      w.latencyVariance * Math.abs(z.latencyVarianceZ) +
      w.toolUseReliability * Math.abs(z.toolUseReliabilityZ));
  return Math.max(0, Math.min(100, raw));
};

const cvriStatus = (cvri) => {
  if (cvri >= 95) return "ok";
  if (cvri >= 85) return "advisory";
  if (cvri >= 70) return "regression";
  return "critical";
};

const isVendorLevelDrift = (drifted, total, delta) => {
  if (total === 0) return false;
  return (
    drifted / total >= METHODOLOGY_V0_1.drift.vendorLevelMinDriftedPromptFraction &&
    Math.abs(delta) >= METHODOLOGY_V0_1.drift.vendorLevelMinCvriDelta
  );
};

// ----- the actual tests -----

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
};

const closeTo = (actual, expected, tolerance = 1e-5) => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be close to ${expected} (tolerance ${tolerance})`,
  );
};

console.log("\nAgent Reliability Index — scoring smoke tests\n");

console.log("Statistical helpers");
test("mean of [1,2,3,4,5] = 3", () => closeTo(mean([1, 2, 3, 4, 5]), 3));
test("mean of [] is NaN", () => assert.ok(Number.isNaN(mean([]))));
test("sample stddev of [2,4,4,4,5,5,7,9] ≈ 2.138 (n-1 denominator)", () =>
  closeTo(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.001));
test("stddev of [5,5,5,5] = 0", () => closeTo(stddev([5, 5, 5, 5]), 0));
test("zscore of 20 vs [10,12,14,16,18] ≈ 1.897", () =>
  closeTo(zscore(20, [10, 12, 14, 16, 18]), 1.897, 0.001));
test("zscore returns 0 for empty baseline", () => assert.equal(zscore(5, []), 0));
test("zscore returns 0 for zero-variance baseline", () =>
  assert.equal(zscore(5, [3, 3, 3, 3]), 0));

console.log("\nCompositeStability");
test("returns 1.0 when all sub-metrics are 1.0", () => closeTo(compositeStability(1, 1, 1), 1));
test("returns 0.30 for lexical=1, others=0", () => closeTo(compositeStability(1, 0, 0), 0.30));
test("returns 0.50 for semantic=1, others=0", () => closeTo(compositeStability(0, 1, 0), 0.50));
test("returns 0.20 for structural=1, others=0", () => closeTo(compositeStability(0, 0, 1), 0.20));

console.log("\nCVRI");
test("returns 100 when all z-scores are 0", () =>
  closeTo(
    computeCvri({ outputStabilityZ: 0, confidenceCalibrationZ: 0, refusalRateZ: 0, latencyVarianceZ: 0, toolUseReliabilityZ: 0 }),
    100,
  ));
test("subtracts 0.30 * 2.0 = 0.6 for pure 2σ output drift", () =>
  closeTo(
    computeCvri({ outputStabilityZ: 2.0, confidenceCalibrationZ: 0, refusalRateZ: 0, latencyVarianceZ: 0, toolUseReliabilityZ: 0 }),
    99.4,
  ));
test("treats positive and negative z-scores identically", () => {
  const pos = computeCvri({ outputStabilityZ: 3, confidenceCalibrationZ: 0, refusalRateZ: 0, latencyVarianceZ: 0, toolUseReliabilityZ: 0 });
  const neg = computeCvri({ outputStabilityZ: -3, confidenceCalibrationZ: 0, refusalRateZ: 0, latencyVarianceZ: 0, toolUseReliabilityZ: 0 });
  closeTo(pos, neg);
});
test("clamps to 0 for severe drift", () =>
  assert.equal(
    computeCvri({ outputStabilityZ: 1000, confidenceCalibrationZ: 1000, refusalRateZ: 1000, latencyVarianceZ: 1000, toolUseReliabilityZ: 1000 }),
    0,
  ));

console.log("\nCVRI status bands");
test("100 → ok", () => assert.equal(cvriStatus(100), "ok"));
test("95 → ok", () => assert.equal(cvriStatus(95), "ok"));
test("94.99 → advisory", () => assert.equal(cvriStatus(94.99), "advisory"));
test("85 → advisory", () => assert.equal(cvriStatus(85), "advisory"));
test("84.99 → regression", () => assert.equal(cvriStatus(84.99), "regression"));
test("70 → regression", () => assert.equal(cvriStatus(70), "regression"));
test("69.99 → critical", () => assert.equal(cvriStatus(69.99), "critical"));
test("0 → critical", () => assert.equal(cvriStatus(0), "critical"));

console.log("\nVendor-level drift detection");
test("not flagged when <15% of prompts drifted", () =>
  assert.equal(isVendorLevelDrift(10, 100, 10), false));
test("not flagged when CVRI delta <5", () =>
  assert.equal(isVendorLevelDrift(20, 100, 2), false));
test("flagged when both thresholds met (20/100 drifted, delta 6)", () =>
  assert.equal(isVendorLevelDrift(20, 100, 6), true));
test("flagged at exact thresholds (15/100 drifted, delta 5)", () =>
  assert.equal(isVendorLevelDrift(15, 100, 5), true));
test("treats positive and negative delta identically", () =>
  assert.equal(isVendorLevelDrift(20, 100, -6), true));
test("not flagged for empty prompt set", () => assert.equal(isVendorLevelDrift(0, 0, 10), false));

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
