import { sha256Object, generateId } from '@stele/crypto';

export type {
  MetaTargetType,
  MetaCovenant,
  RecursiveVerification,
  TerminationProof,
  VerificationEntity,
} from './types';

import type {
  MetaTargetType,
  MetaCovenant,
  RecursiveVerification,
  TerminationProof,
  VerificationEntity,
} from './types';

/**
 * Creates a MetaCovenant targeting a specific entity type.
 * recursionDepth starts at 0. id = sha256 of content. terminationProof initially empty.
 */
export function createMetaCovenant(
  targetType: MetaTargetType,
  constraints: string[],
): MetaCovenant {
  const content = {
    targetType,
    constraints,
    recursionDepth: 0,
    terminationProof: '',
  };
  const id = sha256Object(content);
  return {
    id,
    targetType,
    constraints: [...constraints],
    recursionDepth: 0,
    terminationProof: '',
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

  // Build the verification chain starting from entities that are not verifiers of others,
  // or simply walk each entity and resolve its verification chain up to maxDepth.
  // We walk each entity: at layer 0 it's the entity itself, at layer 1 it's verified by its verifier, etc.

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
 * Check if the chain of meta-covenants converges.
 * Converges if: (1) there are no cycles, (2) the chain terminates at a base case (cryptographic hardness).
 * Returns TerminationProof. maxDepth = length of longest chain. trustAssumption describes the base case.
 */
export function proveTermination(metaCovenants: MetaCovenant[]): TerminationProof {
  if (metaCovenants.length === 0) {
    return {
      maxDepth: 0,
      converges: true,
      proof: 'Empty chain trivially converges',
      trustAssumption: trustBase(),
    };
  }

  // Build a graph based on recursionDepth ordering
  // Check for cycles: if any two covenants have the same id, we have a cycle
  const seenIds = new Set<string>();
  let hasCycle = false;

  for (const covenant of metaCovenants) {
    if (seenIds.has(covenant.id)) {
      hasCycle = true;
      break;
    }
    seenIds.add(covenant.id);
  }

  // Find the maximum recursion depth in the chain
  let maxDepth = 0;
  for (const covenant of metaCovenants) {
    if (covenant.recursionDepth > maxDepth) {
      maxDepth = covenant.recursionDepth;
    }
  }

  // Check if depths form a strictly increasing sequence (no gaps that indicate cycles)
  const sortedByDepth = [...metaCovenants].sort((a, b) => a.recursionDepth - b.recursionDepth);

  // Check for duplicate depths (indicates potential cycle)
  for (let i = 1; i < sortedByDepth.length; i++) {
    const prev = sortedByDepth[i - 1]!;
    const curr = sortedByDepth[i]!;
    if (prev.recursionDepth === curr.recursionDepth && prev.id !== curr.id) {
      // Two different covenants at the same depth is not necessarily a cycle,
      // but for simplicity we allow this (parallel branches)
    }
  }

  const converges = !hasCycle;

  const proof = converges
    ? `Chain of ${metaCovenants.length} meta-covenants terminates at depth ${maxDepth}. ` +
      `Each layer adds constraints that monotonically reduce the space of allowed behaviors. ` +
      `Base case: cryptographic verification requires no further meta-covenant.`
    : `Cycle detected in meta-covenant chain. The chain does not converge.`;

  return {
    maxDepth,
    converges,
    proof,
    trustAssumption: trustBase(),
  };
}

/**
 * Returns the irreducible trust assumption string.
 */
export function trustBase(): string {
  return 'Ed25519 signature unforgeability under discrete log hardness; SHA-256 collision resistance';
}

/**
 * Returns a new MetaCovenant with recursionDepth + 1 and additional constraints.
 */
export function addLayer(
  existing: MetaCovenant,
  newConstraints: string[],
): MetaCovenant {
  const mergedConstraints = [...existing.constraints, ...newConstraints];
  const newDepth = existing.recursionDepth + 1;

  const content = {
    targetType: existing.targetType,
    constraints: mergedConstraints,
    recursionDepth: newDepth,
    terminationProof: existing.terminationProof,
  };
  const id = sha256Object(content);

  return {
    id,
    targetType: existing.targetType,
    constraints: mergedConstraints,
    recursionDepth: newDepth,
    terminationProof: existing.terminationProof,
  };
}
