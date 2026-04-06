import { sha256Object } from '@nobulex/crypto';
import { parse, serialize } from '@nobulex/ccl';
import type { CCLDocument, Statement } from '@nobulex/ccl';

export type {
  DiscoveredNorm,
  NormAnalysis,
  NormCluster,
  GovernanceProposal,
  CovenantData,
  CovenantTemplate,
  NormDefinition,
  NormConflict,
  NormPrecedenceResult,
} from './types';

import type {
  DiscoveredNorm,
  NormAnalysis,
  NormCluster,
  GovernanceProposal,
  CovenantData,
  CovenantTemplate,
  NormDefinition,
  NormConflict,
  NormPrecedenceResult,
} from './types';

/**
 * Categorize a constraint by parsing it as CCL and inspecting the statement type.
 * Falls back to 'general' if parsing fails or no statements are found.
 */
function categorizeConstraint(constraint: string): string {
  try {
    const doc = parse(constraint);
    const stmt: Statement | undefined = doc.statements[0];
    if (!stmt) return 'general';
    switch (stmt.type) {
      case 'deny':
        return 'denial';
      case 'permit':
        return 'permission';
      case 'limit':
        return 'limitation';
      case 'require':
        return 'requirement';
      default:
        return 'general';
    }
  } catch {
    // If parsing fails, fall back to general
    return 'general';
  }
}

/**
 * Try to parse a constraint as CCL and return the document, or null on failure.
 */
function tryParseCCL(constraint: string): CCLDocument | null {
  try {
    return parse(constraint);
  } catch {
    return null;
  }
}

/**
 * Compute the Pearson correlation coefficient between two arrays.
 * Returns 0 if the arrays have fewer than 2 elements or if
 * the standard deviation of either array is zero.
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return 0;
  return sumXY / denom;
}

/**
 * Analyze all covenants to produce a NormAnalysis.
 *
 * Parses each constraint as CCL. Categorizes by actual statement type
 * (deny, permit, require, limit) instead of keyword matching.
 * Computes proper statistics per cluster.
 * Populates emergentNorms by running discoverNorms internally with
 * sensible defaults (minPrevalence=0.5, minCorrelation=0.3).
 *
 * @throws {Error} if covenants array is empty (validation: non-empty required)
 *                 — except for the empty-covenants-allowed overload
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

  // Validate trust scores
  for (const cov of covenants) {
    if (cov.trustScore < 0 || cov.trustScore > 1) {
      throw new Error(
        `Invalid trustScore ${cov.trustScore} for agent "${cov.agentId}": must be in [0, 1]`,
      );
    }
  }

  // Collect all unique constraints
  const allConstraints = new Set<string>();
  for (const cov of covenants) {
    for (const c of cov.constraints) {
      allConstraints.add(c);
    }
  }

  // Build clusters by category (using CCL parsing for categorization)
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

  // Build the initial analysis (without emergentNorms)
  const analysis: NormAnalysis = {
    totalCovenants: covenants.length,
    uniqueConstraints: allConstraints.size,
    clusters,
    emergentNorms: [],
    gaps,
  };

  // Populate emergentNorms by calling discoverNorms with sensible defaults
  analysis.emergentNorms = discoverNorms(
    analysis,
    0.5,  // minPrevalence: constraint must appear in >= 50% of covenants
    0.3,  // minCorrelation: must have meaningful trust correlation
    covenants,
  );

  return analysis;
}

/**
 * Compute the Pearson correlation between constraint prevalence and trust score.
 *
 * For each agent, we compute a binary prevalence (1 if the agent has any
 * constraint in the cluster, 0 otherwise) and correlate that with the agent's
 * trust score. A norm is "emergent" if it appears frequently among high-trust
 * agents AND infrequently among low-trust agents, producing a positive correlation.
 *
 * @param cluster - The cluster to compute correlation for
 * @param allCovenants - All covenants for computing per-agent prevalence
 * @returns Pearson correlation in [-1, 1], or 0 if insufficient data
 */
function computeClusterCorrelation(
  cluster: NormCluster,
  allCovenants: CovenantData[],
): number {
  if (allCovenants.length < 2) return 0;

  // Deduplicate by agentId (take the first entry per agent)
  const agentMap = new Map<string, CovenantData>();
  for (const cov of allCovenants) {
    if (!agentMap.has(cov.agentId)) {
      agentMap.set(cov.agentId, cov);
    }
  }

  const clusterConstraintSet = new Set(cluster.constraints);
  const prevalences: number[] = [];
  const trustScores: number[] = [];

  for (const [, cov] of agentMap) {
    const hasConstraint = cov.constraints.some((c) => clusterConstraintSet.has(c))
      ? 1
      : 0;
    prevalences.push(hasConstraint);
    trustScores.push(cov.trustScore);
  }

  return pearsonCorrelation(prevalences, trustScores);
}

/**
 * From clusters, find constraints that appear in >= minPrevalence fraction of
 * covenants AND have positive Pearson correlation between constraint prevalence
 * and trust score >= minCorrelation. Returns DiscoveredNorm[].
 *
 * Confidence formula: min(1, sqrt(agentCount) * abs(correlation))
 * This scales with sample size and actual correlation strength.
 *
 * @param analysis - The NormAnalysis to discover norms from
 * @param minPrevalence - Minimum fraction of covenants that must contain the cluster
 * @param minCorrelation - Minimum Pearson correlation threshold
 * @param covenants - Optional: all covenants for computing proper correlation.
 *                    If not provided, falls back to cluster-level estimation.
 */
export function discoverNorms(
  analysis: NormAnalysis,
  minPrevalence: number,
  minCorrelation: number,
  covenants?: CovenantData[],
): DiscoveredNorm[] {
  const norms: DiscoveredNorm[] = [];

  if (analysis.totalCovenants === 0) {
    return norms;
  }

  for (const cluster of analysis.clusters) {
    // Prevalence = fraction of covenants that have constraints in this cluster
    const prevalence = cluster.agentCount / analysis.totalCovenants;

    // Compute real Pearson correlation if covenants are available
    let correlation: number;
    if (covenants && covenants.length >= 2) {
      correlation = computeClusterCorrelation(cluster, covenants);
    } else {
      // Fallback: estimate correlation from cluster data
      // Use a simple heuristic: averageTrustScore as a rough proxy
      // (this is only used when covenants aren't passed)
      correlation = cluster.averageTrustScore;
    }

    if (prevalence >= minPrevalence && correlation >= minCorrelation) {
      for (const constraint of cluster.constraints) {
        const id = sha256Object({ pattern: constraint, category: cluster.category });

        // Confidence: min(1, sqrt(agentCount) * abs(correlation))
        const confidence = Math.min(
          1,
          Math.sqrt(cluster.agentCount) * Math.abs(correlation),
        );

        norms.push({
          id,
          pattern: constraint,
          prevalence,
          correlationWithTrust: correlation,
          category: cluster.category,
          confidence,
          proposedAsStandard: false,
        });
      }
    }
  }

  return norms;
}

/**
 * Creates a GovernanceProposal from a discovered norm.
 * Includes the constraint's parsed CCL representation in the proposal description.
 */
export function proposeStandard(norm: DiscoveredNorm): GovernanceProposal {
  const id = sha256Object({ normId: norm.id, pattern: norm.pattern });

  // Include parsed CCL representation if possible
  let cclInfo = '';
  const doc = tryParseCCL(norm.pattern);
  if (doc && doc.statements.length > 0) {
    const stmt = doc.statements[0]!;
    cclInfo = ` [CCL: ${stmt.type} rule`;
    if (stmt.type !== 'limit') {
      cclInfo += `, action="${stmt.action}", resource="${stmt.resource}"`;
    } else {
      cclInfo += `, action="${stmt.action}", limit=${stmt.count}/${stmt.periodSeconds}s`;
    }
    cclInfo += ']';
  }

  return {
    id,
    normId: norm.id,
    proposedAt: Date.now(),
    description:
      `Propose "${norm.pattern}" as standard norm in category "${norm.category}" ` +
      `(prevalence: ${norm.prevalence.toFixed(2)}, trust correlation: ${norm.correlationWithTrust.toFixed(2)})` +
      cclInfo,
    pattern: norm.pattern,
  };
}

/**
 * Generates a CovenantTemplate from discovered norms.
 * Parses all norm patterns as CCL and merges them properly.
 * Name = "Standard Covenant (auto-generated)". constraints = serialized CCL.
 */
export function generateTemplate(norms: DiscoveredNorm[]): CovenantTemplate {
  const sourceNorms = norms.map((n) => n.id);

  // Parse each norm as CCL and collect all statements
  const allStatements: import('@nobulex/ccl').Statement[] = [];
  const rawConstraints: string[] = [];

  for (const norm of norms) {
    const doc = tryParseCCL(norm.pattern);
    if (doc && doc.statements.length > 0) {
      for (const stmt of doc.statements) {
        allStatements.push(stmt);
      }
    }
    // Always keep the original pattern in constraints for backward compatibility
    rawConstraints.push(norm.pattern);
  }

  // If we have parsed statements, serialize the merged document as constraints
  let constraints: string[];
  if (allStatements.length > 0) {
    const mergedDoc: CCLDocument = {
      statements: allStatements,
      permits: allStatements.filter((s): s is import('@nobulex/ccl').PermitDenyStatement => s.type === 'permit'),
      denies: allStatements.filter((s): s is import('@nobulex/ccl').PermitDenyStatement => s.type === 'deny'),
      obligations: allStatements.filter((s): s is import('@nobulex/ccl').RequireStatement => s.type === 'require'),
      limits: allStatements.filter((s): s is import('@nobulex/ccl').LimitStatement => s.type === 'limit'),
    };
    // Serialize the merged CCL document back to source text
    const serialized = serialize(mergedDoc);
    // Use the serialized form — each line is a constraint
    constraints = serialized.split('\n').filter((line) => line.trim() !== '');
  } else {
    constraints = rawConstraints;
  }

  return {
    name: 'Standard Covenant (auto-generated)',
    description:
      `Auto-generated covenant template from ${norms.length} discovered norms ` +
      `covering categories: ${[...new Set(norms.map((n) => n.category))].join(', ')}`,
    constraints,
    sourceNorms,
  };
}

/**
 * Detect pairs of norms that conflict with each other.
 *
 * A conflict is detected when:
 * 1. Direct contradiction: one norm denies what another permits on the same resource
 * 2. Resource overlap: two norms target the same resource with different actions
 *    of opposing types (deny vs permit/require)
 * 3. Action conflict: two norms with the same action and resource but different
 *    categories (e.g., one is 'denial' and another is 'permission')
 *
 * @param norms - Array of norm definitions to check for conflicts
 * @returns Array of NormConflict objects describing each detected conflict
 */
export function normConflictDetection(norms: NormDefinition[]): NormConflict[] {
  const conflicts: NormConflict[] = [];

  // Opposing category pairs
  const opposingCategories: Record<string, string[]> = {
    'denial': ['permission'],
    'permission': ['denial'],
    'requirement': ['denial'],
  };

  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      const normA = norms[i]!;
      const normB = norms[j]!;

      // Check for direct contradiction: deny vs permit on same resource + action
      if (
        normA.resource === normB.resource &&
        normA.action === normB.action &&
        (
          (normA.category === 'denial' && normB.category === 'permission') ||
          (normA.category === 'permission' && normB.category === 'denial')
        )
      ) {
        conflicts.push({
          normA,
          normB,
          conflictType: 'direct_contradiction',
          description:
            `Direct contradiction: "${normA.pattern}" (${normA.category}) vs "${normB.pattern}" (${normB.category}) on resource "${normA.resource}" with action "${normA.action}"`,
        });
        continue;
      }

      // Check for resource overlap: same resource, opposing categories
      if (
        normA.resource === normB.resource &&
        normA.action !== normB.action &&
        opposingCategories[normA.category]?.includes(normB.category)
      ) {
        conflicts.push({
          normA,
          normB,
          conflictType: 'resource_overlap',
          description:
            `Resource overlap: "${normA.pattern}" (${normA.category}, action: ${normA.action}) vs "${normB.pattern}" (${normB.category}, action: ${normB.action}) on resource "${normA.resource}"`,
        });
        continue;
      }

      // Check for action conflict: same action, same resource, different opposing categories
      if (
        normA.action === normB.action &&
        normA.resource === normB.resource &&
        normA.category !== normB.category &&
        opposingCategories[normA.category]?.includes(normB.category)
      ) {
        conflicts.push({
          normA,
          normB,
          conflictType: 'action_conflict',
          description:
            `Action conflict: "${normA.pattern}" vs "${normB.pattern}" - same action "${normA.action}" on resource "${normA.resource}" with conflicting categories`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Resolve a conflict between two norms using a weighted combination of:
 * 1. Specificity: more specific norms take precedence (higher specificity wins)
 * 2. Recency: more recent norms take precedence (higher createdAt wins)
 * 3. Authority: norms from higher-authority sources take precedence (higher authority wins)
 *
 * Each factor is weighted:
 *   - specificity: weight 0.4
 *   - recency: weight 0.3
 *   - authority: weight 0.3
 *
 * The norm with the higher weighted score wins.
 *
 * @param normA - First conflicting norm
 * @param normB - Second conflicting norm
 * @returns NormPrecedenceResult identifying the winning norm and reasoning
 */
export function normPrecedence(
  normA: NormDefinition,
  normB: NormDefinition,
): NormPrecedenceResult {
  const SPECIFICITY_WEIGHT = 0.4;
  const RECENCY_WEIGHT = 0.3;
  const AUTHORITY_WEIGHT = 0.3;

  // Normalize factors to [-1, 1] range where positive favors A
  const specificityDiff = normA.specificity - normB.specificity;
  const maxSpec = Math.max(Math.abs(normA.specificity), Math.abs(normB.specificity), 1);
  const normalizedSpecificity = specificityDiff / maxSpec;

  const recencyDiff = normA.createdAt - normB.createdAt;
  const maxRecency = Math.max(Math.abs(normA.createdAt), Math.abs(normB.createdAt), 1);
  const normalizedRecency = recencyDiff / maxRecency;

  const authorityDiff = normA.authority - normB.authority;
  const maxAuth = Math.max(Math.abs(normA.authority), Math.abs(normB.authority), 1);
  const normalizedAuthority = authorityDiff / maxAuth;

  const scoreA =
    normalizedSpecificity * SPECIFICITY_WEIGHT +
    normalizedRecency * RECENCY_WEIGHT +
    normalizedAuthority * AUTHORITY_WEIGHT;

  // Determine winner based on score
  const aWins = scoreA >= 0;

  const winner = aWins ? normA : normB;
  const loser = aWins ? normB : normA;

  // Build explanation
  const reasons: string[] = [];
  if (specificityDiff !== 0) {
    reasons.push(
      `specificity: ${winner.id} (${winner.specificity}) vs ${loser.id} (${loser.specificity})`,
    );
  }
  if (recencyDiff !== 0) {
    reasons.push(
      `recency: ${winner.id} (${winner.createdAt}) vs ${loser.id} (${loser.createdAt})`,
    );
  }
  if (authorityDiff !== 0) {
    reasons.push(
      `authority: ${winner.id} (${winner.authority}) vs ${loser.id} (${loser.authority})`,
    );
  }

  const reason = reasons.length > 0
    ? `"${winner.pattern}" takes precedence based on: ${reasons.join('; ')}`
    : `"${winner.pattern}" takes precedence (norms are equal; first listed wins)`;

  return {
    winner,
    loser,
    reason,
    factors: {
      specificityDiff,
      recencyDiff,
      authorityDiff,
    },
  };
}
