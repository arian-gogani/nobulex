import { describe, it, expect } from 'vitest';
import {
  proveRobustness,
  fuzz,
  generateAdversarialInputs,
  assessSeverity,
  formalVerification,
  robustnessScore,
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

// ---------------------------------------------------------------------------
// formalVerification
// ---------------------------------------------------------------------------
describe('formalVerification', () => {
  it('returns consistent=true for non-conflicting constraints', () => {
    const covenant: CovenantSpec = {
      id: 'cov-1',
      constraints: [
        { rule: "deny delete on '/data'", type: 'deny', action: 'delete', resource: '/data' },
        { rule: "require auth on '/api'", type: 'require', action: 'auth', resource: '/api' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.consistent).toBe(true);
    expect(result.contradictions).toHaveLength(0);
  });

  it('detects contradictions between permit and deny on overlapping patterns', () => {
    const covenant: CovenantSpec = {
      id: 'cov-2',
      constraints: [
        { rule: "permit read on '/data'", type: 'permit', action: 'read', resource: '/data' },
        { rule: "deny read on '/data'", type: 'deny', action: 'read', resource: '/data' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.consistent).toBe(false);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it('identifies unreachable permits shadowed by denies', () => {
    const covenant: CovenantSpec = {
      id: 'cov-3',
      constraints: [
        { rule: "permit read on '/data'", type: 'permit', action: 'read', resource: '/data' },
        { rule: "deny read on '/data'", type: 'deny', action: 'read', resource: '/data' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.unreachableRules.length).toBeGreaterThan(0);
  });

  it('returns method=symbolic', () => {
    const covenant: CovenantSpec = {
      id: 'cov-4',
      constraints: [
        { rule: 'no-delete', type: 'deny', action: 'delete', resource: '/data' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.method).toBe('symbolic');
  });

  it('rulesAnalyzed equals number of constraints', () => {
    const covenant: CovenantSpec = {
      id: 'cov-5',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'a', resource: 'b' },
        { rule: 'r2', type: 'permit', action: 'c', resource: 'd' },
        { rule: 'r3', type: 'require', action: 'e' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.rulesAnalyzed).toBe(3);
  });

  it('handles empty constraints gracefully', () => {
    const covenant: CovenantSpec = {
      id: 'cov-empty',
      constraints: [],
    };
    const result = formalVerification(covenant);
    expect(result.consistent).toBe(true);
    expect(result.rulesAnalyzed).toBe(0);
  });

  it('throws when covenant is null', () => {
    expect(() => formalVerification(null as any)).toThrow('covenant must be a non-null object');
  });

  it('no contradiction between deny and require (same type family)', () => {
    const covenant: CovenantSpec = {
      id: 'cov-6',
      constraints: [
        { rule: "deny write on '/data'", type: 'deny', action: 'write', resource: '/data' },
        { rule: "require audit on '/data'", type: 'require', action: 'audit', resource: '/data' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.consistent).toBe(true);
  });

  it('contradiction severity is critical for deny-permit conflicts', () => {
    const covenant: CovenantSpec = {
      id: 'cov-7',
      constraints: [
        { rule: "permit exec on '/bin'", type: 'permit', action: 'exec', resource: '/bin' },
        { rule: "deny exec on '/bin'", type: 'deny', action: 'exec', resource: '/bin' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0]!.severity).toBe('critical');
  });

  it('contradiction description includes both rule texts', () => {
    const covenant: CovenantSpec = {
      id: 'cov-8',
      constraints: [
        { rule: "permit read on '/secret'", type: 'permit', action: 'read', resource: '/secret' },
        { rule: "deny read on '/secret'", type: 'deny', action: 'read', resource: '/secret' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.contradictions[0]!.description).toContain('permit');
    expect(result.contradictions[0]!.description).toContain('deny');
  });

  it('no contradictions for only-deny constraints', () => {
    const covenant: CovenantSpec = {
      id: 'cov-9',
      constraints: [
        { rule: "deny a on '/x'", type: 'deny', action: 'a', resource: '/x' },
        { rule: "deny b on '/y'", type: 'deny', action: 'b', resource: '/y' },
      ],
    };
    const result = formalVerification(covenant);
    expect(result.consistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// robustnessScore
// ---------------------------------------------------------------------------
describe('robustnessScore', () => {
  it('returns score between 0 and 1', () => {
    const covenant: CovenantSpec = {
      id: 'cov-1',
      constraints: [
        { rule: 'no-delete', type: 'deny', action: 'delete', resource: '/data' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('classification is one of strong, moderate, or weak', () => {
    const covenant: CovenantSpec = {
      id: 'cov-2',
      constraints: [
        { rule: 'no-delete', type: 'deny', action: 'delete', resource: '/data' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    expect(['strong', 'moderate', 'weak']).toContain(result.classification);
  });

  it('returns factors with name, score, weight, and contribution', () => {
    const covenant: CovenantSpec = {
      id: 'cov-3',
      constraints: [
        { rule: 'no-delete', type: 'deny', action: 'delete', resource: '/data' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    expect(result.factors.length).toBeGreaterThan(0);
    for (const f of result.factors) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.score).toBe('number');
      expect(typeof f.weight).toBe('number');
      expect(typeof f.contribution).toBe('number');
    }
  });

  it('factor weights sum to 1.0', () => {
    const covenant: CovenantSpec = {
      id: 'cov-4',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'a', resource: '/x' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    const totalWeight = result.factors.reduce((s, f) => s + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 10);
  });

  it('score equals sum of contributions', () => {
    const covenant: CovenantSpec = {
      id: 'cov-5',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'a', resource: '/x' },
        { rule: 'r2', type: 'permit', action: 'b', resource: '/y' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    const contributionSum = result.factors.reduce((s, f) => s + f.contribution, 0);
    expect(result.score).toBeCloseTo(contributionSum, 10);
  });

  it('provides recommendations when issues are found', () => {
    const covenant: CovenantSpec = {
      id: 'cov-6',
      constraints: [
        { rule: 'r1', type: 'deny', action: '**', resource: '**' },
      ],
    };
    const result = robustnessScore(covenant, 10);
    // With only deny type and wildcards, should recommend broader coverage and specificity
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('returns score of 0 for empty constraints', () => {
    const covenant: CovenantSpec = {
      id: 'cov-empty',
      constraints: [],
    };
    const result = robustnessScore(covenant);
    expect(result.score).toBe(0);
    expect(result.classification).toBe('weak');
  });

  it('throws when covenant is null', () => {
    expect(() => robustnessScore(null as any)).toThrow('covenant must be a non-null object');
  });

  it('higher coverage (more types) leads to better coverage factor', () => {
    const singleType: CovenantSpec = {
      id: 'cov-s',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'a', resource: '/x' },
      ],
    };
    const multiType: CovenantSpec = {
      id: 'cov-m',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'a', resource: '/x' },
        { rule: 'r2', type: 'permit', action: 'b', resource: '/y' },
        { rule: 'r3', type: 'require', action: 'c' },
        { rule: 'r4', type: 'limit', action: 'd' },
      ],
    };
    const s1 = robustnessScore(singleType, 10);
    const s2 = robustnessScore(multiType, 10);
    const s1Coverage = s1.factors.find(f => f.name === 'coverage');
    const s2Coverage = s2.factors.find(f => f.name === 'coverage');
    expect(s2Coverage!.score).toBeGreaterThan(s1Coverage!.score);
  });

  it('specific patterns lead to better specificity factor than wildcards', () => {
    const wildcardCov: CovenantSpec = {
      id: 'cov-w',
      constraints: [
        { rule: 'r1', type: 'deny', action: '**', resource: '**' },
      ],
    };
    const specificCov: CovenantSpec = {
      id: 'cov-sp',
      constraints: [
        { rule: 'r1', type: 'deny', action: 'file.delete', resource: '/data/important' },
      ],
    };
    const w = robustnessScore(wildcardCov, 10);
    const s = robustnessScore(specificCov, 10);
    const wSpec = w.factors.find(f => f.name === 'specificity');
    const sSpec = s.factors.find(f => f.name === 'specificity');
    expect(sSpec!.score).toBeGreaterThan(wSpec!.score);
  });

  it('consistent covenant scores higher on consistency factor than contradictory one', () => {
    const consistent: CovenantSpec = {
      id: 'cov-c',
      constraints: [
        { rule: "deny read on '/secret'", type: 'deny', action: 'read', resource: '/secret' },
      ],
    };
    const contradictory: CovenantSpec = {
      id: 'cov-x',
      constraints: [
        { rule: "permit read on '/secret'", type: 'permit', action: 'read', resource: '/secret' },
        { rule: "deny read on '/secret'", type: 'deny', action: 'read', resource: '/secret' },
      ],
    };
    const cResult = robustnessScore(consistent, 10);
    const xResult = robustnessScore(contradictory, 10);
    const cConsistency = cResult.factors.find(f => f.name === 'consistency');
    const xConsistency = xResult.factors.find(f => f.name === 'consistency');
    expect(cConsistency!.score).toBeGreaterThan(xConsistency!.score);
  });
});
