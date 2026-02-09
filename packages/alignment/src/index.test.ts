import { describe, it, expect } from 'vitest';
import { sha256Object } from '@stele/crypto';
import {
  defineAlignment,
  assessAlignment,
  alignmentGap,
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
