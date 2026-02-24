import type { HashHex } from '@nobulex/crypto';
import type { AgentIdentity } from '@nobulex/identity';
import type { CovenantDocument } from '@nobulex/core';
import type { ComplianceProof } from '@nobulex/proof';

// ─── Trust Vector ───────────────────────────────────────────────────────────

/**
 * A multidimensional trust assessment.
 *
 * Trust is not a single number — it is a vector with independent dimensions
 * that capture different aspects of trustworthiness. Each core dimension is
 * a value in [0, 1]. The `dimensions` map allows protocol consumers to
 * define additional domain-specific trust dimensions.
 */
export interface TrustVector {
  /** Does the agent do what it says? (0–1) */
  reliability: number;
  /** Can the agent perform this task competently? (0–1) */
  capability: number;
  /** Does the agent act honestly when unobserved? (0–1) */
  integrity: number;
  /** Does the agent act in others' interests? (0–1) */
  benevolence: number;
  /** How consistent is the agent's behavior? (0–1) */
  predictability: number;
  /** How observable are the agent's processes? (0–1) */
  transparency: number;
  /** Extensible custom dimensions, each in [0, 1]. */
  dimensions: Map<string, number>;
}

/** The six core dimension keys in a TrustVector (excluding custom dimensions). */
export const CORE_DIMENSIONS = [
  'reliability',
  'capability',
  'integrity',
  'benevolence',
  'predictability',
  'transparency',
] as const;

/** One of the six core trust dimension names. */
export type CoreDimension = (typeof CORE_DIMENSIONS)[number];

// ─── Trust Context ──────────────────────────────────────────────────────────

/** A constraint limiting the scope of trust within a context. */
export interface TrustConstraint {
  /** Machine-readable key for the constraint (e.g. `"max_value"`). */
  key: string;
  /** The constraint operator. */
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'in';
  /** The value to compare against. */
  value: string | number | boolean | string[];
}

/**
 * The domain and scope to which a trust relationship applies.
 *
 * An agent trusted for financial transactions is NOT automatically trusted
 * for medical decisions. Trust is always scoped to a context.
 */
export interface TrustContext {
  /** The trust domain (e.g. `"financial"`, `"medical"`, `"logistics"`). */
  domain: string;
  /** A finer-grained scope within the domain (e.g. `"transactions_under_10k"`). */
  scope: string;
  /** Specific constraints limiting trust within this context. */
  constraints: TrustConstraint[];
}

// ─── Directional Trust ──────────────────────────────────────────────────────

/**
 * A directional, context-scoped trust assessment from one agent to another.
 *
 * Trust is NOT symmetric — Agent A trusting Agent B does not imply B trusts A.
 * Each DirectionalTrust is a directed edge in the trust graph.
 */
export interface DirectionalTrust {
  /** Unique identifier (SHA-256 of content fields). */
  id: HashHex;
  /** The agent giving trust. */
  trustor: AgentIdentity;
  /** The agent being trusted. */
  trustee: AgentIdentity;
  /** The multidimensional trust assessment. */
  vector: TrustVector;
  /** The domain and scope this trust applies to. */
  context: TrustContext;
  /** ISO 8601 timestamp when this trust was established. */
  timestamp: string;
  /** Verified covenants that provide evidence for this trust. */
  evidence: ComplianceProof[];
}

// ─── Decaying Trust ─────────────────────────────────────────────────────────

/**
 * Configuration for time-decaying trust.
 *
 * Trust erodes without reinforcement. The decay formula is:
 *
 *     trust_now = base_trust * e^(-lambda * (now - last_verified))
 *
 * Trust that is regularly reinforced by verified covenants decays slower
 * (lambda decreases). Trust that hasn't been verified recently decays faster.
 */
export interface DecayConfig {
  /** Decay constant lambda (per millisecond). Higher = faster decay. */
  decayRate: number;
  /** ISO 8601 timestamp of the last covenant verification. */
  lastVerified: string;
  /** ISO 8601 timestamps of past verifications for adaptive decay. */
  reinforcementHistory: string[];
}

// ─── Trust Chain ────────────────────────────────────────────────────────────

/**
 * A chain of trust relationships enabling derived trust.
 *
 * If A trusts B and B trusts C, then A has derived trust in C —
 * but trust attenuates through each hop.
 */
export interface TrustChain {
  /** Ordered links in the trust chain (A→B, B→C, …). */
  links: DirectionalTrust[];
  /** Per-hop attenuation factor in (0, 1]. Each hop reduces trust by this factor. */
  attenuation: number;
  /** Maximum allowed chain length. */
  maxChainLength: number;
}

// ─── Trust Aggregation ──────────────────────────────────────────────────────

/**
 * A dispute detected when assessors significantly disagree about a trustee.
 */
export interface TrustDispute {
  /** The trustee whose assessments disagree. */
  trustee: AgentIdentity;
  /** The trust context where the dispute was detected. */
  context: TrustContext;
  /** The dimension(s) with the largest disagreement. */
  dimensions: string[];
  /** Maximum spread (max - min) across the disputed dimension(s). */
  maxSpread: number;
  /** The conflicting assessments. */
  assessments: DirectionalTrust[];
}

// ─── Trust Staking ──────────────────────────────────────────────────────────

/**
 * Outcome of resolving a trust stake.
 */
export interface StakeOutcome {
  /** Whether the staked claim was verified as true. */
  verified: boolean;
  /** Reputation change for the staker. Positive = reward, negative = penalty. */
  reputationDelta: number;
  /** The compliance proof used to resolve the stake (if any). */
  proof: ComplianceProof | null;
  /** ISO 8601 timestamp of resolution. */
  resolvedAt: string;
}

/**
 * A reputation stake — an agent risks their own trust score on a claim
 * about another agent's behavior.
 *
 * This creates a trust economy: agents with high trust can vouch for
 * others by putting their reputation on the line.
 */
export interface TrustStake {
  /** Unique identifier (SHA-256 of content fields). */
  id: HashHex;
  /** The agent staking their reputation. */
  staker: AgentIdentity;
  /** The agent being vouched for. */
  subject: AgentIdentity;
  /** The covenant whose compliance is being guaranteed. */
  claim: CovenantDocument;
  /** Fraction of reputation the staker risks (0–1). */
  stakedReputation: number;
  /** Reputation gain if the claim is verified true (0–1). */
  reward: number;
  /** Reputation loss if the claim is verified false (0–1). */
  penalty: number;
  /** ISO 8601 timestamp when this stake expires. */
  expiry: string;
  /** Current status of the stake. */
  status: 'active' | 'resolved_rewarded' | 'resolved_penalized' | 'expired';
}

// ─── Aggregated Trust Vector ────────────────────────────────────────────────

/**
 * A trust vector aggregated from multiple assessors, with metadata
 * about the aggregation process.
 */
export interface AggregatedTrustVector {
  /** The aggregated trust vector. */
  vector: TrustVector;
  /** Number of assessors that contributed. */
  assessorCount: number;
  /** Sum of assessor weights. */
  totalWeight: number;
}
