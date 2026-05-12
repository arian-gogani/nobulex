/**
 * Trust Capital — machine reputation for AI agents.
 *
 * Trust Capital is calculated from a chain of bilateral cryptographic
 * receipts. Each receipt binds what was authorized (pre-execution) to
 * what actually happened (post-execution). The compliance ratio across
 * the chain determines the agent's Trust Capital score, which gates
 * what the agent is allowed to do.
 *
 * Higher Trust Capital = more autonomy, larger transaction limits,
 * lower insurance premiums, enterprise approval.
 *
 * @module trust-capital
 */

export interface TrustCapitalScore {
  /** Numeric score from 0 to 1000 */
  score: number;
  /** Number of receipts in the evaluated chain */
  receiptsEvaluated: number;
  /** Number of receipts where action matched authorization */
  receiptsCompliant: number;
  /** Compliance ratio (0 to 1) */
  complianceRate: number;
  /** Trust tier derived from score */
  tier: TrustTier;
  /** Capabilities unlocked at this tier */
  capabilities: TrustCapability[];
  /** Timestamp of evaluation */
  evaluatedAt: string;
}

export type TrustTier =
  | 'restricted'   // 0-199: new agent, minimal permissions
  | 'limited'      // 200-399: some history, basic operations
  | 'standard'     // 400-599: reliable track record
  | 'trusted'      // 600-799: proven agent, elevated access
  | 'autonomous';  // 800-1000: extensive verified history

export type TrustCapability =
  | 'read_data'
  | 'write_data'
  | 'send_messages'
  | 'approve_transactions'
  | 'access_sensitive_data'
  | 'operate_unsupervised'
  | 'delegate_to_agents'
  | 'sign_on_behalf';

const TIER_THRESHOLDS: Record<TrustTier, { min: number; max: number }> = {
  restricted:  { min: 0,   max: 199 },
  limited:     { min: 200, max: 399 },
  standard:    { min: 400, max: 599 },
  trusted:     { min: 600, max: 799 },
  autonomous:  { min: 800, max: 1000 },
};

const TIER_CAPABILITIES: Record<TrustTier, TrustCapability[]> = {
  restricted:  ['read_data'],
  limited:     ['read_data', 'write_data', 'send_messages'],
  standard:    ['read_data', 'write_data', 'send_messages', 'approve_transactions'],
  trusted:     ['read_data', 'write_data', 'send_messages', 'approve_transactions', 'access_sensitive_data', 'delegate_to_agents'],
  autonomous:  ['read_data', 'write_data', 'send_messages', 'approve_transactions', 'access_sensitive_data', 'operate_unsupervised', 'delegate_to_agents', 'sign_on_behalf'],
};

/**
 * Minimum receipts required for each tier upgrade.
 * An agent can't reach 'trusted' with only 10 receipts,
 * even if all 10 are compliant.
 */
const MIN_RECEIPTS_FOR_TIER: Record<TrustTier, number> = {
  restricted:  0,
  limited:     50,
  standard:    500,
  trusted:     2000,
  autonomous:  10000,
};

interface ReceiptSummary {
  total: number;
  compliant: number;
}

function deriveTier(score: number, receiptCount: number): TrustTier {
  const tiers: TrustTier[] = ['autonomous', 'trusted', 'standard', 'limited', 'restricted'];
  for (const tier of tiers) {
    if (score >= TIER_THRESHOLDS[tier].min && receiptCount >= MIN_RECEIPTS_FOR_TIER[tier]) {
      return tier;
    }
  }
  return 'restricted';
}

/**
 * Calculate Trust Capital from a receipt chain summary.
 *
 * The score is a weighted combination of:
 * - Compliance rate (70% weight): what fraction of actions matched authorization
 * - History depth (30% weight): longer verified history = higher score
 *
 * Both factors matter. A perfect compliance rate with 5 receipts
 * scores lower than 95% compliance with 5,000 receipts.
 */
export function calculateTrustCapital(summary: ReceiptSummary): TrustCapitalScore {
  const { total, compliant } = summary;

  if (total === 0) {
    return {
      score: 0,
      receiptsEvaluated: 0,
      receiptsCompliant: 0,
      complianceRate: 0,
      tier: 'restricted',
      capabilities: TIER_CAPABILITIES.restricted,
      evaluatedAt: new Date().toISOString(),
    };
  }

  const complianceRate = compliant / total;

  // History depth: logarithmic scale, caps at 10,000 receipts
  const depthFactor = Math.min(Math.log10(total + 1) / 4, 1);

  // Weighted score: 70% compliance, 30% depth
  const rawScore = (complianceRate * 0.7 + depthFactor * 0.3) * 1000;
  const score = Math.round(Math.min(Math.max(rawScore, 0), 1000));

  const tier = deriveTier(score, total);

  return {
    score,
    receiptsEvaluated: total,
    receiptsCompliant: compliant,
    complianceRate: Math.round(complianceRate * 10000) / 10000,
    tier,
    capabilities: TIER_CAPABILITIES[tier],
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Check whether an agent's Trust Capital permits a specific capability.
 */
export function hasCapability(
  trustCapital: TrustCapitalScore,
  capability: TrustCapability
): boolean {
  return trustCapital.capabilities.includes(capability);
}

/**
 * Get the minimum Trust Capital score required for a capability.
 */
export function minimumScoreFor(capability: TrustCapability): number {
  for (const tier of ['restricted', 'limited', 'standard', 'trusted', 'autonomous'] as TrustTier[]) {
    if (TIER_CAPABILITIES[tier].includes(capability)) {
      return TIER_THRESHOLDS[tier].min;
    }
  }
  return TIER_THRESHOLDS.autonomous.min;
}
