import { describe, it, expect } from 'vitest';
import { sha256Object } from '@stele/crypto';
import {
  analyzeNorms,
  discoverNorms,
  proposeStandard,
  generateTemplate,
} from './index';
import type {
  CovenantData,
  DiscoveredNorm,
  NormAnalysis,
} from './types';

// ---------------------------------------------------------------------------
// Helper data
// ---------------------------------------------------------------------------
function makeCovenant(
  id: string,
  agentId: string,
  constraints: string[],
  trustScore: number,
): CovenantData {
  return { id, agentId, constraints, trustScore };
}

const sampleCovenants: CovenantData[] = [
  makeCovenant('c1', 'agent-1', ["deny access on '/admin'", "require audit_log on '/api'"], 0.9),
  makeCovenant('c2', 'agent-2', ["deny write on '/secrets'", "permit read on '/public'"], 0.8),
  makeCovenant('c3', 'agent-3', ["require auth on '/api'", "limit rate on '/api'"], 0.7),
  makeCovenant('c4', 'agent-4', ["deny exec on '/system'", "permit read on '/docs'", "limit bandwidth on '/stream'"], 0.85),
  makeCovenant('c5', 'agent-5', ["require encryption on '/data'", "deny delete on '/backup'"], 0.95),
];

// ---------------------------------------------------------------------------
// analyzeNorms
// ---------------------------------------------------------------------------
describe('analyzeNorms', () => {
  it('returns empty analysis for empty covenants', () => {
    const analysis = analyzeNorms([]);
    expect(analysis.totalCovenants).toBe(0);
    expect(analysis.uniqueConstraints).toBe(0);
    expect(analysis.clusters).toEqual([]);
    expect(analysis.emergentNorms).toEqual([]);
  });

  it('returns correct totalCovenants count', () => {
    const analysis = analyzeNorms(sampleCovenants);
    expect(analysis.totalCovenants).toBe(5);
  });

  it('returns correct uniqueConstraints count', () => {
    const analysis = analyzeNorms(sampleCovenants);
    // All constraints in sampleCovenants are unique
    expect(analysis.uniqueConstraints).toBe(11);
  });

  it('clusters constraints by category', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const categories = analysis.clusters.map((c) => c.category);
    expect(categories).toContain('denial');
    expect(categories).toContain('permission');
    expect(categories).toContain('requirement');
    expect(categories).toContain('limitation');
  });

  it('computes agentCount per cluster', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const denialCluster = analysis.clusters.find((c) => c.category === 'denial');
    expect(denialCluster).toBeDefined();
    // agents 1, 2, 4, 5 have deny constraints
    expect(denialCluster!.agentCount).toBe(4);
  });

  it('computes averageTrustScore per cluster', () => {
    const analysis = analyzeNorms(sampleCovenants);
    for (const cluster of analysis.clusters) {
      expect(cluster.averageTrustScore).toBeGreaterThan(0);
      expect(cluster.averageTrustScore).toBeLessThanOrEqual(1);
    }
  });

  it('emergentNorms is initially empty', () => {
    const analysis = analyzeNorms(sampleCovenants);
    expect(analysis.emergentNorms).toEqual([]);
  });

  it('identifies gaps for missing categories', () => {
    const covenants = [
      makeCovenant('c1', 'a1', ["deny access on '/x'"], 0.9),
    ];
    const analysis = analyzeNorms(covenants);
    expect(analysis.gaps).toContain('permission');
    expect(analysis.gaps).toContain('limitation');
    expect(analysis.gaps).toContain('requirement');
    expect(analysis.gaps).not.toContain('denial');
  });

  it('handles single covenant', () => {
    const covenants = [makeCovenant('c1', 'a1', ['deny x'], 0.5)];
    const analysis = analyzeNorms(covenants);
    expect(analysis.totalCovenants).toBe(1);
    expect(analysis.uniqueConstraints).toBe(1);
    expect(analysis.clusters).toHaveLength(1);
  });

  it('handles covenants with no constraints', () => {
    const covenants = [makeCovenant('c1', 'a1', [], 0.5)];
    const analysis = analyzeNorms(covenants);
    expect(analysis.totalCovenants).toBe(1);
    expect(analysis.uniqueConstraints).toBe(0);
    expect(analysis.clusters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// discoverNorms
// ---------------------------------------------------------------------------
describe('discoverNorms', () => {
  it('returns empty array for empty analysis', () => {
    const analysis: NormAnalysis = {
      totalCovenants: 0,
      uniqueConstraints: 0,
      clusters: [],
      emergentNorms: [],
      gaps: [],
    };
    const norms = discoverNorms(analysis, 0.5, 0.5);
    expect(norms).toEqual([]);
  });

  it('discovers norms that meet prevalence and correlation thresholds', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.5, 0.5);
    expect(norms.length).toBeGreaterThan(0);
  });

  it('returns empty when thresholds are too high', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 1.0, 1.0);
    expect(norms).toEqual([]);
  });

  it('each discovered norm has a valid id', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, 0.1);
    for (const norm of norms) {
      expect(norm.id.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(norm.id)).toBe(true);
    }
  });

  it('each discovered norm has proposedAsStandard=false', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, 0.1);
    for (const norm of norms) {
      expect(norm.proposedAsStandard).toBe(false);
    }
  });

  it('confidence equals prevalence * correlationWithTrust', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, 0.1);
    for (const norm of norms) {
      expect(norm.confidence).toBeCloseTo(norm.prevalence * norm.correlationWithTrust, 10);
    }
  });

  it('returns norms with correct category from cluster', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, 0.1);
    const categories = new Set(norms.map((n) => n.category));
    // At least some known categories should appear
    expect(
      categories.has('denial') ||
      categories.has('permission') ||
      categories.has('limitation') ||
      categories.has('requirement'),
    ).toBe(true);
  });

  it('uses low thresholds to return all possible norms', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const allNorms = discoverNorms(analysis, 0, 0);
    const someNorms = discoverNorms(analysis, 0.5, 0.5);
    expect(allNorms.length).toBeGreaterThanOrEqual(someNorms.length);
  });
});

// ---------------------------------------------------------------------------
// proposeStandard
// ---------------------------------------------------------------------------
describe('proposeStandard', () => {
  const sampleNorm: DiscoveredNorm = {
    id: sha256Object({ test: 'norm' }),
    pattern: "deny access on '/admin'",
    prevalence: 0.8,
    correlationWithTrust: 0.9,
    category: 'denial',
    confidence: 0.72,
    proposedAsStandard: false,
  };

  it('creates a proposal with a valid id', () => {
    const proposal = proposeStandard(sampleNorm);
    expect(proposal.id.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(proposal.id)).toBe(true);
  });

  it('links the proposal to the norm via normId', () => {
    const proposal = proposeStandard(sampleNorm);
    expect(proposal.normId).toBe(sampleNorm.id);
  });

  it('includes the norm pattern', () => {
    const proposal = proposeStandard(sampleNorm);
    expect(proposal.pattern).toBe(sampleNorm.pattern);
  });

  it('has a proposedAt timestamp', () => {
    const before = Date.now();
    const proposal = proposeStandard(sampleNorm);
    const after = Date.now();
    expect(proposal.proposedAt).toBeGreaterThanOrEqual(before);
    expect(proposal.proposedAt).toBeLessThanOrEqual(after);
  });

  it('description mentions the pattern', () => {
    const proposal = proposeStandard(sampleNorm);
    expect(proposal.description).toContain(sampleNorm.pattern);
  });

  it('description mentions the category', () => {
    const proposal = proposeStandard(sampleNorm);
    expect(proposal.description).toContain(sampleNorm.category);
  });
});

// ---------------------------------------------------------------------------
// generateTemplate
// ---------------------------------------------------------------------------
describe('generateTemplate', () => {
  const sampleNorms: DiscoveredNorm[] = [
    {
      id: sha256Object({ n: 1 }),
      pattern: "deny access on '/admin'",
      prevalence: 0.8,
      correlationWithTrust: 0.9,
      category: 'denial',
      confidence: 0.72,
      proposedAsStandard: false,
    },
    {
      id: sha256Object({ n: 2 }),
      pattern: "require audit_log on '**'",
      prevalence: 0.7,
      correlationWithTrust: 0.85,
      category: 'requirement',
      confidence: 0.595,
      proposedAsStandard: false,
    },
  ];

  it('generates a template with the standard name', () => {
    const template = generateTemplate(sampleNorms);
    expect(template.name).toBe('Standard Covenant (auto-generated)');
  });

  it('includes all norm patterns as constraints', () => {
    const template = generateTemplate(sampleNorms);
    expect(template.constraints).toEqual([
      "deny access on '/admin'",
      "require audit_log on '**'",
    ]);
  });

  it('includes all norm ids as sourceNorms', () => {
    const template = generateTemplate(sampleNorms);
    expect(template.sourceNorms).toEqual(sampleNorms.map((n) => n.id));
  });

  it('has a meaningful description', () => {
    const template = generateTemplate(sampleNorms);
    expect(template.description).toContain('2');
    expect(template.description).toContain('denial');
    expect(template.description).toContain('requirement');
  });

  it('handles empty norms array', () => {
    const template = generateTemplate([]);
    expect(template.name).toBe('Standard Covenant (auto-generated)');
    expect(template.constraints).toEqual([]);
    expect(template.sourceNorms).toEqual([]);
  });

  it('handles single norm', () => {
    const template = generateTemplate([sampleNorms[0]!]);
    expect(template.constraints).toHaveLength(1);
    expect(template.sourceNorms).toHaveLength(1);
  });
});
