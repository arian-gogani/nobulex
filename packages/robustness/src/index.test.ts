import { describe, it, expect } from 'vitest';
import {
  proveRobustness,
  fuzz,
  generateAdversarialInputs,
  assessSeverity,
} from './index';
import type {
  CovenantSpec,
  ConstraintSpec,
  InputBound,
} from './types';

// ---------------------------------------------------------------------------
// assessSeverity
// ---------------------------------------------------------------------------
describe('assessSeverity', () => {
  it('returns critical for deny constraints', () => {
    const spec: ConstraintSpec = { rule: 'no-delete', type: 'deny', action: 'delete', resource: 'users' };
    expect(assessSeverity(spec)).toBe('critical');
  });

  it('returns high for require constraints', () => {
    const spec: ConstraintSpec = { rule: 'require-auth', type: 'require', action: 'auth' };
    expect(assessSeverity(spec)).toBe('high');
  });

  it('returns medium for limit constraints', () => {
    const spec: ConstraintSpec = { rule: 'rate-limit', type: 'limit', action: 'request' };
    expect(assessSeverity(spec)).toBe('medium');
  });

  it('returns low for permit constraints', () => {
    const spec: ConstraintSpec = { rule: 'allow-read', type: 'permit', action: 'read', resource: 'public' };
    expect(assessSeverity(spec)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// proveRobustness
// ---------------------------------------------------------------------------
describe('proveRobustness', () => {
  const simpleCovenant: CovenantSpec = {
    id: 'cov-1',
    constraints: [
      { rule: 'no-delete', type: 'deny', action: 'delete', resource: 'users' },
      { rule: 'require-auth', type: 'require', action: 'auth' },
    ],
  };

  it('returns a RobustnessProof with the correct covenantId', () => {
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 0, max: 5 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.covenantId).toBe('cov-1');
  });

  it('returns the correct constraint name in the proof', () => {
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 0, max: 5 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.constraint).toBe('no-delete');
  });

  it('uses exhaustive method for small input spaces (<= 1000)', () => {
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 0, max: 10 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.method).toBe('exhaustive');
  });

  it('uses statistical method for large input spaces (> 1000)', () => {
    const bounds: InputBound = {
      dimensions: ['x', 'y'],
      ranges: { x: { min: 0, max: 100 }, y: { min: 0, max: 100 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.method).toBe('statistical');
  });

  it('returns confidence between 0 and 1 for exhaustive method', () => {
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 0, max: 5 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'require-auth', bounds);
    expect(proof.confidence).toBeGreaterThanOrEqual(0);
    expect(proof.confidence).toBeLessThanOrEqual(1);
  });

  it('returns confidence between 0 and 1 for statistical method', () => {
    const bounds: InputBound = {
      dimensions: ['x', 'y'],
      ranges: { x: { min: 0, max: 500 }, y: { min: 0, max: 500 } },
      distribution: 'adversarial',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.confidence).toBeGreaterThanOrEqual(0);
    expect(proof.confidence).toBeLessThanOrEqual(1);
  });

  it('returns counterexample when verification fails', () => {
    // Run many proofs until we find one that fails, or confirm the structure is correct
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 0, max: 50 } },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    if (!proof.verified) {
      expect(proof.counterexample).toBeDefined();
    } else {
      expect(proof.counterexample).toBeUndefined();
    }
  });

  it('stores inputBound in the proof', () => {
    const bounds: InputBound = {
      dimensions: ['x'],
      ranges: { x: { min: 1, max: 3 } },
      distribution: 'realistic',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.inputBound).toBe(bounds);
  });

  it('handles empty dimensions with a single test', () => {
    const bounds: InputBound = {
      dimensions: [],
      ranges: {},
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.method).toBe('exhaustive');
    expect(typeof proof.verified).toBe('boolean');
  });

  it('handles multi-dimensional bounds', () => {
    const bounds: InputBound = {
      dimensions: ['x', 'y', 'z'],
      ranges: {
        x: { min: 0, max: 5 },
        y: { min: 0, max: 5 },
        z: { min: 0, max: 5 },
      },
      distribution: 'uniform',
    };
    const proof = proveRobustness(simpleCovenant, 'no-delete', bounds);
    expect(proof.method).toBe('exhaustive');
    expect(proof.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fuzz
// ---------------------------------------------------------------------------
describe('fuzz', () => {
  it('returns a report with the correct covenantId', () => {
    const covenant: CovenantSpec = {
      id: 'fuzz-cov',
      constraints: [{ rule: 'rule-a', type: 'permit', action: 'read' }],
    };
    const report = fuzz(covenant, 10);
    expect(report.covenantId).toBe('fuzz-cov');
  });

  it('returns constraintsTested equal to the number of constraints', () => {
    const covenant: CovenantSpec = {
      id: 'fuzz-cov-2',
      constraints: [
        { rule: 'rule-a', type: 'permit' },
        { rule: 'rule-b', type: 'deny' },
        { rule: 'rule-c', type: 'require' },
      ],
    };
    const report = fuzz(covenant, 50);
    expect(report.constraintsTested).toBe(3);
  });

  it('constraintsPassed + vulnerabilities.length equals constraintsTested', () => {
    const covenant: CovenantSpec = {
      id: 'fuzz-cov-3',
      constraints: [
        { rule: 'rule-x', type: 'permit' },
        { rule: 'rule-y', type: 'deny' },
      ],
    };
    const report = fuzz(covenant, 100);
    expect(report.constraintsPassed + report.vulnerabilities.length).toBe(report.constraintsTested);
  });

  it('overallRobustness is between 0 and 1', () => {
    const covenant: CovenantSpec = {
      id: 'fuzz-cov-4',
      constraints: [
        { rule: 'r1', type: 'permit' },
        { rule: 'r2', type: 'deny' },
        { rule: 'r3', type: 'limit' },
      ],
    };
    const report = fuzz(covenant, 50);
    expect(report.overallRobustness).toBeGreaterThanOrEqual(0);
    expect(report.overallRobustness).toBeLessThanOrEqual(1);
  });

  it('overallRobustness equals constraintsPassed / constraintsTested', () => {
    const covenant: CovenantSpec = {
      id: 'fuzz-cov-5',
      constraints: [
        { rule: 'rule-1', type: 'permit' },
        { rule: 'rule-2', type: 'require' },
      ],
    };
    const report = fuzz(covenant, 50);
    expect(report.overallRobustness).toBeCloseTo(
      report.constraintsPassed / report.constraintsTested,
      5
    );
  });

  it('handles a covenant with no constraints', () => {
    const covenant: CovenantSpec = {
      id: 'empty-cov',
      constraints: [],
    };
    const report = fuzz(covenant, 10);
    expect(report.constraintsTested).toBe(0);
    expect(report.constraintsPassed).toBe(0);
    expect(report.vulnerabilities).toHaveLength(0);
    expect(report.overallRobustness).toBe(1);
  });

  it('vulnerability severity matches the constraint type', () => {
    const covenant: CovenantSpec = {
      id: 'sev-cov',
      constraints: [
        { rule: 'deny-rule', type: 'deny', action: 'destroy' },
      ],
    };
    // Run with enough iterations to likely find a vulnerability
    const report = fuzz(covenant, 500);
    for (const vuln of report.vulnerabilities) {
      if (vuln.constraint === 'deny-rule') {
        expect(vuln.severity).toBe('critical');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateAdversarialInputs
// ---------------------------------------------------------------------------
describe('generateAdversarialInputs', () => {
  it('returns the requested number of inputs', () => {
    const inputs = generateAdversarialInputs('deny delete users', 10);
    expect(inputs).toHaveLength(10);
  });

  it('each input has action, resource, and context fields', () => {
    const inputs = generateAdversarialInputs('no-access', 5);
    for (const input of inputs) {
      expect(input).toHaveProperty('action');
      expect(input).toHaveProperty('resource');
      expect(input).toHaveProperty('context');
    }
  });

  it('generates empty-string boundary inputs', () => {
    const inputs = generateAdversarialInputs('constraint-a', 5);
    // Index 0 should be the empty-string boundary
    expect(inputs[0]!.action).toBe('');
    expect(inputs[0]!.resource).toBe('');
  });

  it('generates overflow boundary inputs', () => {
    const inputs = generateAdversarialInputs('constraint-b', 5);
    // Index 1 should be the overflow boundary
    expect(inputs[1]!.action.length).toBeGreaterThan(0);
    expect(inputs[1]!.resource.length).toBeGreaterThan(0);
  });

  it('generates traversal boundary inputs', () => {
    const inputs = generateAdversarialInputs('constraint-c', 5);
    // Index 2 should contain path traversal attempt
    expect(inputs[2]!.resource).toContain('../');
  });

  it('generates case variation inputs', () => {
    const inputs = generateAdversarialInputs('my-rule', 5);
    // Index 3 should be case variation
    expect(inputs[3]!.action).toBe('MY-RULE');
    expect(inputs[3]!.resource).toBe('my-rule');
  });

  it('returns empty array for count=0', () => {
    const inputs = generateAdversarialInputs('any', 0);
    expect(inputs).toHaveLength(0);
  });

  it('generates deterministic outputs for the same constraint', () => {
    const a = generateAdversarialInputs('same-constraint', 5);
    const b = generateAdversarialInputs('same-constraint', 5);
    expect(a).toEqual(b);
  });
});
