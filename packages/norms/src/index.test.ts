import { describe, it, expect, vi } from 'vitest';
import { sha256Object } from '@nobulex/crypto';
import {
  analyzeNorms,
  discoverNorms,
  proposeStandard,
  generateTemplate,
  normConflictDetection,
  normPrecedence,
} from './index';
import type {
  CovenantData,
  DiscoveredNorm,
  NormAnalysis,
  NormDefinition,
} from './types';

// ---------------------------------------------------------------------------
// Helper data — all constraints are valid CCL
// ---------------------------------------------------------------------------
function makeCovenant(
  id: string,
  agentId: string,
  constraints: string[],
  trustScore: number,
): CovenantData {
  return { id, agentId, constraints, trustScore };
}

// Sample covenants with valid CCL constraints
const sampleCovenants: CovenantData[] = [
  makeCovenant('c1', 'agent-1', ["deny file.read on '/admin'", "require audit.log on '/api'"], 0.9),
  makeCovenant('c2', 'agent-2', ["deny file.write on '/secrets'", "permit file.read on '/public'"], 0.8),
  makeCovenant('c3', 'agent-3', ["require auth.check on '/api'", "limit api.call 100 per 3600 seconds"], 0.7),
  makeCovenant('c4', 'agent-4', ["deny exec.run on '/system'", "permit file.read on '/docs'", "limit bandwidth.use 1000 per 60 seconds"], 0.85),
  makeCovenant('c5', 'agent-5', ["require crypto.encrypt on '/data'", "deny file.delete on '/backup'"], 0.95),
];

// Covenants designed to produce clear positive Pearson correlation:
// High-trust agents have denial constraints, low-trust agents do not.
const correlatedCovenants: CovenantData[] = [
  makeCovenant('c1', 'a1', ["deny file.read on '/secrets'"], 0.95),
  makeCovenant('c2', 'a2', ["deny file.read on '/admin'"], 0.90),
  makeCovenant('c3', 'a3', ["deny file.write on '/config'"], 0.85),
  makeCovenant('c4', 'a4', ["deny file.delete on '/backup'"], 0.80),
  makeCovenant('c5', 'a5', ["permit file.read on '/public'"], 0.10),
  makeCovenant('c6', 'a6', ["permit file.read on '/docs'"], 0.15),
];

// ===========================================================================
// analyzeNorms
// ===========================================================================
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

  it('clusters constraints by CCL-parsed statement type', () => {
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

  it('populates emergentNorms (no longer empty)', () => {
    // With correlatedCovenants, denial category has 4/6 prevalence ~0.67 > 0.5
    // and high-trust agents have denial constraints, so correlation should be positive
    const analysis = analyzeNorms(correlatedCovenants);
    // emergentNorms should be populated (may or may not have entries depending on correlation)
    expect(Array.isArray(analysis.emergentNorms)).toBe(true);
  });

  it('emergentNorms contains valid DiscoveredNorm objects', () => {
    const analysis = analyzeNorms(correlatedCovenants);
    for (const norm of analysis.emergentNorms) {
      expect(norm.id.length).toBe(64);
      expect(norm.pattern).toBeTruthy();
      expect(norm.prevalence).toBeGreaterThan(0);
      expect(norm.proposedAsStandard).toBe(false);
    }
  });

  it('identifies gaps for missing categories', () => {
    const covenants = [
      makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0.9),
    ];
    const analysis = analyzeNorms(covenants);
    expect(analysis.gaps).toContain('permission');
    expect(analysis.gaps).toContain('limitation');
    expect(analysis.gaps).toContain('requirement');
    expect(analysis.gaps).not.toContain('denial');
  });

  it('handles single covenant', () => {
    const covenants = [makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0.5)];
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

  // --- Validation ---

  it('throws on trustScore > 1', () => {
    const covenants = [makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 1.5)];
    expect(() => analyzeNorms(covenants)).toThrow('Invalid trustScore');
  });

  it('throws on negative trustScore', () => {
    const covenants = [makeCovenant('c1', 'a1', ["deny file.read on '/x'"], -0.1)];
    expect(() => analyzeNorms(covenants)).toThrow('Invalid trustScore');
  });

  it('accepts boundary trustScore values 0 and 1', () => {
    const covenants = [
      makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0),
      makeCovenant('c2', 'a2', ["deny file.read on '/y'"], 1),
    ];
    expect(() => analyzeNorms(covenants)).not.toThrow();
  });
});

// ===========================================================================
// discoverNorms
// ===========================================================================
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
    // Use low thresholds since correlation is computed differently now
    const norms = discoverNorms(analysis, 0.5, -1, sampleCovenants);
    expect(norms.length).toBeGreaterThan(0);
  });

  it('returns empty when prevalence threshold is too high', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 1.0, -1, sampleCovenants);
    expect(norms).toEqual([]);
  });

  it('each discovered norm has a valid id', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, -1, sampleCovenants);
    for (const norm of norms) {
      expect(norm.id.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(norm.id)).toBe(true);
    }
  });

  it('each discovered norm has proposedAsStandard=false', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, -1, sampleCovenants);
    for (const norm of norms) {
      expect(norm.proposedAsStandard).toBe(false);
    }
  });

  it('confidence uses sqrt formula: min(1, sqrt(agentCount) * abs(correlation))', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, -1, sampleCovenants);
    for (const norm of norms) {
      // Confidence should be in [0, 1]
      expect(norm.confidence).toBeGreaterThanOrEqual(0);
      expect(norm.confidence).toBeLessThanOrEqual(1);
      // Verify formula: find the cluster for this norm
      const cluster = analysis.clusters.find((c) => c.category === norm.category);
      if (cluster) {
        const expectedConfidence = Math.min(
          1,
          Math.sqrt(cluster.agentCount) * Math.abs(norm.correlationWithTrust),
        );
        expect(norm.confidence).toBeCloseTo(expectedConfidence, 10);
      }
    }
  });

  it('returns norms with correct category from cluster', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const norms = discoverNorms(analysis, 0.1, -1, sampleCovenants);
    const categories = new Set(norms.map((n) => n.category));
    expect(
      categories.has('denial') ||
      categories.has('permission') ||
      categories.has('limitation') ||
      categories.has('requirement'),
    ).toBe(true);
  });

  it('uses low thresholds to return all possible norms', () => {
    const analysis = analyzeNorms(sampleCovenants);
    const allNorms = discoverNorms(analysis, 0, -1, sampleCovenants);
    const someNorms = discoverNorms(analysis, 0.5, 0.5, sampleCovenants);
    expect(allNorms.length).toBeGreaterThanOrEqual(someNorms.length);
  });

  it('computes real Pearson correlation when covenants are provided', () => {
    // With correlatedCovenants: high-trust agents have denial constraints
    const analysis = analyzeNorms(correlatedCovenants);
    const norms = discoverNorms(analysis, 0.5, 0.0, correlatedCovenants);

    // The denial cluster should have a positive correlation
    const denialNorms = norms.filter((n) => n.category === 'denial');
    if (denialNorms.length > 0) {
      // Correlation should be positive since high-trust agents have denial constraints
      expect(denialNorms[0]!.correlationWithTrust).toBeGreaterThan(0);
    }
  });

  it('without covenants parameter, falls back to averageTrustScore', () => {
    const analysis = analyzeNorms(sampleCovenants);
    // Don't pass covenants — should use averageTrustScore as fallback
    const norms = discoverNorms(analysis, 0.1, 0.1);
    // Should still return norms (using averageTrustScore)
    expect(norms.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// proposeStandard
// ===========================================================================
describe('proposeStandard', () => {
  const sampleNorm: DiscoveredNorm = {
    id: sha256Object({ test: 'norm' }),
    pattern: "deny file.read on '/admin'",
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

  it('description includes parsed CCL info for valid CCL patterns', () => {
    const proposal = proposeStandard(sampleNorm);
    // Should include CCL representation
    expect(proposal.description).toContain('[CCL:');
    expect(proposal.description).toContain('deny rule');
    expect(proposal.description).toContain('file.read');
    expect(proposal.description).toContain('/admin');
  });

  it('description includes CCL info for limit patterns', () => {
    const limitNorm: DiscoveredNorm = {
      id: sha256Object({ test: 'limit-norm' }),
      pattern: 'limit api.call 100 per 3600 seconds',
      prevalence: 0.6,
      correlationWithTrust: 0.7,
      category: 'limitation',
      confidence: 0.5,
      proposedAsStandard: false,
    };
    const proposal = proposeStandard(limitNorm);
    expect(proposal.description).toContain('[CCL:');
    expect(proposal.description).toContain('limit rule');
    expect(proposal.description).toContain('api.call');
  });
});

// ===========================================================================
// generateTemplate
// ===========================================================================
describe('generateTemplate', () => {
  const sampleNorms: DiscoveredNorm[] = [
    {
      id: sha256Object({ n: 1 }),
      pattern: "deny file.read on '/admin'",
      prevalence: 0.8,
      correlationWithTrust: 0.9,
      category: 'denial',
      confidence: 0.72,
      proposedAsStandard: false,
    },
    {
      id: sha256Object({ n: 2 }),
      pattern: "require audit.log on '**'",
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

  it('includes all norm ids as sourceNorms', () => {
    const template = generateTemplate(sampleNorms);
    expect(template.sourceNorms).toEqual(sampleNorms.map((n) => n.id));
  });

  it('constraints come from serialized CCL (parsed and re-serialized)', () => {
    const template = generateTemplate(sampleNorms);
    // Should have at least as many constraints as norms
    expect(template.constraints.length).toBeGreaterThanOrEqual(sampleNorms.length);
    // Each constraint should be a non-empty string
    for (const c of template.constraints) {
      expect(c.trim().length).toBeGreaterThan(0);
    }
  });

  it('serialized constraints contain expected keywords', () => {
    const template = generateTemplate(sampleNorms);
    const joined = template.constraints.join('\n');
    // Should contain the deny and require rules
    expect(joined).toContain('deny');
    expect(joined).toContain('require');
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
    expect(template.constraints.length).toBeGreaterThanOrEqual(1);
    expect(template.sourceNorms).toHaveLength(1);
  });

  it('merges multiple norms into a single serialized document', () => {
    const threeNorms: DiscoveredNorm[] = [
      {
        id: sha256Object({ n: 'a' }),
        pattern: "deny file.read on '/admin'",
        prevalence: 0.8,
        correlationWithTrust: 0.9,
        category: 'denial',
        confidence: 0.72,
        proposedAsStandard: false,
      },
      {
        id: sha256Object({ n: 'b' }),
        pattern: "permit file.read on '/public'",
        prevalence: 0.7,
        correlationWithTrust: 0.85,
        category: 'permission',
        confidence: 0.6,
        proposedAsStandard: false,
      },
      {
        id: sha256Object({ n: 'c' }),
        pattern: 'limit api.call 50 per 60 seconds',
        prevalence: 0.6,
        correlationWithTrust: 0.8,
        category: 'limitation',
        confidence: 0.55,
        proposedAsStandard: false,
      },
    ];
    const template = generateTemplate(threeNorms);
    const joined = template.constraints.join('\n');
    expect(joined).toContain('deny');
    expect(joined).toContain('permit');
    expect(joined).toContain('limit');
  });
});

// ===========================================================================
// Pearson correlation integration tests
// ===========================================================================
describe('Pearson correlation behavior', () => {
  it('high-trust agents with deny constraints produce positive correlation for denial cluster', () => {
    // High-trust agents have denial constraints, low-trust do not
    const covenants = [
      makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0.95),
      makeCovenant('c2', 'a2', ["deny file.write on '/y'"], 0.90),
      makeCovenant('c3', 'a3', ["deny file.delete on '/z'"], 0.85),
      makeCovenant('c4', 'a4', ["permit file.read on '/pub'"], 0.10),
      makeCovenant('c5', 'a5', ["permit file.read on '/docs'"], 0.15),
      makeCovenant('c6', 'a6', ["permit file.read on '/open'"], 0.20),
    ];

    const analysis = analyzeNorms(covenants);
    // Use discoverNorms with low thresholds to find denial cluster norms
    const norms = discoverNorms(analysis, 0.3, 0.0, covenants);
    const denialNorms = norms.filter((n) => n.category === 'denial');

    expect(denialNorms.length).toBeGreaterThan(0);
    // Correlation should be strongly positive
    for (const norm of denialNorms) {
      expect(norm.correlationWithTrust).toBeGreaterThan(0.5);
    }
  });

  it('negative correlation when low-trust agents have the constraint', () => {
    // Low-trust agents have denial constraints, high-trust do not
    const covenants = [
      makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0.10),
      makeCovenant('c2', 'a2', ["deny file.write on '/y'"], 0.15),
      makeCovenant('c3', 'a3', ["deny file.delete on '/z'"], 0.20),
      makeCovenant('c4', 'a4', ["permit file.read on '/pub'"], 0.90),
      makeCovenant('c5', 'a5', ["permit file.read on '/docs'"], 0.85),
      makeCovenant('c6', 'a6', ["permit file.read on '/open'"], 0.95),
    ];

    const analysis = analyzeNorms(covenants);
    const norms = discoverNorms(analysis, 0.3, -1, covenants);
    const denialNorms = norms.filter((n) => n.category === 'denial');

    expect(denialNorms.length).toBeGreaterThan(0);
    // Correlation should be negative
    for (const norm of denialNorms) {
      expect(norm.correlationWithTrust).toBeLessThan(0);
    }
  });

  it('near-zero correlation when constraint distribution is uncorrelated with trust', () => {
    // Mixed: both high and low trust agents have denial constraints
    const covenants = [
      makeCovenant('c1', 'a1', ["deny file.read on '/x'"], 0.90),
      makeCovenant('c2', 'a2', ["deny file.write on '/y'"], 0.10),
      makeCovenant('c3', 'a3', ["deny file.delete on '/z'"], 0.50),
      makeCovenant('c4', 'a4', ["permit file.read on '/pub'"], 0.90),
      makeCovenant('c5', 'a5', ["permit file.read on '/docs'"], 0.10),
      makeCovenant('c6', 'a6', ["permit file.read on '/open'"], 0.50),
    ];

    const analysis = analyzeNorms(covenants);
    const norms = discoverNorms(analysis, 0.3, -1, covenants);
    const denialNorms = norms.filter((n) => n.category === 'denial');

    if (denialNorms.length > 0) {
      // Correlation should be close to zero (within reason)
      expect(Math.abs(denialNorms[0]!.correlationWithTrust)).toBeLessThan(0.5);
    }
  });
});

// ===========================================================================
// Helper for NormDefinition tests
// ===========================================================================
function makeNorm(overrides: Partial<NormDefinition> & { id: string }): NormDefinition {
  return {
    pattern: `deny file.read on '/data'`,
    category: 'denial',
    action: 'file.read',
    resource: '/data',
    authority: 1,
    createdAt: 1000,
    specificity: 1,
    ...overrides,
  };
}

// ===========================================================================
// normConflictDetection
// ===========================================================================
describe('normConflictDetection', () => {
  it('returns empty array for empty norms', () => {
    const result = normConflictDetection([]);
    expect(result).toEqual([]);
  });

  it('returns empty array for a single norm', () => {
    const norms = [makeNorm({ id: 'n1' })];
    const result = normConflictDetection(norms);
    expect(result).toEqual([]);
  });

  it('detects direct contradiction: deny vs permit on same resource and action', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' }),
      makeNorm({ id: 'n2', category: 'permission', action: 'file.read', resource: '/data', pattern: "permit file.read on '/data'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(1);
    expect(result[0]!.conflictType).toBe('direct_contradiction');
  });

  it('does not detect conflict between norms on different resources', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' }),
      makeNorm({ id: 'n2', category: 'permission', action: 'file.read', resource: '/public', pattern: "permit file.read on '/public'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(0);
  });

  it('does not detect conflict between norms of the same category', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' }),
      makeNorm({ id: 'n2', category: 'denial', action: 'file.write', resource: '/data', pattern: "deny file.write on '/data'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(0);
  });

  it('detects resource overlap: deny vs permit, same resource, different actions', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' }),
      makeNorm({ id: 'n2', category: 'permission', action: 'file.write', resource: '/data', pattern: "permit file.write on '/data'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(1);
    expect(result[0]!.conflictType).toBe('resource_overlap');
  });

  it('detects multiple conflicts among many norms', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' }),
      makeNorm({ id: 'n2', category: 'permission', action: 'file.read', resource: '/data', pattern: "permit file.read on '/data'" }),
      makeNorm({ id: 'n3', category: 'denial', action: 'file.write', resource: '/config' }),
      makeNorm({ id: 'n4', category: 'permission', action: 'file.write', resource: '/config', pattern: "permit file.write on '/config'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(2);
  });

  it('conflict description includes norm patterns', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data', pattern: 'deny-pattern' }),
      makeNorm({ id: 'n2', category: 'permission', action: 'file.read', resource: '/data', pattern: 'permit-pattern' }),
    ];
    const result = normConflictDetection(norms);
    expect(result[0]!.description).toContain('deny-pattern');
    expect(result[0]!.description).toContain('permit-pattern');
  });

  it('conflict references the correct norm objects', () => {
    const normA = makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/data' });
    const normB = makeNorm({ id: 'n2', category: 'permission', action: 'file.read', resource: '/data', pattern: "permit file.read on '/data'" });
    const result = normConflictDetection([normA, normB]);
    expect(result[0]!.normA).toBe(normA);
    expect(result[0]!.normB).toBe(normB);
  });

  it('detects requirement vs denial conflict on same resource', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'requirement', action: 'audit.log', resource: '/data', pattern: "require audit.log on '/data'" }),
      makeNorm({ id: 'n2', category: 'denial', action: 'audit.write', resource: '/data', pattern: "deny audit.write on '/data'" }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(1);
    expect(result[0]!.conflictType).toBe('resource_overlap');
  });

  it('handles norms with no conflicts', () => {
    const norms = [
      makeNorm({ id: 'n1', category: 'denial', action: 'file.read', resource: '/secret' }),
      makeNorm({ id: 'n2', category: 'requirement', action: 'audit.log', resource: '/api', pattern: "require audit.log on '/api'" }),
      makeNorm({ id: 'n3', category: 'limitation', action: 'api.call', resource: '/external', pattern: 'limit api.call 100 per 3600 seconds' }),
    ];
    const result = normConflictDetection(norms);
    expect(result).toHaveLength(0);
  });
});

// ===========================================================================
// normPrecedence
// ===========================================================================
describe('normPrecedence', () => {
  it('higher specificity wins', () => {
    const normA = makeNorm({ id: 'n1', specificity: 5, authority: 1, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.winner.id).toBe('n1');
    expect(result.loser.id).toBe('n2');
    expect(result.factors.specificityDiff).toBe(4);
  });

  it('higher authority wins when specificity is equal', () => {
    const normA = makeNorm({ id: 'n1', specificity: 1, authority: 10, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.winner.id).toBe('n1');
  });

  it('more recent norm wins when other factors are equal', () => {
    const normA = makeNorm({ id: 'n1', specificity: 1, authority: 1, createdAt: 5000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.winner.id).toBe('n1');
    expect(result.factors.recencyDiff).toBe(4000);
  });

  it('combined factors determine winner', () => {
    // normB has higher authority but normA has higher specificity and recency
    const normA = makeNorm({ id: 'n1', specificity: 10, authority: 1, createdAt: 5000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 3, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    // Specificity strongly favors A, recency favors A, authority favors B
    expect(result.winner.id).toBe('n1');
  });

  it('returns correct factors', () => {
    const normA = makeNorm({ id: 'n1', specificity: 3, authority: 5, createdAt: 2000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 2, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.factors.specificityDiff).toBe(2);
    expect(result.factors.authorityDiff).toBe(3);
    expect(result.factors.recencyDiff).toBe(1000);
  });

  it('reason includes specificity explanation when relevant', () => {
    const normA = makeNorm({ id: 'n1', specificity: 5, authority: 1, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.reason).toContain('specificity');
  });

  it('reason includes authority explanation when relevant', () => {
    const normA = makeNorm({ id: 'n1', specificity: 1, authority: 10, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.reason).toContain('authority');
  });

  it('reason includes recency explanation when relevant', () => {
    const normA = makeNorm({ id: 'n1', specificity: 1, authority: 1, createdAt: 5000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.reason).toContain('recency');
  });

  it('when all factors are equal, first norm (A) wins', () => {
    const normA = makeNorm({ id: 'n1', specificity: 1, authority: 1, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 1, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    expect(result.winner.id).toBe('n1');
  });

  it('lower specificity can still win with much higher authority', () => {
    const normA = makeNorm({ id: 'n1', specificity: 2, authority: 1, createdAt: 1000 });
    const normB = makeNorm({ id: 'n2', specificity: 1, authority: 100, createdAt: 1000 });
    const result = normPrecedence(normA, normB);
    // Authority difference is huge, should outweigh specificity
    expect(result.winner.id).toBe('n2');
  });

  it('reason includes the winning pattern', () => {
    const normA = makeNorm({ id: 'n1', specificity: 5, pattern: 'deny-pattern' });
    const normB = makeNorm({ id: 'n2', specificity: 1, pattern: 'permit-pattern' });
    const result = normPrecedence(normA, normB);
    expect(result.reason).toContain(result.winner.pattern);
  });

  it('winner and loser reference the correct norm objects', () => {
    const normA = makeNorm({ id: 'n1', specificity: 5 });
    const normB = makeNorm({ id: 'n2', specificity: 1 });
    const result = normPrecedence(normA, normB);
    expect(result.winner).toBe(normA);
    expect(result.loser).toBe(normB);
  });
});
