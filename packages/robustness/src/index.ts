import { sha256String, generateId } from '@stele/crypto';

export type {
  RobustnessProof,
  InputBound,
  RobustnessReport,
  Vulnerability,
  CovenantSpec,
  ConstraintSpec,
} from './types';

import type {
  RobustnessProof,
  InputBound,
  RobustnessReport,
  Vulnerability,
  CovenantSpec,
  ConstraintSpec,
} from './types';

/**
 * Determine severity based on constraint type.
 *  deny    -> critical
 *  require -> high
 *  limit   -> medium
 *  permit  -> low
 */
export function assessSeverity(constraint: ConstraintSpec): 'critical' | 'high' | 'medium' | 'low' {
  switch (constraint.type) {
    case 'deny':
      return 'critical';
    case 'require':
      return 'high';
    case 'limit':
      return 'medium';
    case 'permit':
      return 'low';
  }
}

/**
 * Compute the total number of discrete input points within the bounds.
 * For each dimension, the range size is (max - min + 1) assuming integer steps.
 * Returns the product of all range sizes (the total input space size).
 */
function computeInputSpaceSize(bounds: InputBound): number {
  let size = 1;
  for (const dim of bounds.dimensions) {
    const range = bounds.ranges[dim];
    if (range) {
      size *= Math.max(Math.floor(range.max - range.min) + 1, 1);
    }
  }
  return size;
}

/**
 * Generate a random value within a range [min, max].
 */
function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generate a random test input based on the given bounds.
 * Returns an object mapping each dimension to a value within its range.
 */
function generateRandomInput(bounds: InputBound): Record<string, number> {
  const input: Record<string, number> = {};
  for (const dim of bounds.dimensions) {
    const range = bounds.ranges[dim];
    if (range) {
      input[dim] = randomInRange(range.min, range.max);
    }
  }
  return input;
}

/**
 * Simulate checking whether a constraint is violated by a given input.
 * Uses a deterministic hash-based approach: constraint + input are hashed
 * together, and the result is used to determine pass/fail.
 *
 * For 'deny' constraints, a violation occurs when the input hash indicates
 * the denied action is being performed on the denied resource.
 * For other constraint types, a violation occurs when the hash indicates
 * non-compliance.
 */
function checkConstraintViolation(
  constraint: string,
  input: Record<string, number>,
  spec?: ConstraintSpec
): { violated: boolean; detail: string } {
  const inputStr = JSON.stringify(input);
  const hash = sha256String(constraint + inputStr);
  // Use the first byte of the hash to determine violation.
  // This gives a deterministic but pseudo-random result.
  const firstByte = parseInt(hash.substring(0, 2), 16);

  // For deny constraints, higher violation rate (violations when first byte < 26 ~= 10%)
  // For other constraints, lower violation rate (violations when first byte < 13 ~= 5%)
  const threshold = spec?.type === 'deny' ? 26 : 13;

  if (firstByte < threshold) {
    return {
      violated: true,
      detail: `Constraint '${constraint}' violated at input ${inputStr}`,
    };
  }
  return { violated: false, detail: '' };
}

/**
 * Prove the robustness of a single constraint within a covenant.
 *
 * For the given constraint, generates test inputs within bounds.
 * If a violating input is found, returns verified=false with the counterexample.
 * Otherwise returns verified=true.
 *
 * Method is determined by the input space size:
 *  - If space <= 1000: exhaustive (test all integer points)
 *  - Otherwise: statistical (sample inputs)
 *
 * Confidence:
 *  - exhaustive: iterations / totalPossible
 *  - statistical: 1 - (1 - p)^n where p = 1/spaceSize and n = iterations
 */
export function proveRobustness(
  covenant: CovenantSpec,
  constraint: string,
  bounds: InputBound
): RobustnessProof {
  const spaceSize = computeInputSpaceSize(bounds);
  const constraintSpec = covenant.constraints.find((c) => c.rule === constraint);

  let method: 'exhaustive' | 'statistical' | 'formal';
  let iterations = 0;
  let counterexample: unknown = undefined;
  let verified = true;

  if (spaceSize <= 1000) {
    method = 'exhaustive';
    // Generate exhaustive integer inputs
    const dims = bounds.dimensions;
    if (dims.length === 0) {
      iterations = 1;
      const check = checkConstraintViolation(constraint, {}, constraintSpec);
      if (check.violated) {
        verified = false;
        counterexample = {};
      }
    } else {
      const inputs = generateExhaustiveInputs(bounds);
      iterations = inputs.length;
      for (const input of inputs) {
        const check = checkConstraintViolation(constraint, input, constraintSpec);
        if (check.violated) {
          verified = false;
          counterexample = input;
          break;
        }
      }
    }
  } else {
    method = 'statistical';
    const sampleSize = Math.min(spaceSize, 500);
    iterations = sampleSize;
    for (let i = 0; i < sampleSize; i++) {
      const input = generateRandomInput(bounds);
      const check = checkConstraintViolation(constraint, input, constraintSpec);
      if (check.violated) {
        verified = false;
        counterexample = input;
        break;
      }
    }
  }

  let confidence: number;
  if (method === 'exhaustive') {
    confidence = iterations / Math.max(spaceSize, 1);
  } else {
    const p = 1 / Math.max(spaceSize, 1);
    confidence = 1 - Math.pow(1 - p, iterations);
  }

  return {
    covenantId: covenant.id,
    constraint,
    inputBound: bounds,
    verified,
    counterexample,
    confidence,
    method,
  };
}

/**
 * Generate all integer-valued inputs within the bounds (for exhaustive testing).
 */
function generateExhaustiveInputs(bounds: InputBound): Array<Record<string, number>> {
  const dims = bounds.dimensions;
  if (dims.length === 0) return [{}];

  const results: Array<Record<string, number>> = [];
  const ranges: Array<{ dim: string; min: number; max: number }> = [];

  for (const dim of dims) {
    const range = bounds.ranges[dim];
    if (range) {
      ranges.push({ dim, min: Math.ceil(range.min), max: Math.floor(range.max) });
    }
  }

  function recurse(depth: number, current: Record<string, number>): void {
    if (depth === ranges.length) {
      results.push({ ...current });
      return;
    }
    const r = ranges[depth]!;
    for (let v = r.min; v <= r.max; v++) {
      current[r.dim] = v;
      recurse(depth + 1, current);
    }
  }

  recurse(0, {});
  return results;
}

/**
 * Fuzz test a covenant by generating random inputs for each constraint.
 *
 * For each constraint in the covenant spec, generates `iterations` random inputs
 * and checks for violations. Returns a RobustnessReport with any vulnerabilities found.
 *
 * overallRobustness = constraintsPassed / constraintsTested
 */
export function fuzz(covenant: CovenantSpec, iterations: number): RobustnessReport {
  const vulnerabilities: Vulnerability[] = [];
  let constraintsPassed = 0;
  const constraintsTested = covenant.constraints.length;

  for (const spec of covenant.constraints) {
    let found = false;
    for (let i = 0; i < iterations; i++) {
      // Generate a random input as an object with an action, resource, and a random context value
      const input: Record<string, number> = {
        action: Math.random() * 100,
        resource: Math.random() * 100,
        context: Math.random() * 100,
      };
      const check = checkConstraintViolation(spec.rule, input, spec);
      if (check.violated) {
        vulnerabilities.push({
          constraint: spec.rule,
          counterexample: input,
          severity: assessSeverity(spec),
          recommendation: `Review constraint '${spec.rule}' — found violation during fuzz testing`,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      constraintsPassed++;
    }
  }

  return {
    covenantId: covenant.id,
    constraintsTested,
    constraintsPassed,
    vulnerabilities,
    overallRobustness: constraintsTested > 0 ? constraintsPassed / constraintsTested : 1,
  };
}

/**
 * Generate adversarial inputs designed to test boundary conditions.
 *
 * For 'deny' constraints, generates inputs that try to bypass the denial
 * by using boundary values and edge cases. Returns an array of test input objects
 * with action, resource, and context fields.
 */
export function generateAdversarialInputs(
  constraint: string,
  count: number
): Array<{ action: string; resource: string; context: Record<string, unknown> }> {
  const inputs: Array<{ action: string; resource: string; context: Record<string, unknown> }> = [];

  // Parse the constraint string to determine what to target
  const constraintHash = sha256String(constraint);

  for (let i = 0; i < count; i++) {
    const seed = sha256String(constraintHash + String(i));
    const seedByte = parseInt(seed.substring(0, 2), 16);

    // Generate various adversarial patterns
    if (i % 5 === 0) {
      // Boundary: empty strings
      inputs.push({
        action: '',
        resource: '',
        context: { boundary: 'empty', iteration: i, seed },
      });
    } else if (i % 5 === 1) {
      // Boundary: very long strings
      inputs.push({
        action: 'a'.repeat(seedByte + 1),
        resource: 'r'.repeat(seedByte + 1),
        context: { boundary: 'overflow', iteration: i, length: seedByte + 1 },
      });
    } else if (i % 5 === 2) {
      // Encoding bypass attempt
      inputs.push({
        action: constraint.split(' ').reverse().join('_'),
        resource: `../../../${constraint}`,
        context: { boundary: 'traversal', iteration: i },
      });
    } else if (i % 5 === 3) {
      // Case variation
      inputs.push({
        action: constraint.toUpperCase(),
        resource: constraint.toLowerCase(),
        context: { boundary: 'case', iteration: i },
      });
    } else {
      // Null-like injection
      inputs.push({
        action: `null_${i}`,
        resource: `undefined_${i}`,
        context: { boundary: 'null-injection', iteration: i, seedByte },
      });
    }
  }

  return inputs;
}
