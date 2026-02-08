import { sha256Object, generateId } from '@stele/crypto';

export type {
  DiscoveredNorm,
  NormAnalysis,
  NormCluster,
  GovernanceProposal,
  CovenantData,
  CovenantTemplate,
} from './types';

import type {
  DiscoveredNorm,
  NormAnalysis,
  NormCluster,
  GovernanceProposal,
  CovenantData,
  CovenantTemplate,
} from './types';

/**
 * Categorize a constraint based on keywords.
 */
function categorizeConstraint(constraint: string): string {
  const lower = constraint.toLowerCase();
  if (lower.includes('deny')) return 'denial';
  if (lower.includes('permit')) return 'permission';
  if (lower.includes('limit')) return 'limitation';
  if (lower.includes('require')) return 'requirement';
  return 'general';
}

/**
 * Analyze all covenants to produce a NormAnalysis.
 * Count unique constraints. Cluster by category (derived from constraint keywords).
 * Compute average trust score per cluster. Returns NormAnalysis with empty emergentNorms.
 */
export function analyzeNorms(covenants: CovenantData[]): NormAnalysis {
  if (covenants.length === 0) {
    return {
      totalCovenants: 0,
      uniqueConstraints: 0,
      clusters: [],
      emergentNorms: [],
      gaps: [],
    };
  }

  // Collect all unique constraints
  const allConstraints = new Set<string>();
  for (const cov of covenants) {
    for (const c of cov.constraints) {
      allConstraints.add(c);
    }
  }

  // Build clusters by category
  const clusterMap = new Map<string, {
    constraints: Set<string>;
    agentIds: Set<string>;
    trustScores: number[];
  }>();

  for (const cov of covenants) {
    for (const constraint of cov.constraints) {
      const category = categorizeConstraint(constraint);

      let cluster = clusterMap.get(category);
      if (!cluster) {
        cluster = {
          constraints: new Set<string>(),
          agentIds: new Set<string>(),
          trustScores: [],
        };
        clusterMap.set(category, cluster);
      }

      cluster.constraints.add(constraint);
      if (!cluster.agentIds.has(cov.agentId)) {
        cluster.agentIds.add(cov.agentId);
        cluster.trustScores.push(cov.trustScore);
      }
    }
  }

  const clusters: NormCluster[] = [];
  for (const [category, data] of clusterMap.entries()) {
    const averageTrustScore =
      data.trustScores.length > 0
        ? data.trustScores.reduce((sum, s) => sum + s, 0) / data.trustScores.length
        : 0;

    clusters.push({
      category,
      constraints: [...data.constraints],
      agentCount: data.agentIds.size,
      averageTrustScore,
    });
  }

  // Identify gaps: categories that are expected but not found
  const expectedCategories = ['denial', 'permission', 'limitation', 'requirement'];
  const foundCategories = new Set(clusters.map((c) => c.category));
  const gaps = expectedCategories.filter((cat) => !foundCategories.has(cat));

  return {
    totalCovenants: covenants.length,
    uniqueConstraints: allConstraints.size,
    clusters,
    emergentNorms: [],
    gaps,
  };
}

/**
 * From clusters, find constraints that appear in >= minPrevalence fraction of covenants
 * AND have average trust correlation >= minCorrelation. Returns DiscoveredNorm[].
 */
export function discoverNorms(
  analysis: NormAnalysis,
  minPrevalence: number,
  minCorrelation: number,
): DiscoveredNorm[] {
  const norms: DiscoveredNorm[] = [];

  if (analysis.totalCovenants === 0) {
    return norms;
  }

  for (const cluster of analysis.clusters) {
    // Prevalence = fraction of covenants that have constraints in this cluster
    const prevalence = cluster.agentCount / analysis.totalCovenants;
    const correlation = cluster.averageTrustScore;

    if (prevalence >= minPrevalence && correlation >= minCorrelation) {
      for (const constraint of cluster.constraints) {
        const id = sha256Object({ pattern: constraint, category: cluster.category });
        norms.push({
          id,
          pattern: constraint,
          prevalence,
          correlationWithTrust: correlation,
          category: cluster.category,
          confidence: prevalence * correlation,
          proposedAsStandard: false,
        });
      }
    }
  }

  return norms;
}

/**
 * Creates a GovernanceProposal from a discovered norm.
 */
export function proposeStandard(norm: DiscoveredNorm): GovernanceProposal {
  const id = sha256Object({ normId: norm.id, pattern: norm.pattern });
  return {
    id,
    normId: norm.id,
    proposedAt: Date.now(),
    description: `Propose "${norm.pattern}" as standard norm in category "${norm.category}" ` +
      `(prevalence: ${norm.prevalence.toFixed(2)}, trust correlation: ${norm.correlationWithTrust.toFixed(2)})`,
    pattern: norm.pattern,
  };
}

/**
 * Generates a CovenantTemplate from discovered norms.
 * Name = "Standard Covenant (auto-generated)". constraints = all norm patterns.
 */
export function generateTemplate(norms: DiscoveredNorm[]): CovenantTemplate {
  const constraints = norms.map((n) => n.pattern);
  const sourceNorms = norms.map((n) => n.id);

  return {
    name: 'Standard Covenant (auto-generated)',
    description: `Auto-generated covenant template from ${norms.length} discovered norms ` +
      `covering categories: ${[...new Set(norms.map((n) => n.category))].join(', ')}`,
    constraints,
    sourceNorms,
  };
}
