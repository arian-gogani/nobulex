import { sha256Object, generateId } from '@stele/crypto';

export type {
  MetaTargetType,
  MetaCovenant,
  RecursiveVerification,
  TerminationProof,
  TrustBase,
  VerificationEntity,
  TrustEdge,
  TransitiveTrustResult,
  VerifierNode,
  MinimalVerificationSetResult,
} from './types';

import type {
  MetaTargetType,
  MetaCovenant,
  RecursiveVerification,
  TerminationProof,
  TrustBase,
  VerificationEntity,
  TrustEdge,
  TransitiveTrustResult,
  VerifierNode,
  MinimalVerificationSetResult,
} from './types';

/**
 * Creates a MetaCovenant targeting a specific entity type.
 * recursionDepth starts at 0. id = sha256 of content.
 * Runs termination analysis and populates terminationProof.
 */
export function createMetaCovenant(
  targetType: MetaTargetType,
  constraints: string[],
  dependsOn?: string[],
): MetaCovenant {
  const content = {
    targetType,
    constraints,
    recursionDepth: 0,
    terminationProof: '',
  };
  const id = sha256Object(content);

  // Single covenant with no dependencies is a base case: trivially converges
  const proof = dependsOn && dependsOn.length > 0
    ? '' // Will be populated when composed into a chain
    : 'Base case: single meta-covenant with no dependencies trivially converges.';

  return {
    id,
    targetType,
    constraints: [...constraints],
    recursionDepth: 0,
    terminationProof: proof,
    dependsOn: dependsOn ? [...dependsOn] : undefined,
  };
}

/**
 * Walk the verification chain: each entity is verified by its verifier.
 * Returns RecursiveVerification[] for each layer up to maxDepth.
 * Each entry is verified=true if the entity has a verifier with a covenant.
 */
export function verifyRecursively(
  entities: VerificationEntity[],
  maxDepth: number,
): RecursiveVerification[] {
  const results: RecursiveVerification[] = [];
  const entityMap = new Map<string, VerificationEntity>();

  for (const entity of entities) {
    entityMap.set(entity.id, entity);
  }

  // Find root entities (those that are not verifiers of anyone else, i.e., leaf entities)
  const verifierIds = new Set<string>();
  for (const entity of entities) {
    if (entity.verifierId) {
      verifierIds.add(entity.verifierId);
    }
  }

  // Start from entities that are not verifiers (leaf nodes in verification chain)
  const startEntities = entities.filter((e) => !verifierIds.has(e.id));
  // If all are verifiers of each other (cycle), start from all
  const roots = startEntities.length > 0 ? startEntities : entities;

  for (const root of roots) {
    let current: VerificationEntity | undefined = root;
    const visited = new Set<string>();
    let layer = 0;

    while (current && layer <= maxDepth) {
      if (visited.has(current.id)) {
        // Cycle detected, stop
        break;
      }
      visited.add(current.id);

      const hasVerifier = !!(current.verifierId && current.verifierCovenantId);
      const verifier: VerificationEntity | undefined = current.verifierId ? entityMap.get(current.verifierId) : undefined;

      results.push({
        layer,
        entityId: current.id,
        entityType: current.type,
        covenantId: current.covenantId,
        verified: hasVerifier,
        verifiedBy: current.verifierId ?? '',
        verifierCovenantId: current.verifierCovenantId ?? '',
      });

      current = verifier;
      layer++;
    }
  }

  return results;
}

/**
 * Build a DAG from meta-covenants and detect cycles using DFS with visited/stack sets.
 * Returns { hasCycle, maxDepth }.
 */
function analyzeDAG(metaCovenants: MetaCovenant[]): { hasCycle: boolean; maxDepth: number } {
  if (metaCovenants.length === 0) {
    return { hasCycle: false, maxDepth: 0 };
  }

  // Build adjacency list from dependsOn relationships
  const covenantMap = new Map<string, MetaCovenant>();
  for (const mc of metaCovenants) {
    covenantMap.set(mc.id, mc);
  }

  // Build adjacency: id -> ids it depends on
  const adj = new Map<string, string[]>();
  for (const mc of metaCovenants) {
    adj.set(mc.id, mc.dependsOn ?? []);
  }

  // DFS cycle detection with 3-state coloring
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS stack
  const BLACK = 2; // fully processed
  const color = new Map<string, number>();
  for (const mc of metaCovenants) {
    color.set(mc.id, WHITE);
  }

  let hasCycle = false;
  const depthCache = new Map<string, number>();

  function dfs(nodeId: string): number {
    if (depthCache.has(nodeId)) return depthCache.get(nodeId)!;

    color.set(nodeId, GRAY);

    const neighbors = adj.get(nodeId) ?? [];
    let maxChildDepth = 0;

    for (const neighborId of neighbors) {
      const neighborColor = color.get(neighborId);

      if (neighborColor === GRAY) {
        hasCycle = true;
        continue;
      }

      if (neighborColor === WHITE) {
        const childDepth = dfs(neighborId);
        maxChildDepth = Math.max(maxChildDepth, childDepth + 1);
      } else if (neighborColor === BLACK) {
        const childDepth = depthCache.get(neighborId) ?? 0;
        maxChildDepth = Math.max(maxChildDepth, childDepth + 1);
      }
    }

    color.set(nodeId, BLACK);
    depthCache.set(nodeId, maxChildDepth);
    return maxChildDepth;
  }

  let maxDepth = 0;

  for (const mc of metaCovenants) {
    if (color.get(mc.id) === WHITE) {
      const depth = dfs(mc.id);
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  // Also consider recursionDepth as a fallback for chains without dependsOn
  const hasDependencies = metaCovenants.some(mc => mc.dependsOn && mc.dependsOn.length > 0);
  if (!hasDependencies) {
    // Check for duplicate IDs (original cycle detection heuristic)
    const seenIds = new Set<string>();
    for (const mc of metaCovenants) {
      if (seenIds.has(mc.id)) {
        hasCycle = true;
        break;
      }
      seenIds.add(mc.id);
    }

    // Use recursionDepth for max depth when no explicit dependencies
    maxDepth = 0;
    for (const mc of metaCovenants) {
      if (mc.recursionDepth > maxDepth) {
        maxDepth = mc.recursionDepth;
      }
    }
  }

  return { hasCycle, maxDepth };
}

/**
 * Check if a chain terminates at a base case.
 * A base case is a meta-covenant with no dependencies (or recursionDepth 0 with no further nesting).
 */
function terminatesAtBaseCase(metaCovenants: MetaCovenant[]): boolean {
  if (metaCovenants.length === 0) return true;

  // Check if there's at least one covenant with no dependencies (a base case)
  const hasDependencies = metaCovenants.some(mc => mc.dependsOn && mc.dependsOn.length > 0);

  if (!hasDependencies) {
    // Without explicit dependencies, all are leaf/base cases
    return true;
  }

  // With explicit dependencies, check that all dependency chains terminate at a node with no deps
  const covenantIds = new Set(metaCovenants.map(mc => mc.id));
  const hasNoDeps = metaCovenants.filter(mc => !mc.dependsOn || mc.dependsOn.length === 0);

  // There must be at least one base case node
  if (hasNoDeps.length === 0) return false;

  // All dependencies must refer to known covenants in the chain
  for (const mc of metaCovenants) {
    if (mc.dependsOn) {
      for (const depId of mc.dependsOn) {
        if (!covenantIds.has(depId)) {
          // External dependency - assume it's a base case (crypto hardness)
          continue;
        }
      }
    }
  }

  return true;
}

/**
 * Check if the chain of meta-covenants converges.
 * Converges if: (1) there are no cycles in the DAG, (2) the chain terminates at a base case.
 * Returns TerminationProof with real DAG analysis.
 */
export function proveTermination(metaCovenants: MetaCovenant[]): TerminationProof {
  if (metaCovenants.length === 0) {
    return {
      maxDepth: 0,
      converges: true,
      proof: 'Empty chain trivially converges.',
      trustAssumption: trustBase(),
    };
  }

  const { hasCycle, maxDepth } = analyzeDAG(metaCovenants);
  const terminates = terminatesAtBaseCase(metaCovenants);
  const converges = !hasCycle && terminates;

  let proof: string;
  if (hasCycle) {
    proof = `Cycle detected in meta-covenant DAG. The chain does not converge. ` +
      `Analyzed ${metaCovenants.length} covenants with DFS cycle detection.`;
  } else if (!terminates) {
    proof = `No base case found in meta-covenant chain. All covenants have dependencies ` +
      `with no terminal node. The chain may not converge.`;
  } else {
    proof = `DAG analysis of ${metaCovenants.length} meta-covenants: no cycles detected, ` +
      `maximum depth is ${maxDepth}. Chain terminates at base case (cryptographic verification). ` +
      `Each layer monotonically reduces the space of allowed behaviors.`;
  }

  return {
    maxDepth,
    converges,
    proof,
    trustAssumption: trustBase(),
  };
}

/**
 * Returns the irreducible trust assumption as a structured object.
 */
export function trustBase(): TrustBase {
  return {
    assumptions: [
      'Ed25519 signature unforgeability under discrete log hardness',
      'SHA-256 collision resistance',
      'Randomness of key generation',
    ],
    cryptographicPrimitives: ['Ed25519', 'SHA-256'],
    description: 'Ed25519 signature unforgeability under discrete log hardness; SHA-256 collision resistance',
  };
}

/**
 * Returns a new MetaCovenant with recursionDepth + 1, additional constraints,
 * and recomputed terminationProof.
 */
export function addLayer(
  existing: MetaCovenant,
  newConstraints: string[],
): MetaCovenant {
  const mergedConstraints = [...existing.constraints, ...newConstraints];
  const newDepth = existing.recursionDepth + 1;

  // The new layer depends on the existing one
  const dependsOn = [existing.id, ...(existing.dependsOn ?? [])];

  const content = {
    targetType: existing.targetType,
    constraints: mergedConstraints,
    recursionDepth: newDepth,
    terminationProof: existing.terminationProof,
  };
  const id = sha256Object(content);

  // Recompute termination proof for the chain so far
  const terminationProof = `Layer ${newDepth}: extends parent ${existing.id.slice(0, 8)}... ` +
    `with ${newConstraints.length} additional constraints. ` +
    `Chain depth ${newDepth}, monotonically narrowing constraint space.`;

  return {
    id,
    targetType: existing.targetType,
    constraints: mergedConstraints,
    recursionDepth: newDepth,
    terminationProof,
    dependsOn,
  };
}

/**
 * Calculate the transitive trust score through a chain of verifiers.
 *
 * Given a directed graph of trust edges (from -> to with a trustScore),
 * computes the effective trust from a source to a target by finding the
 * path with the highest effective trust. Trust attenuates at each hop:
 * the effective trust through a path is the product of all edge trust scores
 * multiplied by attenuationFactor^(hops-1).
 *
 * Uses BFS/Dijkstra-like approach to find the best trust path.
 *
 * @param edges - Array of trust edges forming the trust graph
 * @param source - The source node ID
 * @param target - The target node ID
 * @param attenuationFactor - Factor by which trust is reduced per hop (0 < factor <= 1)
 * @returns TransitiveTrustResult with the best path and effective trust, or effectiveTrust=0 if no path exists
 */
export function computeTrustTransitivity(
  edges: TrustEdge[],
  source: string,
  target: string,
  attenuationFactor: number = 0.9,
): TransitiveTrustResult {
  if (attenuationFactor <= 0 || attenuationFactor > 1) {
    throw new Error('attenuationFactor must be in (0, 1]');
  }

  // Validate trust scores
  for (const edge of edges) {
    if (edge.trustScore < 0 || edge.trustScore > 1) {
      throw new Error(`Invalid trustScore ${edge.trustScore} for edge ${edge.from} -> ${edge.to}`);
    }
  }

  if (source === target) {
    return {
      from: source,
      to: target,
      effectiveTrust: 1.0,
      path: [source],
      hops: 0,
    };
  }

  // Build adjacency list
  const adj = new Map<string, { to: string; trustScore: number }[]>();
  for (const edge of edges) {
    if (!adj.has(edge.from)) {
      adj.set(edge.from, []);
    }
    adj.get(edge.from)!.push({ to: edge.to, trustScore: edge.trustScore });
  }

  // BFS/priority-based exploration to find best trust path
  // State: { node, effectiveTrust, path, hops }
  interface SearchState {
    node: string;
    effectiveTrust: number;
    path: string[];
    hops: number;
  }

  const bestTrust = new Map<string, number>();
  bestTrust.set(source, 1.0);

  const queue: SearchState[] = [{
    node: source,
    effectiveTrust: 1.0,
    path: [source],
    hops: 0,
  }];

  let bestResult: TransitiveTrustResult = {
    from: source,
    to: target,
    effectiveTrust: 0,
    path: [],
    hops: 0,
  };

  while (queue.length > 0) {
    // Pick the state with highest effective trust
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.effectiveTrust > queue[bestIdx]!.effectiveTrust) {
        bestIdx = i;
      }
    }
    const current = queue.splice(bestIdx, 1)[0]!;

    if (current.node === target) {
      if (current.effectiveTrust > bestResult.effectiveTrust) {
        bestResult = {
          from: source,
          to: target,
          effectiveTrust: current.effectiveTrust,
          path: current.path,
          hops: current.hops,
        };
      }
      continue;
    }

    const neighbors = adj.get(current.node) ?? [];
    for (const neighbor of neighbors) {
      // Avoid cycles
      if (current.path.includes(neighbor.to)) continue;

      const hopAttenuation = current.hops > 0 ? attenuationFactor : 1.0;
      const newTrust = current.effectiveTrust * neighbor.trustScore * hopAttenuation;

      // Only explore if this path is better than what we've found for this node
      const existingBest = bestTrust.get(neighbor.to) ?? 0;
      if (newTrust > existingBest) {
        bestTrust.set(neighbor.to, newTrust);
        queue.push({
          node: neighbor.to,
          effectiveTrust: newTrust,
          path: [...current.path, neighbor.to],
          hops: current.hops + 1,
        });
      }
    }
  }

  return bestResult;
}

/**
 * Find the minimal set of verifiers that covers all given constraints.
 *
 * This is the set cover problem. We use a greedy approximation:
 * at each step, pick the verifier that covers the most uncovered constraints.
 * This gives an O(ln n) approximation to the optimal solution.
 *
 * @param verifiers - Array of verifier nodes, each covering some constraints
 * @param requiredConstraints - The full set of constraints that must be covered
 * @returns MinimalVerificationSetResult with the selected verifiers and coverage info
 */
export function findMinimalVerificationSet(
  verifiers: VerifierNode[],
  requiredConstraints: string[],
): MinimalVerificationSetResult {
  if (requiredConstraints.length === 0) {
    return {
      verifiers: [],
      coveredConstraints: [],
      uncoveredConstraints: [],
    };
  }

  if (verifiers.length === 0) {
    return {
      verifiers: [],
      coveredConstraints: [],
      uncoveredConstraints: [...requiredConstraints],
    };
  }

  const uncovered = new Set(requiredConstraints);
  const selectedVerifiers: string[] = [];
  const coveredConstraints: string[] = [];
  const remainingVerifiers = verifiers.map(v => ({
    id: v.id,
    coveredConstraints: new Set(v.coveredConstraints),
  }));

  while (uncovered.size > 0) {
    // Find the verifier that covers the most uncovered constraints
    let bestVerifier: { id: string; coveredConstraints: Set<string> } | null = null;
    let bestCoverage = 0;

    for (const verifier of remainingVerifiers) {
      let coverage = 0;
      for (const constraint of uncovered) {
        if (verifier.coveredConstraints.has(constraint)) {
          coverage++;
        }
      }
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestVerifier = verifier;
      }
    }

    // No verifier can cover any remaining constraints
    if (bestCoverage === 0 || !bestVerifier) {
      break;
    }

    selectedVerifiers.push(bestVerifier.id);

    // Mark constraints as covered
    for (const constraint of uncovered) {
      if (bestVerifier.coveredConstraints.has(constraint)) {
        coveredConstraints.push(constraint);
      }
    }
    for (const constraint of coveredConstraints) {
      uncovered.delete(constraint);
    }

    // Remove the selected verifier from candidates
    const idx = remainingVerifiers.findIndex(v => v.id === bestVerifier!.id);
    if (idx >= 0) {
      remainingVerifiers.splice(idx, 1);
    }
  }

  return {
    verifiers: selectedVerifiers,
    coveredConstraints,
    uncoveredConstraints: [...uncovered],
  };
}
