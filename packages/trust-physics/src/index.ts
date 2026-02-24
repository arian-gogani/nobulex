import { sha256Object, timestamp } from '@nobulex/crypto';
import type { AgentIdentity } from '@nobulex/identity';
import type { ComplianceProof } from '@nobulex/proof';
import type { CovenantDocument } from '@nobulex/core';

export type {
  TrustVector,
  CoreDimension,
  TrustConstraint,
  TrustContext,
  DirectionalTrust,
  DecayConfig,
  TrustChain,
  TrustDispute,
  StakeOutcome,
  TrustStake,
  AggregatedTrustVector,
} from './types';

export { CORE_DIMENSIONS } from './types';

import type {
  TrustVector,
  TrustContext,
  DirectionalTrust,
  DecayConfig,
  TrustChain,
  TrustDispute,
  StakeOutcome,
  TrustStake,
  AggregatedTrustVector,
} from './types';

import { CORE_DIMENSIONS } from './types';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default per-hop attenuation factor for trust chains. */
export const DEFAULT_ATTENUATION = 0.7;

/** Default maximum trust chain length. */
export const DEFAULT_MAX_CHAIN_LENGTH = 6;

/** Default decay rate (lambda) per millisecond. Approximately 30-day half-life. */
export const DEFAULT_DECAY_RATE = 2.674e-10;

/**
 * Minimum reinforcements before adaptive decay kicks in.
 * Agents must prove themselves before earning slower decay.
 */
export const ADAPTIVE_DECAY_THRESHOLD = 3;

/**
 * Factor by which the decay rate is multiplied per reinforcement beyond the threshold.
 * Each additional verification multiplies λ by this factor, reducing λ and thereby
 * increasing the effective half-life by a factor of 1/0.85 ≈ 1.176 (~17.6% longer).
 */
export const ADAPTIVE_DECAY_FACTOR = 0.85;

// ─── Trust Vector Operations ────────────────────────────────────────────────

/**
 * Create a new TrustVector with all core dimensions set to a uniform value.
 *
 * @param value - The value to assign to every core dimension (clamped to [0, 1]).
 * @param customDimensions - Optional custom dimension entries.
 * @returns A new TrustVector.
 */
export function createTrustVector(
  value: number = 0,
  customDimensions?: Record<string, number>,
): TrustVector {
  const clamped = clamp01(value);
  const dimensions = new Map<string, number>();
  if (customDimensions) {
    for (const [key, val] of Object.entries(customDimensions)) {
      dimensions.set(key, clamp01(val));
    }
  }
  return {
    reliability: clamped,
    capability: clamped,
    integrity: clamped,
    benevolence: clamped,
    predictability: clamped,
    transparency: clamped,
    dimensions,
  };
}

/**
 * Create a TrustVector from individual dimension values.
 *
 * @param values - An object with values for each core dimension and optional custom dimensions.
 * @returns A new TrustVector.
 */
export function createTrustVectorFromValues(values: {
  reliability: number;
  capability: number;
  integrity: number;
  benevolence: number;
  predictability: number;
  transparency: number;
  dimensions?: Record<string, number>;
}): TrustVector {
  const dimensions = new Map<string, number>();
  if (values.dimensions) {
    for (const [key, val] of Object.entries(values.dimensions)) {
      dimensions.set(key, clamp01(val));
    }
  }
  return {
    reliability: clamp01(values.reliability),
    capability: clamp01(values.capability),
    integrity: clamp01(values.integrity),
    benevolence: clamp01(values.benevolence),
    predictability: clamp01(values.predictability),
    transparency: clamp01(values.transparency),
    dimensions,
  };
}

/**
 * Compute the Euclidean magnitude of a trust vector across its core dimensions.
 *
 * The magnitude is normalized by the number of core dimensions so that
 * a vector with all dimensions at 1.0 has magnitude 1.0.
 *
 * @param vector - The trust vector.
 * @returns A scalar in [0, 1] representing the overall trust magnitude.
 */
export function trustMagnitude(vector: TrustVector): number {
  let sumSquared = 0;
  for (const dim of CORE_DIMENSIONS) {
    sumSquared += vector[dim] * vector[dim];
  }
  return Math.sqrt(sumSquared / CORE_DIMENSIONS.length);
}

/**
 * Scale every dimension of a trust vector by a scalar factor.
 *
 * @param vector - The trust vector to scale.
 * @param factor - The scaling factor. Result dimensions are clamped to [0, 1].
 * @returns A new scaled TrustVector.
 */
export function scaleTrustVector(vector: TrustVector, factor: number): TrustVector {
  const dimensions = new Map<string, number>();
  for (const [key, val] of vector.dimensions) {
    dimensions.set(key, clamp01(val * factor));
  }
  return {
    reliability: clamp01(vector.reliability * factor),
    capability: clamp01(vector.capability * factor),
    integrity: clamp01(vector.integrity * factor),
    benevolence: clamp01(vector.benevolence * factor),
    predictability: clamp01(vector.predictability * factor),
    transparency: clamp01(vector.transparency * factor),
    dimensions,
  };
}

/**
 * Component-wise multiplication of two trust vectors.
 *
 * Used for trust chain attenuation: each dimension of the result is
 * the product of the corresponding dimensions of the two inputs.
 *
 * @param a - First trust vector.
 * @param b - Second trust vector.
 * @returns A new TrustVector with component-wise products.
 */
export function multiplyTrustVectors(a: TrustVector, b: TrustVector): TrustVector {
  const dimensions = new Map<string, number>();
  const allKeys = new Set([...a.dimensions.keys(), ...b.dimensions.keys()]);
  for (const key of allKeys) {
    const aVal = a.dimensions.get(key) ?? 0;
    const bVal = b.dimensions.get(key) ?? 0;
    dimensions.set(key, clamp01(aVal * bVal));
  }
  return {
    reliability: clamp01(a.reliability * b.reliability),
    capability: clamp01(a.capability * b.capability),
    integrity: clamp01(a.integrity * b.integrity),
    benevolence: clamp01(a.benevolence * b.benevolence),
    predictability: clamp01(a.predictability * b.predictability),
    transparency: clamp01(a.transparency * b.transparency),
    dimensions,
  };
}

/**
 * Compute a weighted average of multiple trust vectors.
 *
 * @param vectors - Array of trust vectors to average.
 * @param weights - Corresponding weights. Must be same length as vectors.
 * @returns The weighted average TrustVector.
 * @throws If vectors and weights have different lengths or are empty.
 */
export function weightedAverageTrustVectors(
  vectors: TrustVector[],
  weights: number[],
): TrustVector {
  if (vectors.length === 0) {
    throw new Error('Cannot compute weighted average of zero vectors');
  }
  if (vectors.length !== weights.length) {
    throw new Error('Vectors and weights must have the same length');
  }

  let totalWeight = 0;
  for (const w of weights) {
    totalWeight += w;
  }

  if (totalWeight === 0) {
    return createTrustVector(0);
  }

  const result = {
    reliability: 0,
    capability: 0,
    integrity: 0,
    benevolence: 0,
    predictability: 0,
    transparency: 0,
  };

  const customSums = new Map<string, number>();
  const customWeightSums = new Map<string, number>();

  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]!;
    const w = weights[i]!;
    for (const dim of CORE_DIMENSIONS) {
      result[dim] += v[dim] * w;
    }
    for (const [key, val] of v.dimensions) {
      customSums.set(key, (customSums.get(key) ?? 0) + val * w);
      customWeightSums.set(key, (customWeightSums.get(key) ?? 0) + w);
    }
  }

  const dimensions = new Map<string, number>();
  for (const [key, sum] of customSums) {
    const wSum = customWeightSums.get(key) ?? totalWeight;
    dimensions.set(key, clamp01(sum / wSum));
  }

  return {
    reliability: clamp01(result.reliability / totalWeight),
    capability: clamp01(result.capability / totalWeight),
    integrity: clamp01(result.integrity / totalWeight),
    benevolence: clamp01(result.benevolence / totalWeight),
    predictability: clamp01(result.predictability / totalWeight),
    transparency: clamp01(result.transparency / totalWeight),
    dimensions,
  };
}

/**
 * Compute the dot product of two trust vectors across core dimensions.
 *
 * Measures the alignment between two trust assessments. Higher values
 * indicate more similar trust profiles.
 *
 * @param a - First trust vector.
 * @param b - Second trust vector.
 * @returns The dot product (sum of component-wise products).
 */
export function trustDotProduct(a: TrustVector, b: TrustVector): number {
  let sum = 0;
  for (const dim of CORE_DIMENSIONS) {
    sum += a[dim] * b[dim];
  }
  return sum;
}

/**
 * Compute the cosine similarity between two trust vectors.
 *
 * Returns a value in [0, 1] (since all dimensions are non-negative).
 * A value of 1 means the trust profiles are perfectly aligned;
 * 0 means they are orthogonal (completely different trust shapes).
 *
 * Useful for determining whether two assessors agree on the *shape* of
 * trust, independent of the absolute values.
 *
 * @param a - First trust vector.
 * @param b - Second trust vector.
 * @returns Cosine similarity in [0, 1], or 0 if either vector is zero.
 */
export function trustCosineSimilarity(a: TrustVector, b: TrustVector): number {
  const dot = trustDotProduct(a, b);
  const magA = trustMagnitude(a);
  const magB = trustMagnitude(b);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  // trustMagnitude normalizes by sqrt(1/n), so actual magnitude is mag * sqrt(n)
  // But since the normalization factor cancels out in the ratio, we compute directly
  let sumSqA = 0;
  let sumSqB = 0;
  for (const dim of CORE_DIMENSIONS) {
    sumSqA += a[dim] * a[dim];
    sumSqB += b[dim] * b[dim];
  }

  const rawMagA = Math.sqrt(sumSqA);
  const rawMagB = Math.sqrt(sumSqB);

  if (rawMagA === 0 || rawMagB === 0) {
    return 0;
  }

  return clamp01(dot / (rawMagA * rawMagB));
}

// ─── Trust Context Operations ───────────────────────────────────────────────

/**
 * Create a TrustContext.
 *
 * @param domain - The trust domain.
 * @param scope  - The scope within the domain.
 * @param constraints - Optional constraints.
 * @returns A new TrustContext.
 */
export function createTrustContext(
  domain: string,
  scope: string,
  constraints: TrustContext['constraints'] = [],
): TrustContext {
  if (typeof domain !== 'string' || domain.trim() === '') {
    throw new Error('createTrustContext: domain must be a non-empty string');
  }
  if (typeof scope !== 'string' || scope.trim() === '') {
    throw new Error('createTrustContext: scope must be a non-empty string');
  }
  return { domain, scope, constraints };
}

/**
 * Check whether two trust contexts match.
 *
 * Contexts match if they share the same domain and scope. Constraint
 * comparison is left to the caller — this function performs a structural
 * identity check on domain and scope only.
 */
export function contextsMatch(a: TrustContext, b: TrustContext): boolean {
  return a.domain === b.domain && a.scope === b.scope;
}

// ─── Directional Trust ──────────────────────────────────────────────────────

/**
 * Create a new directional trust edge from one agent to another.
 *
 * @param trustor  - The agent giving trust.
 * @param trustee  - The agent being trusted.
 * @param vector   - The multidimensional trust assessment.
 * @param context  - The domain and scope this trust applies to.
 * @param evidence - Compliance proofs supporting this trust.
 * @returns A new DirectionalTrust with a content-addressed ID.
 */
export function createDirectionalTrust(
  trustor: AgentIdentity,
  trustee: AgentIdentity,
  vector: TrustVector,
  context: TrustContext,
  evidence: ComplianceProof[] = [],
): DirectionalTrust {
  if (trustor == null || typeof trustor.id !== 'string') {
    throw new Error('createDirectionalTrust: trustor must be a valid AgentIdentity with an id');
  }
  if (trustee == null || typeof trustee.id !== 'string') {
    throw new Error('createDirectionalTrust: trustee must be a valid AgentIdentity with an id');
  }
  const ts = timestamp();
  const content = {
    trustorId: trustor.id,
    trusteeId: trustee.id,
    vector: serializeTrustVector(vector),
    context,
    timestamp: ts,
  };
  const id = sha256Object(content);

  return {
    id,
    trustor,
    trustee,
    vector,
    context,
    timestamp: ts,
    evidence,
  };
}

// ─── Time-Decaying Trust ────────────────────────────────────────────────────

/**
 * Create a default decay configuration.
 *
 * @param decayRate - Lambda (per millisecond). Defaults to ~30-day half-life.
 * @returns A new DecayConfig.
 */
export function createDecayConfig(decayRate: number = DEFAULT_DECAY_RATE): DecayConfig {
  if (!Number.isFinite(decayRate) || decayRate < 0) {
    throw new Error(
      `createDecayConfig: decayRate must be a non-negative finite number, got ${decayRate}`,
    );
  }
  const now = timestamp();
  return {
    decayRate,
    lastVerified: now,
    reinforcementHistory: [now],
  };
}

/**
 * Apply exponential time decay to a trust vector.
 *
 * Formula: `trust_now = base * e^(-lambda * elapsed_ms)`
 *
 * If the decay config has enough reinforcement history, the effective
 * lambda is reduced (adaptive decay), rewarding consistently verified agents.
 *
 * @param baseVector - The trust vector at the time of last verification.
 * @param decay      - The decay configuration.
 * @param nowMs      - Current time in epoch milliseconds. Defaults to Date.now().
 * @returns The decayed trust vector.
 */
export function applyDecay(
  baseVector: TrustVector,
  decay: DecayConfig,
  nowMs: number = Date.now(),
): TrustVector {
  const lastVerifiedMs = new Date(decay.lastVerified).getTime();
  const elapsedMs = Math.max(0, nowMs - lastVerifiedMs);

  const effectiveLambda = computeEffectiveLambda(decay);
  const decayFactor = Math.exp(-effectiveLambda * elapsedMs);

  return scaleTrustVector(baseVector, decayFactor);
}

/**
 * Reinforce trust by recording a new covenant verification.
 *
 * Resets the lastVerified timestamp and appends to the reinforcement history,
 * which slows future decay.
 *
 * @param decay - The current decay configuration.
 * @returns A new DecayConfig with updated verification timestamps.
 */
export function reinforceDecay(decay: DecayConfig): DecayConfig {
  const now = timestamp();
  return {
    ...decay,
    lastVerified: now,
    reinforcementHistory: [...decay.reinforcementHistory, now],
  };
}

/**
 * Compute the half-life of trust under the current decay configuration.
 *
 * Half-life = ln(2) / lambda_effective
 *
 * @param decay - The decay configuration.
 * @returns Half-life in milliseconds.
 */
export function computeHalfLife(decay: DecayConfig): number {
  const effectiveLambda = computeEffectiveLambda(decay);
  if (effectiveLambda <= 0) {
    return Infinity;
  }
  return Math.LN2 / effectiveLambda;
}

/**
 * Compute the effective decay lambda, accounting for adaptive slowdown
 * from repeated reinforcements.
 */
function computeEffectiveLambda(decay: DecayConfig): number {
  const reinforcements = decay.reinforcementHistory.length;
  if (reinforcements <= ADAPTIVE_DECAY_THRESHOLD) {
    return decay.decayRate;
  }
  const extraReinforcements = reinforcements - ADAPTIVE_DECAY_THRESHOLD;
  return decay.decayRate * Math.pow(ADAPTIVE_DECAY_FACTOR, extraReinforcements);
}

// ─── Trust Chains ───────────────────────────────────────────────────────────

/**
 * Compute the end-to-end trust vector through a chain of trust relationships.
 *
 * Each hop attenuates trust by the chain's attenuation factor. The result
 * is the component-wise product of all link vectors, scaled by
 * `attenuation^(n-1)` where n is the number of links.
 *
 * @param chain - The trust chain to evaluate.
 * @returns The derived end-to-end trust vector, or a zero vector if the chain is empty.
 */
export function computeChainTrust(chain: TrustChain): TrustVector {
  if (chain.links.length === 0) {
    return createTrustVector(0);
  }

  let result = chain.links[0]!.vector;

  for (let i = 1; i < chain.links.length; i++) {
    result = multiplyTrustVectors(result, chain.links[i]!.vector);
    result = scaleTrustVector(result, chain.attenuation);
  }

  return result;
}

/**
 * Create a TrustChain from a sequence of directional trust edges.
 *
 * @param links       - Ordered trust edges (A→B, B→C, …).
 * @param attenuation - Per-hop attenuation factor. Defaults to DEFAULT_ATTENUATION.
 * @param maxLength   - Maximum chain length. Defaults to DEFAULT_MAX_CHAIN_LENGTH.
 * @returns A new TrustChain.
 * @throws If the chain exceeds maxLength or links are not contiguous.
 */
export function createTrustChain(
  links: DirectionalTrust[],
  attenuation: number = DEFAULT_ATTENUATION,
  maxLength: number = DEFAULT_MAX_CHAIN_LENGTH,
): TrustChain {
  if (!Number.isFinite(attenuation) || attenuation <= 0 || attenuation > 1) {
    throw new Error(
      `createTrustChain: attenuation must be in (0, 1], got ${attenuation}`,
    );
  }
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error(
      `createTrustChain: maxLength must be a positive integer, got ${maxLength}`,
    );
  }
  if (links.length > maxLength) {
    throw new Error(
      `Trust chain length ${links.length} exceeds maximum ${maxLength}`,
    );
  }

  // Validate contiguity: each link's trustee must be the next link's trustor
  for (let i = 0; i < links.length - 1; i++) {
    if (links[i]!.trustee.id !== links[i + 1]!.trustor.id) {
      throw new Error(
        `Trust chain is not contiguous at link ${i}: ` +
        `trustee ${links[i]!.trustee.id} does not match next trustor ${links[i + 1]!.trustor.id}`,
      );
    }
  }

  return {
    links,
    attenuation: clamp01(attenuation),
    maxChainLength: maxLength,
  };
}

// ─── Trust Graph ────────────────────────────────────────────────────────────

/**
 * An in-memory directed graph of trust relationships between agents.
 *
 * The graph stores agents and directed trust edges, and supports queries
 * for direct trust, transitive trust (via pathfinding), aggregated
 * reputation vectors, and context-filtered trust.
 */
export class TrustGraph {
  /** All known agents, keyed by identity hash. */
  readonly agents: Map<string, AgentIdentity> = new Map();

  /** All trust edges in the graph. */
  readonly edges: DirectionalTrust[] = [];

  /** Index: trustorId → list of edge indices for fast lookup. */
  private outgoing: Map<string, number[]> = new Map();

  /** Index: trusteeId → list of edge indices for fast lookup. */
  private incoming: Map<string, number[]> = new Map();

  /**
   * Add an agent to the graph. Idempotent — re-adding an existing agent
   * updates the stored identity.
   */
  addAgent(agent: AgentIdentity): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Add a directional trust edge to the graph.
   *
   * Both trustor and trustee are automatically registered as agents.
   */
  addTrust(trust: DirectionalTrust): void {
    this.addAgent(trust.trustor);
    this.addAgent(trust.trustee);

    const idx = this.edges.length;
    this.edges.push(trust);

    const outList = this.outgoing.get(trust.trustor.id) ?? [];
    outList.push(idx);
    this.outgoing.set(trust.trustor.id, outList);

    const inList = this.incoming.get(trust.trustee.id) ?? [];
    inList.push(idx);
    this.incoming.set(trust.trustee.id, inList);
  }

  /**
   * Remove a specific trust edge by its ID.
   *
   * @param edgeId - The content-addressed ID of the edge to remove.
   * @returns true if the edge was found and removed, false otherwise.
   */
  removeTrust(edgeId: string): boolean {
    const idx = this.edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) {
      return false;
    }

    this.edges.splice(idx, 1);
    this.rebuildIndices();
    return true;
  }

  /**
   * Query direct trust from one agent to another, optionally filtered by context.
   *
   * If multiple edges match, the most recent one is returned.
   *
   * @returns The matching TrustVector, or null if no direct trust exists.
   */
  queryTrust(
    from: AgentIdentity,
    to: AgentIdentity,
    context?: TrustContext,
  ): TrustVector | null {
    const indices = this.outgoing.get(from.id);
    if (!indices) {
      return null;
    }

    let bestEdge: DirectionalTrust | null = null;

    for (const idx of indices) {
      const edge = this.edges[idx]!;
      if (edge.trustee.id !== to.id) {
        continue;
      }
      if (context && !contextsMatch(edge.context, context)) {
        continue;
      }
      if (!bestEdge || edge.timestamp > bestEdge.timestamp) {
        bestEdge = edge;
      }
    }

    return bestEdge?.vector ?? null;
  }

  /**
   * Find all trust paths from one agent to another using breadth-first search.
   *
   * When a context is provided, only edges matching that context are traversed,
   * ensuring the returned chains are semantically coherent (no mixing of
   * financial trust with medical trust, for example).
   *
   * @param from    - The starting agent.
   * @param to      - The target agent.
   * @param maxHops - Maximum path length. Defaults to DEFAULT_MAX_CHAIN_LENGTH.
   * @param context - Optional context filter. Only edges matching this context are followed.
   * @returns All discovered TrustChains, shortest paths first.
   */
  findTrustPaths(
    from: AgentIdentity,
    to: AgentIdentity,
    maxHops: number = DEFAULT_MAX_CHAIN_LENGTH,
    context?: TrustContext,
  ): TrustChain[] {
    const results: TrustChain[] = [];

    // BFS with per-path visited tracking to prevent cycles while allowing
    // different branches to explore the same node independently.
    type QueueEntry = { agentId: string; path: DirectionalTrust[]; visited: Set<string> };
    const initialVisited = new Set<string>([from.id]);
    const queue: QueueEntry[] = [{ agentId: from.id, path: [], visited: initialVisited }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length >= maxHops) {
        continue;
      }

      const outIndices = this.outgoing.get(current.agentId);
      if (!outIndices) {
        continue;
      }

      for (const idx of outIndices) {
        const edge = this.edges[idx]!;

        // Filter by context if provided
        if (context && !contextsMatch(edge.context, context)) {
          continue;
        }

        // Allow reaching the target even if it's in visited, but prevent other cycles
        if (current.visited.has(edge.trustee.id) && edge.trustee.id !== to.id) {
          continue;
        }

        const newPath = [...current.path, edge];

        if (edge.trustee.id === to.id) {
          results.push({
            links: newPath,
            attenuation: DEFAULT_ATTENUATION,
            maxChainLength: maxHops,
          });
        } else {
          // Carry forward the visited set with the new node added
          const newVisited = new Set(current.visited);
          newVisited.add(edge.trustee.id);
          queue.push({ agentId: edge.trustee.id, path: newPath, visited: newVisited });
        }
      }
    }

    return results;
  }

  /**
   * Compute an aggregated reputation vector for an agent from all
   * incoming trust assessments.
   *
   * Each assessor's contribution is weighted equally. For weighted
   * aggregation, use {@link aggregateTrust} directly.
   */
  getReputationVector(agent: AgentIdentity): AggregatedTrustVector {
    const inIndices = this.incoming.get(agent.id);
    if (!inIndices || inIndices.length === 0) {
      return {
        vector: createTrustVector(0),
        assessorCount: 0,
        totalWeight: 0,
      };
    }

    const vectors: TrustVector[] = [];
    for (const idx of inIndices) {
      vectors.push(this.edges[idx]!.vector);
    }

    const weights = vectors.map(() => 1);
    return {
      vector: weightedAverageTrustVectors(vectors, weights),
      assessorCount: vectors.length,
      totalWeight: vectors.length,
    };
  }

  /**
   * Get trust for an agent filtered to a specific context.
   *
   * Aggregates all incoming trust edges that match the given context.
   */
  getContextualTrust(
    agent: AgentIdentity,
    context: TrustContext,
  ): TrustVector {
    const inIndices = this.incoming.get(agent.id);
    if (!inIndices || inIndices.length === 0) {
      return createTrustVector(0);
    }

    const vectors: TrustVector[] = [];
    for (const idx of inIndices) {
      const edge = this.edges[idx]!;
      if (contextsMatch(edge.context, context)) {
        vectors.push(edge.vector);
      }
    }

    if (vectors.length === 0) {
      return createTrustVector(0);
    }

    const weights = vectors.map(() => 1);
    return weightedAverageTrustVectors(vectors, weights);
  }

  /**
   * Remove all trust edges whose magnitude has decayed below a threshold.
   *
   * @param threshold - Minimum trust magnitude to retain (0–1).
   * @param decayConfigs - Map from edge ID to its decay configuration.
   * @param nowMs - Current time in epoch milliseconds.
   * @returns Number of edges pruned.
   */
  pruneDecayed(
    threshold: number,
    decayConfigs: Map<string, DecayConfig>,
    nowMs: number = Date.now(),
  ): number {
    let pruned = 0;
    const surviving: DirectionalTrust[] = [];

    for (const edge of this.edges) {
      const decay = decayConfigs.get(edge.id);
      const vector = decay ? applyDecay(edge.vector, decay, nowMs) : edge.vector;
      const mag = trustMagnitude(vector);

      if (mag >= threshold) {
        surviving.push(edge);
      } else {
        pruned++;
      }
    }

    // Replace edges with survivors and rebuild indices
    this.edges.length = 0;
    for (const edge of surviving) {
      this.edges.push(edge);
    }
    this.rebuildIndices();

    return pruned;
  }

  /** Rebuild the outgoing/incoming index maps from the current edges array. */
  private rebuildIndices(): void {
    this.outgoing = new Map();
    this.incoming = new Map();

    for (let idx = 0; idx < this.edges.length; idx++) {
      const edge = this.edges[idx]!;

      const outList = this.outgoing.get(edge.trustor.id) ?? [];
      outList.push(idx);
      this.outgoing.set(edge.trustor.id, outList);

      const inList = this.incoming.get(edge.trustee.id) ?? [];
      inList.push(idx);
      this.incoming.set(edge.trustee.id, inList);
    }
  }
}

// ─── Trust Aggregation ──────────────────────────────────────────────────────

/**
 * Aggregate multiple trust assessments into a single trust vector using
 * a weighted average.
 *
 * Assessor weights can encode the trustworthiness of the assessors themselves:
 * more trustworthy assessors have more influence on the result.
 *
 * @param assessments   - The trust assessments to aggregate.
 * @param assessorWeights - Optional per-assessor weights (keyed by trustor ID).
 * @returns The aggregated trust vector.
 */
export function aggregateTrust(
  assessments: DirectionalTrust[],
  assessorWeights?: Map<string, number>,
): TrustVector {
  if (assessments.length === 0) {
    return createTrustVector(0);
  }

  const vectors = assessments.map((a) => a.vector);
  const weights = assessments.map((a) => assessorWeights?.get(a.trustor.id) ?? 1);
  return weightedAverageTrustVectors(vectors, weights);
}

/**
 * Compute the consensus trust vector — the component-wise minimum across
 * all assessors.
 *
 * This yields a conservative estimate: the trust level that every assessor
 * agrees on at minimum.
 *
 * @param assessments - The trust assessments.
 * @returns The consensus (minimum) trust vector.
 */
export function consensusTrust(assessments: DirectionalTrust[]): TrustVector {
  if (assessments.length === 0) {
    return createTrustVector(0);
  }

  const result: Record<string, number> = {};
  for (const dim of CORE_DIMENSIONS) {
    result[dim] = 1;
  }

  const customMins = new Map<string, number>();

  for (const a of assessments) {
    for (const dim of CORE_DIMENSIONS) {
      if (a.vector[dim] < result[dim]!) {
        result[dim] = a.vector[dim];
      }
    }
    for (const [key, val] of a.vector.dimensions) {
      const current = customMins.get(key) ?? 1;
      if (val < current) {
        customMins.set(key, val);
      }
    }
  }

  return {
    reliability: result['reliability']!,
    capability: result['capability']!,
    integrity: result['integrity']!,
    benevolence: result['benevolence']!,
    predictability: result['predictability']!,
    transparency: result['transparency']!,
    dimensions: customMins,
  };
}

/**
 * Detect disputes among assessors — cases where trust assessments
 * differ significantly on one or more dimensions.
 *
 * @param assessments - The trust assessments to compare.
 * @param threshold   - Maximum allowed spread (max - min) per dimension.
 * @returns An array of detected disputes.
 */
export function detectDisputes(
  assessments: DirectionalTrust[],
  threshold: number,
): TrustDispute[] {
  if (assessments.length < 2) {
    return [];
  }

  // Group assessments by trustee ID
  const byTrustee = new Map<string, DirectionalTrust[]>();
  for (const a of assessments) {
    const group = byTrustee.get(a.trustee.id) ?? [];
    group.push(a);
    byTrustee.set(a.trustee.id, group);
  }

  const disputes: TrustDispute[] = [];

  for (const [, group] of byTrustee) {
    if (group.length < 2) {
      continue;
    }

    const disputedDims: string[] = [];
    let maxSpread = 0;

    for (const dim of CORE_DIMENSIONS) {
      const values = group.map((a) => a.vector[dim]);
      const spread = Math.max(...values) - Math.min(...values);
      if (spread > threshold) {
        disputedDims.push(dim);
        if (spread > maxSpread) {
          maxSpread = spread;
        }
      }
    }

    // Check custom dimensions
    const allCustomKeys = new Set<string>();
    for (const a of group) {
      for (const key of a.vector.dimensions.keys()) {
        allCustomKeys.add(key);
      }
    }
    for (const key of allCustomKeys) {
      const values = group.map((a) => a.vector.dimensions.get(key) ?? 0);
      const spread = Math.max(...values) - Math.min(...values);
      if (spread > threshold) {
        disputedDims.push(key);
        if (spread > maxSpread) {
          maxSpread = spread;
        }
      }
    }

    if (disputedDims.length > 0) {
      disputes.push({
        trustee: group[0]!.trustee,
        context: group[0]!.context,
        dimensions: disputedDims,
        maxSpread,
        assessments: group,
      });
    }
  }

  return disputes;
}

// ─── Trust Staking ──────────────────────────────────────────────────────────

/**
 * Create a new trust stake where an agent risks reputation on a claim
 * about another agent's covenant compliance.
 *
 * @param staker           - The agent staking their reputation.
 * @param subject          - The agent being vouched for.
 * @param claim            - The covenant whose compliance is guaranteed.
 * @param stakedReputation - Fraction of reputation at risk (0–1).
 * @param reward           - Reputation gain if verified true (0–1).
 * @param penalty          - Reputation loss if verified false (0–1).
 * @param expiryMs         - Stake duration in milliseconds from now.
 * @returns A new TrustStake.
 */
export function createTrustStake(
  staker: AgentIdentity,
  subject: AgentIdentity,
  claim: CovenantDocument,
  stakedReputation: number,
  reward: number,
  penalty: number,
  expiryMs: number,
): TrustStake {
  if (staker == null || typeof staker.id !== 'string') {
    throw new Error('createTrustStake: staker must be a valid AgentIdentity with an id');
  }
  if (subject == null || typeof subject.id !== 'string') {
    throw new Error('createTrustStake: subject must be a valid AgentIdentity with an id');
  }
  if (claim == null || typeof claim.id !== 'string') {
    throw new Error('createTrustStake: claim must be a valid CovenantDocument with an id');
  }
  const content = {
    stakerId: staker.id,
    subjectId: subject.id,
    claimId: claim.id,
    stakedReputation: clamp01(stakedReputation),
    reward: clamp01(reward),
    penalty: clamp01(penalty),
    expiry: new Date(Date.now() + expiryMs).toISOString(),
  };

  const id = sha256Object(content);
  return {
    id,
    staker,
    subject,
    claim,
    stakedReputation: clamp01(stakedReputation),
    reward: clamp01(reward),
    penalty: clamp01(penalty),
    expiry: content.expiry,
    status: 'active',
  };
}

/**
 * Resolve a trust stake by verifying the claimed covenant compliance.
 *
 * If a valid proof is provided that matches the stake's claim covenant,
 * the staker is rewarded. Otherwise, the staker is penalized.
 *
 * @param stake - The active stake to resolve.
 * @param proof - The compliance proof (or null if no proof was produced).
 * @returns The stake outcome and the updated stake.
 */
export function resolveStake(
  stake: TrustStake,
  proof: ComplianceProof | null,
): { outcome: StakeOutcome; updatedStake: TrustStake } {
  if (stake.status !== 'active') {
    throw new Error(
      `Cannot resolve stake ${stake.id}: status is '${stake.status}', expected 'active'`,
    );
  }

  const now = timestamp();

  // Check if stake has expired
  const expiryMs = new Date(stake.expiry).getTime();
  if (Date.now() > expiryMs) {
    return {
      outcome: {
        verified: false,
        reputationDelta: -stake.penalty,
        proof: null,
        resolvedAt: now,
      },
      updatedStake: { ...stake, status: 'expired' },
    };
  }

  // Verify proof matches the claim
  const verified = proof !== null && proof.covenantId === stake.claim.id;

  const reputationDelta = verified ? stake.reward : -stake.penalty;
  const status = verified ? 'resolved_rewarded' as const : 'resolved_penalized' as const;

  return {
    outcome: {
      verified,
      reputationDelta,
      proof,
      resolvedAt: now,
    },
    updatedStake: { ...stake, status },
  };
}

// ─── Internal Utilities ─────────────────────────────────────────────────────

/** Clamp a number to [0, 1]. NaN and -Infinity become 0; +Infinity becomes 1. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return value > 0 ? 1 : 0; // +Infinity → 1, -Infinity/NaN → 0
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Serialize a TrustVector into a plain object suitable for hashing.
 *
 * Converts the Map to a sorted-key object for deterministic serialization.
 */
function serializeTrustVector(
  vector: TrustVector,
): Record<string, unknown> {
  const customEntries: [string, number][] = [...vector.dimensions.entries()].sort(
    (a, b) => a[0].localeCompare(b[0]),
  );
  return {
    reliability: vector.reliability,
    capability: vector.capability,
    integrity: vector.integrity,
    benevolence: vector.benevolence,
    predictability: vector.predictability,
    transparency: vector.transparency,
    dimensions: Object.fromEntries(customEntries),
  };
}
