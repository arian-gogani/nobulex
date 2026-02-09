import { sha256Object, generateId } from '@stele/crypto';

export type {
  AccountabilityTier,
  AccountabilityScore,
  InteractionPolicy,
  AccessDecision,
  ProtocolData,
} from './types';

import type {
  AccountabilityTier,
  AccountabilityScore,
  InteractionPolicy,
  AccessDecision,
  ProtocolData,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AccountabilityConfig {
  tierThresholds?: {
    exemplary: number;  // default 0.9
    trusted: number;    // default 0.7
    verified: number;   // default 0.5
    basic: number;      // default 0.3
  };
  componentWeights?: {
    covenantCompleteness: number;  // default 0.15
    complianceHistory: number;     // default 0.30
    stakeRatio: number;            // default 0.20
    attestationCoverage: number;   // default 0.20
    canaryPassRate: number;        // default 0.15
  };
  minimumCovenants?: number;  // default 3
}

const DEFAULT_TIER_THRESHOLDS = {
  exemplary: 0.9,
  trusted: 0.7,
  verified: 0.5,
  basic: 0.3,
};

const DEFAULT_COMPONENT_WEIGHTS = {
  covenantCompleteness: 0.15,
  complianceHistory: 0.30,
  stakeRatio: 0.20,
  attestationCoverage: 0.20,
  canaryPassRate: 0.15,
};

const DEFAULT_MINIMUM_COVENANTS = 3;

function resolveConfig(config?: AccountabilityConfig) {
  const thresholds = { ...DEFAULT_TIER_THRESHOLDS, ...config?.tierThresholds };
  const weights = { ...DEFAULT_COMPONENT_WEIGHTS, ...config?.componentWeights };
  const minimumCovenants = config?.minimumCovenants ?? DEFAULT_MINIMUM_COVENANTS;
  return { thresholds, weights, minimumCovenants };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an AccountabilityConfig is well-formed.
 * - Tier thresholds must be in (0, 1) and ordered: exemplary > trusted > verified > basic > 0.
 * - Component weights must be non-negative and sum to approximately 1.0.
 * - minimumCovenants must be >= 1.
 */
export function validateConfig(config: AccountabilityConfig): void {
  if (config.tierThresholds) {
    const t = { ...DEFAULT_TIER_THRESHOLDS, ...config.tierThresholds };
    for (const [name, val] of Object.entries(t)) {
      if (val < 0 || val > 1) {
        throw new Error(`Tier threshold '${name}' must be in [0, 1], got ${val}`);
      }
    }
    if (t.exemplary <= t.trusted || t.trusted <= t.verified || t.verified <= t.basic) {
      throw new Error(
        `Tier thresholds must be strictly ordered: exemplary(${t.exemplary}) > trusted(${t.trusted}) > verified(${t.verified}) > basic(${t.basic})`,
      );
    }
  }

  if (config.componentWeights) {
    const w = { ...DEFAULT_COMPONENT_WEIGHTS, ...config.componentWeights };
    for (const [name, val] of Object.entries(w)) {
      if (val < 0) {
        throw new Error(`Component weight '${name}' must be >= 0, got ${val}`);
      }
    }
    const sum = Object.values(w).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `Component weights must sum to approximately 1.0, got ${sum}`,
      );
    }
  }

  if (config.minimumCovenants !== undefined && config.minimumCovenants < 1) {
    throw new Error(
      `minimumCovenants must be >= 1, got ${config.minimumCovenants}`,
    );
  }
}

/**
 * Validate ProtocolData fields are within acceptable ranges.
 */
export function validateProtocolData(data: ProtocolData): void {
  if (data.covenantCount < 0) {
    throw new Error(`covenantCount must be >= 0, got ${data.covenantCount}`);
  }
  if (data.totalInteractions < 0) {
    throw new Error(`totalInteractions must be >= 0, got ${data.totalInteractions}`);
  }
  if (data.compliantInteractions < 0) {
    throw new Error(`compliantInteractions must be >= 0, got ${data.compliantInteractions}`);
  }
  if (data.compliantInteractions > data.totalInteractions) {
    throw new Error(
      `compliantInteractions (${data.compliantInteractions}) must be <= totalInteractions (${data.totalInteractions})`,
    );
  }
  if (data.stakeAmount < 0) {
    throw new Error(`stakeAmount must be >= 0, got ${data.stakeAmount}`);
  }
  if (data.maxStake < 0) {
    throw new Error(`maxStake must be >= 0, got ${data.maxStake}`);
  }
  if (data.attestedInteractions < 0) {
    throw new Error(`attestedInteractions must be >= 0, got ${data.attestedInteractions}`);
  }
  if (data.canaryTests < 0) {
    throw new Error(`canaryTests must be >= 0, got ${data.canaryTests}`);
  }
  if (data.canaryPasses < 0) {
    throw new Error(`canaryPasses must be >= 0, got ${data.canaryPasses}`);
  }
  if (data.canaryPasses > data.canaryTests) {
    throw new Error(
      `canaryPasses (${data.canaryPasses}) must be <= canaryTests (${data.canaryTests})`,
    );
  }
}

/**
 * Validate InteractionPolicy fields are within acceptable ranges.
 */
export function validatePolicy(policy: InteractionPolicy): void {
  if (policy.minimumScore < 0 || policy.minimumScore > 1) {
    throw new Error(
      `minimumScore must be in [0, 1], got ${policy.minimumScore}`,
    );
  }
}

/**
 * Validate that an AccountabilityScore is within acceptable ranges.
 */
function validateScore(score: AccountabilityScore): void {
  if (score.score < 0 || score.score > 1) {
    throw new Error(
      `AccountabilityScore.score must be in [0, 1], got ${score.score}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tier logic
// ---------------------------------------------------------------------------

const TIER_ORDER: AccountabilityTier[] = [
  'unaccountable',
  'basic',
  'verified',
  'trusted',
  'exemplary',
];

/**
 * Return the minimum score required for a given accountability tier.
 */
export function tierToMinScore(
  tier: AccountabilityTier,
  config?: AccountabilityConfig,
): number {
  const { thresholds } = resolveConfig(config);
  switch (tier) {
    case 'exemplary':
      return thresholds.exemplary;
    case 'trusted':
      return thresholds.trusted;
    case 'verified':
      return thresholds.verified;
    case 'basic':
      return thresholds.basic;
    case 'unaccountable':
      return 0;
  }
}

/**
 * Determine the accountability tier for a given numeric score.
 */
function scoreToTier(
  score: number,
  thresholds: typeof DEFAULT_TIER_THRESHOLDS,
): AccountabilityTier {
  if (score >= thresholds.exemplary) return 'exemplary';
  if (score >= thresholds.trusted) return 'trusted';
  if (score >= thresholds.verified) return 'verified';
  if (score >= thresholds.basic) return 'basic';
  return 'unaccountable';
}

/**
 * Compare two accountability tiers.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareTiers(a: AccountabilityTier, b: AccountabilityTier): -1 | 0 | 1 {
  const ai = TIER_ORDER.indexOf(a);
  const bi = TIER_ORDER.indexOf(b);
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute the accountability score for an agent given their protocol data.
 *
 * The score is the weighted sum of five components:
 *  - covenantCompleteness: min(covenantCount / minimumCovenants, 1.0)
 *  - complianceHistory: compliantInteractions / max(totalInteractions, 1)
 *  - stakeRatio: stakeAmount / max(maxStake, 1)
 *  - attestationCoverage: attestedInteractions / max(totalInteractions, 1)
 *  - canaryPassRate: canaryPasses / max(canaryTests, 1)
 */
export function computeAccountability(
  agentId: string,
  data: ProtocolData,
  config?: AccountabilityConfig,
): AccountabilityScore {
  if (config) validateConfig(config);
  validateProtocolData(data);

  const { thresholds, weights, minimumCovenants } = resolveConfig(config);

  const covenantCompleteness = Math.min(data.covenantCount / minimumCovenants, 1.0);
  const complianceHistory = data.compliantInteractions / Math.max(data.totalInteractions, 1);
  const stakeRatio = data.stakeAmount / Math.max(data.maxStake, 1);
  const attestationCoverage = data.attestedInteractions / Math.max(data.totalInteractions, 1);
  const canaryPassRate = data.canaryPasses / Math.max(data.canaryTests, 1);

  const score =
    weights.covenantCompleteness * covenantCompleteness +
    weights.complianceHistory * complianceHistory +
    weights.stakeRatio * stakeRatio +
    weights.attestationCoverage * attestationCoverage +
    weights.canaryPassRate * canaryPassRate;

  const tier = scoreToTier(score, thresholds);

  return {
    agentId,
    score,
    components: {
      covenantCompleteness,
      complianceHistory,
      stakeRatio,
      attestationCoverage,
      canaryPassRate,
    },
    tier,
  };
}

/**
 * Evaluate whether a counterparty meets the requirements of an interaction policy.
 *
 * Checks:
 *  1. The counterparty's tier is at or above the policy's minimumTier.
 *  2. The counterparty's score is at or above the policy's minimumScore.
 *  3. If requireStake is true, the counterparty's stakeRatio must be > 0.
 *  4. If requireAttestation is true, the counterparty's attestationCoverage must be > 0.
 *
 * The riskAdjustment is based on how far below the policy threshold the counterparty falls.
 * For allowed counterparties: riskAdjustment = 1 - counterparty.score
 * For denied counterparties: riskAdjustment = 1 - counterparty.score + deficit below threshold
 */
export function evaluateCounterparty(
  policy: InteractionPolicy,
  counterparty: AccountabilityScore,
): AccessDecision {
  validatePolicy(policy);
  validateScore(counterparty);

  const baseRisk = 1 - counterparty.score;
  const deficit = Math.max(0, policy.minimumScore - counterparty.score);
  const riskAdjustment = Math.min(1, baseRisk + deficit);

  // Check tier requirement
  if (compareTiers(counterparty.tier, policy.minimumTier) < 0) {
    return {
      allowed: false,
      reason: `Counterparty tier '${counterparty.tier}' is below minimum tier '${policy.minimumTier}'`,
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check minimum score
  if (counterparty.score < policy.minimumScore) {
    return {
      allowed: false,
      reason: `Counterparty score ${counterparty.score} is below minimum score ${policy.minimumScore}`,
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check stake requirement
  if (policy.requireStake && counterparty.components.stakeRatio <= 0) {
    return {
      allowed: false,
      reason: 'Policy requires stake but counterparty has no stake',
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  // Check attestation requirement
  if (policy.requireAttestation && counterparty.components.attestationCoverage <= 0) {
    return {
      allowed: false,
      reason: 'Policy requires attestation but counterparty has no attestation coverage',
      counterpartyScore: counterparty,
      riskAdjustment,
    };
  }

  return {
    allowed: true,
    reason: 'Counterparty meets all policy requirements',
    counterpartyScore: counterparty,
    riskAdjustment,
  };
}

/**
 * Compute the average accountability score across a set of agents.
 * Returns 0 if the array is empty.
 */
export function networkAccountabilityRate(scores: AccountabilityScore[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  return total / scores.length;
}

// ---------------------------------------------------------------------------
// Byzantine Fault Tolerance
// ---------------------------------------------------------------------------

/**
 * Result of Byzantine Fault Tolerance analysis.
 */
export interface BFTResult {
  /** Total number of nodes in the network */
  totalNodes: number;
  /** Maximum number of faulty (Byzantine) nodes that can be tolerated */
  maxFaultyNodes: number;
  /** Whether the current network size can tolerate the given number of faults */
  canTolerate: boolean;
  /** The minimum number of nodes needed to tolerate the requested fault count */
  minNodesRequired: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute Byzantine Fault Tolerance properties for a network.
 *
 * The classic BFT result (Lamport, Shostak, Pease 1982) states that
 * Byzantine consensus requires:
 *
 *   n >= 3f + 1
 *
 * where n = total nodes, f = max faulty nodes.
 *
 * Equivalently, the maximum tolerable faults for n nodes is:
 *
 *   f_max = floor((n - 1) / 3)
 *
 * @param totalNodes Total number of nodes in the network (must be >= 1)
 * @param requestedFaults Optional: check if the network can tolerate this many faults
 */
export function byzantineFaultTolerance(
  totalNodes: number,
  requestedFaults?: number,
): BFTResult {
  if (!Number.isInteger(totalNodes) || totalNodes < 1) {
    throw new Error(`totalNodes must be a positive integer, got ${totalNodes}`);
  }
  if (requestedFaults !== undefined) {
    if (!Number.isInteger(requestedFaults) || requestedFaults < 0) {
      throw new Error(`requestedFaults must be a non-negative integer, got ${requestedFaults}`);
    }
  }

  // f_max = floor((n - 1) / 3)
  const maxFaultyNodes = Math.floor((totalNodes - 1) / 3);

  const faults = requestedFaults ?? maxFaultyNodes;
  const minNodesRequired = 3 * faults + 1;
  const canTolerate = totalNodes >= minNodesRequired;

  const formula =
    `BFT constraint: n >= 3f + 1\n` +
    `Total nodes (n): ${totalNodes}\n` +
    `Max tolerable faults: f_max = floor((${totalNodes} - 1) / 3) = ${maxFaultyNodes}\n` +
    (requestedFaults !== undefined
      ? `Requested fault tolerance: f = ${requestedFaults}, requires n >= ${minNodesRequired}\n` +
        `Network ${canTolerate ? 'CAN' : 'CANNOT'} tolerate ${requestedFaults} faults`
      : `Network can tolerate up to ${maxFaultyNodes} Byzantine faults`);

  return {
    totalNodes,
    maxFaultyNodes,
    canTolerate,
    minNodesRequired,
    formula,
  };
}

// ---------------------------------------------------------------------------
// Quorum Size
// ---------------------------------------------------------------------------

/**
 * Supported consensus protocol types for quorum computation.
 */
export type ConsensusProtocol = 'simple_majority' | 'bft' | 'two_thirds' | 'unanimous';

/**
 * Result of quorum size computation.
 */
export interface QuorumResult {
  /** The protocol used for computation */
  protocol: ConsensusProtocol;
  /** Total number of nodes */
  totalNodes: number;
  /** The minimum quorum size required */
  quorumSize: number;
  /** Quorum as a fraction of totalNodes */
  quorumFraction: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Compute the minimum quorum size for various consensus protocols.
 *
 * Protocols:
 *
 * - simple_majority: quorum = floor(n/2) + 1
 *   Standard majority voting. Requires > 50% agreement.
 *
 * - bft: quorum = floor(2n/3) + 1
 *   Byzantine fault tolerant quorum. Requires > 2/3 agreement to ensure
 *   any two quorums overlap in at least one honest node when f < n/3.
 *
 * - two_thirds: quorum = ceil(2n/3)
 *   Requires at least 2/3 of nodes, used in many PoS protocols.
 *
 * - unanimous: quorum = n
 *   All nodes must agree.
 *
 * @param totalNodes Total number of nodes in the network (must be >= 1)
 * @param protocol The consensus protocol type
 */
export function quorumSize(
  totalNodes: number,
  protocol: ConsensusProtocol,
): QuorumResult {
  if (!Number.isInteger(totalNodes) || totalNodes < 1) {
    throw new Error(`totalNodes must be a positive integer, got ${totalNodes}`);
  }

  let q: number;
  let formulaDetail: string;

  switch (protocol) {
    case 'simple_majority':
      // quorum = floor(n/2) + 1
      q = Math.floor(totalNodes / 2) + 1;
      formulaDetail = `Simple majority: quorum = floor(${totalNodes}/2) + 1 = ${q}`;
      break;
    case 'bft':
      // quorum = floor(2n/3) + 1 (ensures overlap > f for f < n/3)
      q = Math.floor((2 * totalNodes) / 3) + 1;
      formulaDetail = `BFT quorum: quorum = floor(2*${totalNodes}/3) + 1 = ${q}`;
      break;
    case 'two_thirds':
      // quorum = ceil(2n/3)
      q = Math.ceil((2 * totalNodes) / 3);
      formulaDetail = `Two-thirds quorum: quorum = ceil(2*${totalNodes}/3) = ${q}`;
      break;
    case 'unanimous':
      q = totalNodes;
      formulaDetail = `Unanimous: quorum = ${totalNodes} (all nodes required)`;
      break;
    default:
      throw new Error(`Unknown protocol: ${protocol}`);
  }

  // Ensure quorum does not exceed total nodes
  q = Math.min(q, totalNodes);

  const quorumFraction = totalNodes > 0 ? q / totalNodes : 1;

  const formula =
    `${formulaDetail}\n` +
    `Quorum fraction: ${q}/${totalNodes} = ${quorumFraction.toFixed(4)}`;

  return {
    protocol,
    totalNodes,
    quorumSize: q,
    quorumFraction,
    formula,
  };
}

// ---------------------------------------------------------------------------
// Consensus Latency
// ---------------------------------------------------------------------------

/**
 * Parameters for consensus latency estimation.
 */
export interface ConsensusLatencyParams {
  /** Number of nodes in the network */
  nodeCount: number;
  /** Average network round-trip time in milliseconds */
  averageLatencyMs: number;
  /** Number of communication rounds required by the protocol */
  messageRounds: number;
  /** Optional: message loss probability in [0, 1). Adds retry overhead. */
  messageLossProbability?: number;
  /** Optional: processing time per node per round in milliseconds */
  processingTimeMs?: number;
}

/**
 * Result of consensus latency estimation.
 */
export interface ConsensusLatencyResult {
  /** Estimated time to reach consensus in milliseconds */
  estimatedLatencyMs: number;
  /** Network communication component in milliseconds */
  networkLatencyMs: number;
  /** Processing component in milliseconds */
  processingLatencyMs: number;
  /** Retry overhead due to message loss in milliseconds */
  retryOverheadMs: number;
  /** Human-readable derivation */
  formula: string;
}

/**
 * Estimate the time to reach consensus given network parameters.
 *
 * The model computes:
 *
 *   networkLatency = messageRounds * averageLatencyMs
 *   processingLatency = messageRounds * processingTimeMs
 *   retryOverhead = networkLatency * (messageLossProbability / (1 - messageLossProbability))
 *
 * The retry overhead models the geometric distribution of retries:
 * if each message has probability p of being lost, the expected number
 * of transmissions per message is 1/(1-p), adding overhead factor p/(1-p).
 *
 * Total estimated latency:
 *   estimatedLatency = networkLatency + processingLatency + retryOverhead
 *
 * This is a simplified model; real-world consensus latency depends on
 * many additional factors (network topology, leader election, etc.).
 *
 * @param params Network and protocol parameters
 */
export function consensusLatency(params: ConsensusLatencyParams): ConsensusLatencyResult {
  const {
    nodeCount,
    averageLatencyMs,
    messageRounds,
    messageLossProbability = 0,
    processingTimeMs = 0,
  } = params;

  if (!Number.isInteger(nodeCount) || nodeCount < 1) {
    throw new Error(`nodeCount must be a positive integer, got ${nodeCount}`);
  }
  if (averageLatencyMs < 0) {
    throw new Error(`averageLatencyMs must be >= 0, got ${averageLatencyMs}`);
  }
  if (!Number.isInteger(messageRounds) || messageRounds < 1) {
    throw new Error(`messageRounds must be a positive integer, got ${messageRounds}`);
  }
  if (messageLossProbability < 0 || messageLossProbability >= 1) {
    throw new Error(
      `messageLossProbability must be in [0, 1), got ${messageLossProbability}`,
    );
  }
  if (processingTimeMs < 0) {
    throw new Error(`processingTimeMs must be >= 0, got ${processingTimeMs}`);
  }

  // Network latency: each round requires one RTT
  const networkLatencyMs = messageRounds * averageLatencyMs;

  // Processing latency: each round has processing overhead
  const processingLatencyMs = messageRounds * processingTimeMs;

  // Retry overhead: geometric distribution of retries due to message loss
  // Expected transmissions = 1/(1-p), so overhead factor = p/(1-p)
  const retryOverheadMs = messageLossProbability > 0
    ? networkLatencyMs * (messageLossProbability / (1 - messageLossProbability))
    : 0;

  const estimatedLatencyMs = networkLatencyMs + processingLatencyMs + retryOverheadMs;

  const formula =
    `Network latency: ${messageRounds} rounds * ${averageLatencyMs}ms = ${networkLatencyMs}ms\n` +
    `Processing latency: ${messageRounds} rounds * ${processingTimeMs}ms = ${processingLatencyMs}ms\n` +
    `Retry overhead (p=${messageLossProbability}): ${retryOverheadMs.toFixed(2)}ms\n` +
    `Total estimated consensus latency: ${estimatedLatencyMs.toFixed(2)}ms`;

  return {
    estimatedLatencyMs,
    networkLatencyMs,
    processingLatencyMs,
    retryOverheadMs,
    formula,
  };
}
