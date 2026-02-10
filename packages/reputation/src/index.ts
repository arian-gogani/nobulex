import {
  sha256String,
  sha256Object,
  signString,
  verify,
  toHex,
  fromHex,
  timestamp,
} from '@stele/crypto';
import type { KeyPair, HashHex } from '@stele/crypto';
import type { Severity } from '@stele/ccl';

export type {
  ExecutionReceipt,
  ReputationScore,
  ReputationStake,
  ReputationDelegation,
  Endorsement,
  ScoringConfig,
} from './types.js';

import type {
  ExecutionReceipt,
  ReputationScore,
  ReputationStake,
  ReputationDelegation,
  Endorsement,
  ScoringConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Default scoring configuration
// ---------------------------------------------------------------------------

/**
 * Default configuration for the reputation scoring algorithm.
 *
 * - recencyDecay: exponential decay base per recencyPeriod (0.95)
 * - recencyPeriod: decay period in seconds (86400 = 1 day)
 * - breachPenalty: per-severity penalty subtracted from outcome score
 * - minimumExecutions: below this threshold the score is scaled down
 * - endorsementWeight: blending factor for endorsement contribution
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  recencyDecay: 0.95,
  recencyPeriod: 86400,
  breachPenalty: {
    critical: 0.5,
    high: 0.3,
    medium: 0.15,
    low: 0.05,
  },
  minimumExecutions: 10,
  endorsementWeight: 0.15,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the hashable content object for a receipt.
 * Includes every field except id, agentSignature, principalSignature,
 * and receiptHash (the four derived/mutable fields).
 *
 * The object is fed into sha256Object which canonicalises key order
 * internally, so insertion order here does not affect the hash.
 */
function buildReceiptContent(params: {
  covenantId: HashHex;
  agentIdentityHash: HashHex;
  principalPublicKey: string;
  outcome: ExecutionReceipt['outcome'];
  breachSeverity?: Severity;
  proofHash: HashHex;
  durationMs: number;
  completedAt: string;
  previousReceiptHash: HashHex | null;
}): Record<string, unknown> {
  const content: Record<string, unknown> = {
    covenantId: params.covenantId,
    agentIdentityHash: params.agentIdentityHash,
    principalPublicKey: params.principalPublicKey,
    outcome: params.outcome,
    proofHash: params.proofHash,
    durationMs: params.durationMs,
    completedAt: params.completedAt,
    previousReceiptHash: params.previousReceiptHash,
  };
  if (params.breachSeverity !== undefined) {
    content.breachSeverity = params.breachSeverity;
  }
  return content;
}

/**
 * Build the hashable content object for a stake.
 * Excludes id and signature.
 */
function buildStakeContent(params: {
  agentIdentityHash: HashHex;
  covenantId: HashHex;
  amount: number;
  status: ReputationStake['status'];
  stakedAt: string;
}): Record<string, unknown> {
  return {
    agentIdentityHash: params.agentIdentityHash,
    covenantId: params.covenantId,
    amount: params.amount,
    status: params.status,
    stakedAt: params.stakedAt,
  };
}

/**
 * Build the hashable content object for a delegation.
 * Excludes id, sponsorSignature, and protégéSignature.
 */
function buildDelegationContent(params: {
  sponsorIdentityHash: HashHex;
  protégéIdentityHash: HashHex;
  riskAmount: number;
  scopes: string[];
  expiresAt: string;
  status: ReputationDelegation['status'];
}): Record<string, unknown> {
  return {
    sponsorIdentityHash: params.sponsorIdentityHash,
    protégéIdentityHash: params.protégéIdentityHash,
    riskAmount: params.riskAmount,
    scopes: params.scopes,
    expiresAt: params.expiresAt,
    status: params.status,
  };
}

/**
 * Build the hashable content object for an endorsement.
 * Excludes id and signature.
 */
function buildEndorsementContent(params: {
  endorserIdentityHash: HashHex;
  endorsedIdentityHash: HashHex;
  basis: Endorsement['basis'];
  scopes: string[];
  weight: number;
  issuedAt: string;
}): Record<string, unknown> {
  return {
    endorserIdentityHash: params.endorserIdentityHash,
    endorsedIdentityHash: params.endorsedIdentityHash,
    basis: params.basis,
    scopes: params.scopes,
    weight: params.weight,
    issuedAt: params.issuedAt,
  };
}

// ---------------------------------------------------------------------------
// Execution Receipts
// ---------------------------------------------------------------------------

/**
 * Create a new execution receipt, signed by the agent.
 *
 * The receiptHash is computed as sha256Object of all content fields
 * (excluding id, agentSignature, principalSignature, and receiptHash
 * itself). The id is set equal to the receiptHash. The agent signs
 * the receiptHash string with their private key.
 *
 * @param covenantId          - ID of the covenant that was executed.
 * @param agentIdentityHash   - Identity hash of the executing agent.
 * @param principalPublicKey  - Hex-encoded public key of the principal.
 * @param outcome             - Execution outcome.
 * @param proofHash           - Hash of the compliance proof.
 * @param durationMs          - Execution duration in milliseconds.
 * @param agentKeyPair        - Agent's key pair used to sign the receipt.
 * @param previousReceiptHash - Hash of the previous receipt in the chain (null for first).
 * @param breachSeverity      - Severity of breach (required when outcome is 'breached').
 * @returns A complete, signed ExecutionReceipt.
 */
export async function createReceipt(
  covenantId: HashHex,
  agentIdentityHash: HashHex,
  principalPublicKey: string,
  outcome: ExecutionReceipt['outcome'],
  proofHash: HashHex,
  durationMs: number,
  agentKeyPair: KeyPair,
  previousReceiptHash: HashHex | null = null,
  breachSeverity?: Severity,
): Promise<ExecutionReceipt> {
  const completedAt = timestamp();

  const content = buildReceiptContent({
    covenantId,
    agentIdentityHash,
    principalPublicKey,
    outcome,
    breachSeverity,
    proofHash,
    durationMs,
    completedAt,
    previousReceiptHash,
  });

  const receiptHash = sha256Object(content);
  const id = receiptHash;

  const signatureBytes = await signString(receiptHash, agentKeyPair.privateKey);
  const agentSignature = toHex(signatureBytes);

  const receipt: ExecutionReceipt = {
    id,
    covenantId,
    agentIdentityHash,
    principalPublicKey,
    outcome,
    ...(breachSeverity !== undefined ? { breachSeverity } : {}),
    proofHash,
    durationMs,
    completedAt,
    agentSignature,
    previousReceiptHash,
    receiptHash,
  };

  return receipt;
}

/**
 * Verify a receipt's integrity and agent signature.
 *
 * Performs two checks:
 *  1. The receiptHash matches the SHA-256 of the receipt's content fields.
 *  2. The agentSignature is a valid Ed25519 signature over the
 *     receiptHash, verified against the agentIdentityHash as the
 *     public key.
 *
 * Note: if agentIdentityHash is a composite identity hash (rather
 * than a raw public key hex), signature verification will return false.
 * In that case, callers should resolve the agent's actual public key
 * and perform signature verification separately.
 */
export async function verifyReceipt(receipt: ExecutionReceipt): Promise<boolean> {
  // 1. Verify receiptHash matches content
  const content = buildReceiptContent({
    covenantId: receipt.covenantId,
    agentIdentityHash: receipt.agentIdentityHash,
    principalPublicKey: receipt.principalPublicKey,
    outcome: receipt.outcome,
    breachSeverity: receipt.breachSeverity,
    proofHash: receipt.proofHash,
    durationMs: receipt.durationMs,
    completedAt: receipt.completedAt,
    previousReceiptHash: receipt.previousReceiptHash,
  });

  const expectedHash = sha256Object(content);
  if (expectedHash !== receipt.receiptHash) {
    return false;
  }

  // 2. Verify agent signature over the receiptHash
  try {
    const messageBytes = new TextEncoder().encode(receipt.receiptHash);
    const sigBytes = fromHex(receipt.agentSignature);
    const pubKeyBytes = fromHex(receipt.agentIdentityHash);
    return await verify(messageBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Countersign a receipt with the principal's key pair.
 *
 * The principal signs the receiptHash string, producing a signature
 * that can be verified against principalPublicKey. Returns a new
 * receipt object with the principalSignature field set; the original
 * receipt is not mutated.
 */
export async function countersignReceipt(
  receipt: ExecutionReceipt,
  principalKeyPair: KeyPair,
): Promise<ExecutionReceipt> {
  const signatureBytes = await signString(receipt.receiptHash, principalKeyPair.privateKey);
  return {
    ...receipt,
    principalSignature: toHex(signatureBytes),
  };
}

// ---------------------------------------------------------------------------
// Receipt Chain Verification
// ---------------------------------------------------------------------------

/**
 * Verify that an ordered array of receipts forms a valid hash chain.
 *
 * Rules:
 * - The first receipt must have previousReceiptHash === null.
 * - Each subsequent receipt's previousReceiptHash must equal the
 *   preceding receipt's receiptHash.
 *
 * An empty array is considered a valid (trivial) chain.
 */
export function verifyReceiptChain(receipts: ExecutionReceipt[]): boolean {
  if (receipts.length === 0) {
    return true;
  }

  // First receipt must anchor the chain with a null previous hash
  if (receipts[0]!.previousReceiptHash !== null) {
    return false;
  }

  for (let i = 1; i < receipts.length; i++) {
    if (receipts[i]!.previousReceiptHash !== receipts[i - 1]!.receiptHash) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Merkle Root
// ---------------------------------------------------------------------------

/**
 * Compute a Merkle root from an array of execution receipts.
 *
 * Leaf nodes are the receiptHash values. Pairs of hashes are
 * concatenated (left + right) and fed through SHA-256 to produce
 * parent nodes. If a level has an odd number of nodes the last
 * node is duplicated before pairing.
 *
 * An empty array produces sha256String('') as the root.
 */
export function computeReceiptsMerkleRoot(receipts: ExecutionReceipt[]): HashHex {
  if (receipts.length === 0) {
    return sha256String('');
  }

  let level: HashHex[] = receipts.map((r) => r.receiptHash);

  while (level.length > 1) {
    const nextLevel: HashHex[] = [];

    // Duplicate last node if odd count
    if (level.length % 2 !== 0) {
      level.push(level[level.length - 1]!);
    }

    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(sha256String(level[i]! + level[i + 1]!));
    }

    level = nextLevel;
  }

  return level[0]!;
}

// ---------------------------------------------------------------------------
// Reputation Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a comprehensive reputation score for an agent based on
 * their execution receipts and optional endorsements.
 *
 * Algorithm:
 *  1. Count outcomes (fulfilled, partial, failed, breached).
 *  2. For each receipt, compute a recency weight using exponential
 *     decay: weight = recencyDecay ^ (ageSeconds / recencyPeriod).
 *  3. Assign an outcome score to each receipt:
 *       fulfilled = 1.0, partial = 0.5, failed = 0.0,
 *       breached = -(breachPenalty[severity]).
 *  4. Compute the weighted average: sum(weight * score) / sum(weight).
 *  5. If totalExecutions < minimumExecutions, scale the score down
 *     by (totalExecutions / minimumExecutions).
 *  6. If endorsements are provided, blend the score:
 *       final = score * (1 - endorsementWeight) +
 *               endorsementWeight * avgEndorsementWeight.
 *  7. Clamp the result to [0.0, 1.0].
 *
 * The successRate is computed as (fulfilled + partial) / totalExecutions.
 * currentStake and totalBurned are initialised to 0; callers should
 * update these from stake data if available.
 */
export function computeReputationScore(
  agentIdentityHash: HashHex,
  receipts: ExecutionReceipt[],
  endorsements?: Endorsement[],
  config?: ScoringConfig,
): ReputationScore {
  const cfg = config ?? DEFAULT_SCORING_CONFIG;
  const now = Date.now();

  // --- Count outcomes ---
  let fulfilled = 0;
  let partial = 0;
  let failed = 0;
  let breached = 0;

  for (const r of receipts) {
    switch (r.outcome) {
      case 'fulfilled':
        fulfilled++;
        break;
      case 'partial':
        partial++;
        break;
      case 'failed':
        failed++;
        break;
      case 'breached':
        breached++;
        break;
    }
  }

  const totalExecutions = receipts.length;

  // --- Compute weighted score with recency decay ---
  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of receipts) {
    const completedMs = new Date(r.completedAt).getTime();
    const ageSeconds = Math.max(0, (now - completedMs) / 1000);
    const recencyWeight = Math.pow(cfg.recencyDecay, ageSeconds / cfg.recencyPeriod);

    let outcomeScore: number;
    switch (r.outcome) {
      case 'fulfilled':
        outcomeScore = 1.0;
        break;
      case 'partial':
        outcomeScore = 0.5;
        break;
      case 'failed':
        outcomeScore = 0.0;
        break;
      case 'breached': {
        const severity: Severity = r.breachSeverity ?? 'medium';
        outcomeScore = -(cfg.breachPenalty[severity] ?? 0.15);
        break;
      }
    }

    weightedSum += recencyWeight * outcomeScore;
    totalWeight += recencyWeight;
  }

  let weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // --- Apply minimum executions penalty ---
  if (totalExecutions > 0 && totalExecutions < cfg.minimumExecutions) {
    weightedScore *= totalExecutions / cfg.minimumExecutions;
  }

  // --- Factor in endorsements ---
  if (endorsements && endorsements.length > 0) {
    const avgEndorsementWeight =
      endorsements.reduce((sum, e) => sum + e.weight, 0) / endorsements.length;
    weightedScore =
      weightedScore * (1 - cfg.endorsementWeight) +
      cfg.endorsementWeight * avgEndorsementWeight;
  }

  // --- Clamp to [0, 1] ---
  weightedScore = Math.max(0, Math.min(1, weightedScore));

  // --- Compute Merkle root ---
  const receiptsMerkleRoot = computeReceiptsMerkleRoot(receipts);

  // --- Success rate ---
  const successRate = totalExecutions > 0
    ? (fulfilled + partial) / totalExecutions
    : 0;

  return {
    agentIdentityHash,
    totalExecutions,
    fulfilled,
    partial,
    failed,
    breached,
    successRate,
    weightedScore,
    receiptsMerkleRoot,
    lastUpdatedAt: new Date(now).toISOString(),
    currentStake: 0,
    totalBurned: 0,
  };
}

// ---------------------------------------------------------------------------
// Reputation Stakes
// ---------------------------------------------------------------------------

/**
 * Create a new reputation stake, signed by the agent.
 *
 * A stake represents reputation collateral that the agent puts at
 * risk when executing a covenant. If the agent breaches, the stake
 * may be burned.
 */
export async function createStake(
  agentIdentityHash: HashHex,
  covenantId: HashHex,
  amount: number,
  agentKeyPair: KeyPair,
): Promise<ReputationStake> {
  if (amount < 0 || amount > 1) {
    throw new Error('Stake amount must be between 0 and 1');
  }

  const stakedAt = timestamp();

  const content = buildStakeContent({
    agentIdentityHash,
    covenantId,
    amount,
    status: 'active',
    stakedAt,
  });

  const id = sha256Object(content);
  const signatureBytes = await signString(id, agentKeyPair.privateKey);

  return {
    id,
    agentIdentityHash,
    covenantId,
    amount,
    status: 'active',
    stakedAt,
    signature: toHex(signatureBytes),
  };
}

/**
 * Release a stake after covenant execution completes.
 *
 * Returns a new stake object with status='released' and resolvedAt
 * set to the current timestamp. The original stake is not mutated.
 *
 * @param stake   - The active stake to release.
 * @param outcome - The execution outcome (informational).
 */
export function releaseStake(
  stake: ReputationStake,
  _outcome: ExecutionReceipt['outcome'],
): ReputationStake {
  return {
    ...stake,
    status: 'released',
    resolvedAt: timestamp(),
  };
}

/**
 * Burn a stake due to a covenant breach.
 *
 * Returns a new stake object with status='burned' and resolvedAt
 * set to the current timestamp. The original stake is not mutated.
 */
export function burnStake(stake: ReputationStake): ReputationStake {
  return {
    ...stake,
    status: 'burned',
    resolvedAt: timestamp(),
  };
}

// ---------------------------------------------------------------------------
// Reputation Delegation
// ---------------------------------------------------------------------------

/**
 * Create a reputation delegation from a sponsor to a protege.
 *
 * A delegation allows a sponsor to vouch for a protege by putting
 * their own reputation at risk. Both parties must sign the delegation.
 * The id is computed as sha256Object of the content fields, and both
 * the sponsor and protege sign this id.
 *
 * @param sponsorIdentityHash - Identity hash of the sponsoring agent.
 * @param protégéIdentityHash - Identity hash of the protege agent.
 * @param riskAmount          - Amount of reputation at risk.
 * @param scopes              - Scopes the delegation covers.
 * @param expiresAt           - ISO 8601 expiration timestamp.
 * @param sponsorKeyPair      - Sponsor's key pair for signing.
 * @param protégéKeyPair      - Protege's key pair for countersigning.
 */
export async function createDelegation(
  sponsorIdentityHash: HashHex,
  protégéIdentityHash: HashHex,
  riskAmount: number,
  scopes: string[],
  expiresAt: string,
  sponsorKeyPair: KeyPair,
  protégéKeyPair: KeyPair,
): Promise<ReputationDelegation> {
  if (riskAmount < 0 || riskAmount > 1) {
    throw new Error('Delegation riskAmount must be between 0 and 1');
  }
  if (scopes.length === 0) {
    throw new Error('Delegation must have at least one scope');
  }

  const content = buildDelegationContent({
    sponsorIdentityHash,
    protégéIdentityHash,
    riskAmount,
    scopes,
    expiresAt,
    status: 'active',
  });

  const id = sha256Object(content);

  const sponsorSigBytes = await signString(id, sponsorKeyPair.privateKey);
  const protégéSigBytes = await signString(id, protégéKeyPair.privateKey);

  return {
    id,
    sponsorIdentityHash,
    protégéIdentityHash,
    riskAmount,
    scopes,
    expiresAt,
    status: 'active',
    sponsorSignature: toHex(sponsorSigBytes),
    protégéSignature: toHex(protégéSigBytes),
  };
}

/**
 * Burn a delegation due to a breach by the protege.
 *
 * Returns a new delegation with status='burned'. The original
 * delegation is not mutated.
 */
export function burnDelegation(delegation: ReputationDelegation): ReputationDelegation {
  return {
    ...delegation,
    status: 'burned',
  };
}

/**
 * Co-burn a delegation and compute the reputation impact on both parties.
 * When a protege breaches, both the delegation is burned AND the sponsor
 * loses reputation proportional to riskAmount.
 *
 * Returns the burned delegation plus reputation impact details.
 */
export function coBurnDelegation(
  delegation: ReputationDelegation,
  sponsorScore: ReputationScore,
): {
  burnedDelegation: ReputationDelegation;
  sponsorReputationLoss: number;
  newSponsorBurned: number;
} {
  const burnedDelegation: ReputationDelegation = {
    ...delegation,
    status: 'burned',
  };

  // Sponsor loses reputation proportional to risk amount
  const sponsorReputationLoss = delegation.riskAmount * sponsorScore.weightedScore;
  const newSponsorBurned = sponsorScore.totalBurned + sponsorReputationLoss;

  return {
    burnedDelegation,
    sponsorReputationLoss,
    newSponsorBurned,
  };
}

// ---------------------------------------------------------------------------
// Endorsements
// ---------------------------------------------------------------------------

/**
 * Create a new endorsement, signed by the endorser.
 *
 * An endorsement is a peer attestation about another agent's
 * track record. The endorser signs the id (hash of content fields)
 * with their private key.
 *
 * @param endorserIdentityHash - Identity hash of the endorsing agent.
 * @param endorsedIdentityHash - Identity hash of the endorsed agent.
 * @param basis                - Empirical basis for the endorsement.
 * @param scopes               - Scopes the endorsement covers.
 * @param weight               - Endorsement weight (0.0 to 1.0).
 * @param endorserKeyPair      - Endorser's key pair for signing.
 */
export async function createEndorsement(
  endorserIdentityHash: HashHex,
  endorsedIdentityHash: HashHex,
  basis: Endorsement['basis'],
  scopes: string[],
  weight: number,
  endorserKeyPair: KeyPair,
): Promise<Endorsement> {
  const issuedAt = timestamp();

  // Validate basis
  if (typeof basis.covenantsCompleted !== 'number' || basis.covenantsCompleted < 0) {
    throw new Error('Endorsement basis.covenantsCompleted must be a non-negative number');
  }
  if (typeof basis.breachRate !== 'number' || basis.breachRate < 0 || basis.breachRate > 1) {
    throw new Error('Endorsement basis.breachRate must be a number between 0 and 1');
  }
  if (basis.averageOutcomeScore !== undefined) {
    if (typeof basis.averageOutcomeScore !== 'number' || basis.averageOutcomeScore < 0 || basis.averageOutcomeScore > 1) {
      throw new Error('Endorsement basis.averageOutcomeScore must be a number between 0 and 1');
    }
  }

  // Validate weight
  if (weight < 0 || weight > 1) {
    throw new Error('Endorsement weight must be between 0 and 1');
  }

  const content = buildEndorsementContent({
    endorserIdentityHash,
    endorsedIdentityHash,
    basis,
    scopes,
    weight,
    issuedAt,
  });

  const id = sha256Object(content);
  const signatureBytes = await signString(id, endorserKeyPair.privateKey);

  return {
    id,
    endorserIdentityHash,
    endorsedIdentityHash,
    basis,
    scopes,
    weight,
    issuedAt,
    signature: toHex(signatureBytes),
  };
}

/**
 * Verify an endorsement's integrity and signature.
 *
 * Performs two checks:
 *  1. The id matches the SHA-256 of the endorsement's content fields.
 *  2. The signature is a valid Ed25519 signature over the id,
 *     verified against endorserIdentityHash as the public key.
 *
 * Note: if endorserIdentityHash is a composite identity hash (rather
 * than a raw public key hex), signature verification will return false.
 */
export async function verifyEndorsement(endorsement: Endorsement): Promise<boolean> {
  // 1. Recompute the expected id from content
  const content = buildEndorsementContent({
    endorserIdentityHash: endorsement.endorserIdentityHash,
    endorsedIdentityHash: endorsement.endorsedIdentityHash,
    basis: endorsement.basis,
    scopes: endorsement.scopes,
    weight: endorsement.weight,
    issuedAt: endorsement.issuedAt,
  });

  const expectedId = sha256Object(content);
  if (expectedId !== endorsement.id) {
    return false;
  }

  // 2. Verify signature over the id
  try {
    const messageBytes = new TextEncoder().encode(endorsement.id);
    const sigBytes = fromHex(endorsement.signature);
    const pubKeyBytes = fromHex(endorsement.endorserIdentityHash);
    return await verify(messageBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}
