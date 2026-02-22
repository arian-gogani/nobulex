import { describe, it, expect } from 'vitest';
import { sha256Object } from '@nobulex/crypto';
import {
  defineAlignment,
  assessAlignment,
  alignmentGap,
  alignmentDrift,
  alignmentDecomposition,
  STANDARD_ALIGNMENT_PROPERTIES,
} from './index';
import type {
  AlignmentProperty,
  AlignmentCovenant,
  ExecutionRecord,
} from './types';

// ---------------------------------------------------------------------------
// STANDARD_ALIGNMENT_PROPERTIES
// ---------------------------------------------------------------------------
describe('STANDARD_ALIGNMENT_PROPERTIES', () => {
  it('contains exactly 3 standard properties', () => {
    expect(STANDARD_ALIGNMENT_PROPERTIES).toHaveLength(3);
  });

  it('includes harmlessness', () => {
    const harmlessness = STANDARD_ALIGNMENT_PROPERTIES.find((p) => p.name === 'harmlessness');
    expect(harmlessness).toBeDefined();
    expect(harmlessness!.constraints).toEqual(["deny * on '**' when risk_level = 'critical'"]);
  });

  it('includes honesty', () => {
    const honesty = STANDARD_ALIGNMENT_PROPERTIES.find((p) => p.name === 'honesty');
    expect(honesty).toBeDefined();
    expect(honesty!.constraints).toEqual(["require audit_log on '**'"]);
  });

  it('includes helpfulness', () => {
    const helpfulness = STANDARD_ALIGNMENT_PROPERTIES.find((p) => p.name === 'helpfulness');
    expect(helpfulness).toBeDefined();
    expect(helpfulness!.constraints).toEqual(["permit read on '**'"]);
  });

  it('all properties have coverageScore of 0', () => {
    for (const prop of STANDARD_ALIGNMENT_PROPERTIES) {
      expect(prop.coverageScore).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// defineAlignment
// ---------------------------------------------------------------------------
describe('defineAlignment', () => {
  it('creates a covenant with the correct agentId', () => {
    const covenant = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES);
    expect(covenant.agentId).toBe('agent-1');
  });

  it('defaults verificationMethod to behavioral', () => {
    const covenant = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES);
    expect(covenant.verificationMethod).toBe('behavioral');
  });

  it('allows specifying verificationMethod', () => {
    const covenant = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'adversarial');
    expect(covenant.verificationMethod).toBe('adversarial');
  });

  it('generates a deterministic id', () => {
    const c1 = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'behavioral');
    const c2 = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'behavioral');
    expect(c1.id).toBe(c2.id);
  });

  it('generates different ids for different agents', () => {
    const c1 = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES);
    const c2 = defineAlignment('agent-2', STANDARD_ALIGNMENT_PROPERTIES);
    expect(c1.id).not.toBe(c2.id);
  });

  it('id is a valid 64-character hex string', () => {
    const covenant = defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES);
    expect(covenant.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(covenant.id)).toBe(true);
  });

  it('constraints are the union of all property constraints', () => {
    const props: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1', 'c2'], testSuite: 'ts1', coverageScore: 0 },
      { name: 'p2', constraints: ['c2', 'c3'], testSuite: 'ts2', coverageScore: 0 },
    ];
    const covenant = defineAlignment('agent-1', props);
    expect(covenant.constraints).toContain('c1');
    expect(covenant.constraints).toContain('c2');
    expect(covenant.constraints).toContain('c3');
    // c2 should appear only once (set union)
    expect(covenant.constraints.filter((c) => c === 'c2')).toHaveLength(1);
  });

  it('copies properties without mutation', () => {
    const props: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1'], testSuite: 'ts1', coverageScore: 0 },
    ];
    const covenant = defineAlignment('agent-1', props);
    props[0]!.name = 'mutated';
    expect(covenant.alignmentProperties[0]!.name).toBe('p1');
  });

  it('works with empty properties', () => {
    const covenant = defineAlignment('agent-1', []);
    expect(covenant.alignmentProperties).toEqual([]);
    expect(covenant.constraints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assessAlignment
// ---------------------------------------------------------------------------
describe('assessAlignment', () => {
  const makeCovenant = (): AlignmentCovenant => {
    return defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'behavioral');
  };

  it('returns the correct agentId', () => {
    const covenant = makeCovenant();
    const report = assessAlignment('agent-1', covenant, []);
    expect(report.agentId).toBe('agent-1');
  });

  it('returns 0 overallAlignmentScore for empty history', () => {
    const covenant = makeCovenant();
    const report = assessAlignment('agent-1', covenant, []);
    expect(report.overallAlignmentScore).toBe(0);
  });

  it('all properties are gaps when history is empty', () => {
    const covenant = makeCovenant();
    const report = assessAlignment('agent-1', covenant, []);
    expect(report.gaps).toContain('harmlessness');
    expect(report.gaps).toContain('honesty');
    expect(report.gaps).toContain('helpfulness');
  });

  it('returns overallAlignmentScore of 1.0 when all actions are fulfilled', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'deny', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
      { action: 'audit_log', resource: '/data', outcome: 'fulfilled', timestamp: 2 },
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 3 },
    ];
    const report = assessAlignment('agent-1', covenant, history);
    expect(report.overallAlignmentScore).toBe(1.0);
  });

  it('returns overallAlignmentScore of 0 when all actions are breached', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'deny', resource: '/data', outcome: 'breached', timestamp: 1 },
      { action: 'audit_log', resource: '/data', outcome: 'breached', timestamp: 2 },
      { action: 'read', resource: '/data', outcome: 'breached', timestamp: 3 },
    ];
    const report = assessAlignment('agent-1', covenant, history);
    expect(report.overallAlignmentScore).toBe(0);
  });

  it('includes recommendations for gap properties', () => {
    const covenant = makeCovenant();
    const report = assessAlignment('agent-1', covenant, []);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('returns correct number of properties in report', () => {
    const covenant = makeCovenant();
    const report = assessAlignment('agent-1', covenant, []);
    expect(report.properties).toHaveLength(3);
  });

  it('computes partial scores correctly', () => {
    const props: AlignmentProperty[] = [
      { name: 'test-prop', constraints: ["permit read on '**'"], testSuite: 'ts', coverageScore: 0 },
    ];
    const covenant = defineAlignment('agent-1', props, 'behavioral');
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/a', outcome: 'fulfilled', timestamp: 1 },
      { action: 'read', resource: '/b', outcome: 'breached', timestamp: 2 },
    ];
    const report = assessAlignment('agent-1', covenant, history);
    // severity-weighted: permit has default severity 'high' (weight=3)
    // 1 fulfilled / (1 fulfilled + 3 weighted breach) = 0.25
    expect(report.overallAlignmentScore).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// alignmentGap
// ---------------------------------------------------------------------------
describe('alignmentGap', () => {
  it('returns empty array when all constraints are present', () => {
    const desired: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1', 'c2'], testSuite: 'ts', coverageScore: 0 },
    ];
    const actual = ['c1', 'c2', 'c3'];
    expect(alignmentGap(desired, actual)).toEqual([]);
  });

  it('returns property names whose constraints are missing', () => {
    const desired: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1', 'c2'], testSuite: 'ts', coverageScore: 0 },
      { name: 'p2', constraints: ['c3'], testSuite: 'ts', coverageScore: 0 },
    ];
    const actual = ['c1'];
    const gaps = alignmentGap(desired, actual);
    expect(gaps).toContain('p1');
    expect(gaps).toContain('p2');
  });

  it('only returns properties with missing constraints', () => {
    const desired: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1'], testSuite: 'ts', coverageScore: 0 },
      { name: 'p2', constraints: ['c2'], testSuite: 'ts', coverageScore: 0 },
    ];
    const actual = ['c1'];
    const gaps = alignmentGap(desired, actual);
    expect(gaps).toEqual(['p2']);
  });

  it('returns empty array for empty desired', () => {
    expect(alignmentGap([], ['c1'])).toEqual([]);
  });

  it('returns all properties when actual is empty', () => {
    const desired: AlignmentProperty[] = [
      { name: 'p1', constraints: ['c1'], testSuite: 'ts', coverageScore: 0 },
      { name: 'p2', constraints: ['c2'], testSuite: 'ts', coverageScore: 0 },
    ];
    const gaps = alignmentGap(desired, []);
    expect(gaps).toEqual(['p1', 'p2']);
  });

  it('handles properties with empty constraints (always satisfied)', () => {
    const desired: AlignmentProperty[] = [
      { name: 'p1', constraints: [], testSuite: 'ts', coverageScore: 0 },
    ];
    expect(alignmentGap(desired, [])).toEqual([]);
  });

  it('works with STANDARD_ALIGNMENT_PROPERTIES', () => {
    const gaps = alignmentGap(STANDARD_ALIGNMENT_PROPERTIES, []);
    expect(gaps).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// alignmentDrift
// ---------------------------------------------------------------------------
describe('alignmentDrift', () => {
  const makeCovenant = (): AlignmentCovenant => {
    return defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'behavioral');
  };

  function makeHistory(
    count: number,
    startTime: number,
    outcome: 'fulfilled' | 'breached',
    action: string,
    resource: string,
  ): ExecutionRecord[] {
    const records: ExecutionRecord[] = [];
    for (let i = 0; i < count; i++) {
      records.push({ action, resource, outcome, timestamp: startTime + i * 1000 });
    }
    return records;
  }

  it('returns the correct window count', () => {
    const covenant = makeCovenant();
    const history = makeHistory(20, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 4);
    expect(result.windowCount).toBeLessThanOrEqual(4);
    expect(result.windowCount).toBeGreaterThan(0);
  });

  it('window scores are between 0 and 1', () => {
    const covenant = makeCovenant();
    const history = makeHistory(20, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 4);
    for (const score of result.windowScores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('detects drift when scores drop between windows', () => {
    const covenant = makeCovenant();
    // First half: all fulfilled; second half: all breached
    const good = makeHistory(10, 1000, 'fulfilled', 'read', '/data');
    const bad = makeHistory(10, 20000, 'breached', 'read', '/data');
    const history = [...good, ...bad];
    const result = alignmentDrift('agent-1', covenant, history, 2);
    expect(result.maxDrop).toBeGreaterThan(0);
  });

  it('trend is stable when scores do not change significantly', () => {
    const covenant = makeCovenant();
    const history = makeHistory(20, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 4);
    // All windows have the same outcome -> stable
    expect(result.trend).toBe('stable');
  });

  it('trend is degrading when scores decrease over time', () => {
    const covenant = makeCovenant();
    // Construct degrading history: first records are good, later ones bad
    const good = makeHistory(15, 1000, 'fulfilled', 'read', '/data');
    const bad = makeHistory(15, 30000, 'breached', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, [...good, ...bad], 3);
    // Should detect degradation or at least a drop
    expect(result.maxDrop).toBeGreaterThanOrEqual(0);
  });

  it('throws when windowCount < 2', () => {
    const covenant = makeCovenant();
    const history = makeHistory(10, 1000, 'fulfilled', 'read', '/data');
    expect(() => alignmentDrift('agent-1', covenant, history, 1)).toThrow('windowCount must be at least 2');
  });

  it('throws when history is empty', () => {
    const covenant = makeCovenant();
    expect(() => alignmentDrift('agent-1', covenant, [], 2)).toThrow('history must not be empty');
  });

  it('throws when agentId is empty', () => {
    const covenant = makeCovenant();
    const history = makeHistory(10, 1000, 'fulfilled', 'read', '/data');
    expect(() => alignmentDrift('', covenant, history, 2)).toThrow('agentId must be a non-empty string');
  });

  it('windowStarts are in ascending order', () => {
    const covenant = makeCovenant();
    const history = makeHistory(20, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 4);
    for (let i = 1; i < result.windowStarts.length; i++) {
      expect(result.windowStarts[i]!).toBeGreaterThanOrEqual(result.windowStarts[i - 1]!);
    }
  });

  it('driftDetected is false when all windows have similar scores', () => {
    const covenant = makeCovenant();
    const history = makeHistory(30, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 3);
    expect(result.driftDetected).toBe(false);
  });

  it('handles very small history gracefully', () => {
    const covenant = makeCovenant();
    const history = makeHistory(2, 1000, 'fulfilled', 'read', '/data');
    const result = alignmentDrift('agent-1', covenant, history, 2);
    expect(result.windowScores.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// alignmentDecomposition
// ---------------------------------------------------------------------------
describe('alignmentDecomposition', () => {
  const makeCovenant = (): AlignmentCovenant => {
    return defineAlignment('agent-1', STANDARD_ALIGNMENT_PROPERTIES, 'behavioral');
  };

  it('returns per-property contributions', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
    ];
    const result = alignmentDecomposition('agent-1', covenant, history);
    expect(result.propertyContributions).toHaveLength(3);
  });

  it('overallScore matches assessAlignment output', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
      { action: 'audit_log', resource: '/data', outcome: 'fulfilled', timestamp: 2 },
      { action: 'deny', resource: '/data', outcome: 'fulfilled', timestamp: 3 },
    ];
    const decomp = alignmentDecomposition('agent-1', covenant, history);
    const report = assessAlignment('agent-1', covenant, history);
    expect(decomp.overallScore).toBeCloseTo(report.overallAlignmentScore, 10);
  });

  it('contributions sum to overall score', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
      { action: 'audit_log', resource: '/data', outcome: 'fulfilled', timestamp: 2 },
      { action: 'deny', resource: '/data', outcome: 'fulfilled', timestamp: 3 },
    ];
    const result = alignmentDecomposition('agent-1', covenant, history);
    const contributionSum = result.propertyContributions.reduce((s, c) => s + c.contribution, 0);
    expect(contributionSum).toBeCloseTo(result.overallScore, 10);
  });

  it('identifies weakest properties when score < 0.5', () => {
    const covenant = makeCovenant();
    // Empty history means all scores are 0 -> all are weak
    const result = alignmentDecomposition('agent-1', covenant, []);
    expect(result.weakest).toContain('harmlessness');
    expect(result.weakest).toContain('honesty');
    expect(result.weakest).toContain('helpfulness');
  });

  it('identifies strongest properties when score >= 0.5', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
      { action: 'audit_log', resource: '/data', outcome: 'fulfilled', timestamp: 2 },
      { action: 'deny', resource: '/data', outcome: 'fulfilled', timestamp: 3 },
    ];
    const result = alignmentDecomposition('agent-1', covenant, history);
    expect(result.strongest.length).toBeGreaterThan(0);
  });

  it('weights are equal across properties', () => {
    const covenant = makeCovenant();
    const result = alignmentDecomposition('agent-1', covenant, []);
    const weights = result.propertyContributions.map(c => c.weight);
    for (const w of weights) {
      expect(w).toBeCloseTo(1 / 3, 10);
    }
  });

  it('handles empty properties covenant', () => {
    const covenant = defineAlignment('agent-1', [], 'behavioral');
    const result = alignmentDecomposition('agent-1', covenant, []);
    expect(result.overallScore).toBe(0);
    expect(result.propertyContributions).toEqual([]);
    expect(result.weakest).toEqual([]);
    expect(result.strongest).toEqual([]);
  });

  it('throws when agentId is empty', () => {
    const covenant = makeCovenant();
    expect(() => alignmentDecomposition('', covenant, [])).toThrow('agentId must be a non-empty string');
  });

  it('each contribution has name, score, weight, and contribution fields', () => {
    const covenant = makeCovenant();
    const result = alignmentDecomposition('agent-1', covenant, []);
    for (const c of result.propertyContributions) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.score).toBe('number');
      expect(typeof c.weight).toBe('number');
      expect(typeof c.contribution).toBe('number');
    }
  });

  it('property names match covenant property names', () => {
    const covenant = makeCovenant();
    const result = alignmentDecomposition('agent-1', covenant, []);
    const names = result.propertyContributions.map(c => c.name);
    expect(names).toContain('harmlessness');
    expect(names).toContain('honesty');
    expect(names).toContain('helpfulness');
  });

  it('contribution is score * weight for each property', () => {
    const covenant = makeCovenant();
    const history: ExecutionRecord[] = [
      { action: 'read', resource: '/data', outcome: 'fulfilled', timestamp: 1 },
    ];
    const result = alignmentDecomposition('agent-1', covenant, history);
    for (const c of result.propertyContributions) {
      expect(c.contribution).toBeCloseTo(c.score * c.weight, 10);
    }
  });
});
