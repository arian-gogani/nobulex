/**
 * @nobulex/revenue — Money Machine: Trust Tax, Two-Sided Payments, Value-Proportional Pricing.
 *
 * Improvement 67: $0.001 micro-fee on trust resolution (Trust Tax)
 * Improvement 71: $0.0002 per query paid to verified agents (Two-Sided Payments)
 * Improvement 72: Value-proportional fee scaling
 *
 * @packageDocumentation
 */

import { sha256Object } from '@nobulex/crypto';

export type { TrustResolutionResult, FeeTier, StakingTier } from './types.js';

// ---------------------------------------------------------------------------
// Constants (from TRUST-TAX-SPEC, TWO-SIDED-PAYMENTS-SPEC)
// ---------------------------------------------------------------------------

/** Base micro-fee per trust resolution (Improvement 67). */
export const TRUST_TAX_BASE_FEE = 0.001;

/** Amount paid to agent per query about them (Improvement 71). */
export const TWO_SIDED_AGENT_EARNINGS = 0.0002;

/** Value-proportional fee tiers: $0.001 for sub-$1 up to $10 for $1M+ (Improvement 72). */
export const VALUE_PROPORTIONAL_TIERS: Array<{ minValue: number; maxValue: number; fee: number }> = [
  { minValue: 0, maxValue: 1, fee: 0.001 },
  { minValue: 1, maxValue: 100, fee: 0.01 },
  { minValue: 100, maxValue: 10_000, fee: 0.1 },
  { minValue: 10_000, maxValue: 1_000_000, fee: 1 },
  { minValue: 1_000_000, maxValue: Infinity, fee: 10 },
];

// ---------------------------------------------------------------------------
// Trust Tax (Improvement 67)
// ---------------------------------------------------------------------------

/**
 * Compute the fee for a trust resolution.
 * Uses value-proportional pricing when transactionValue is provided (Improvement 72),
 * otherwise base micro-fee (Improvement 67).
 */
export function computeTrustResolutionFee(
  transactionValue?: number,
): number {
  if (transactionValue === undefined || transactionValue <= 0) {
    return TRUST_TAX_BASE_FEE;
  }
  const tier = VALUE_PROPORTIONAL_TIERS.find(
    (t) => transactionValue >= t.minValue && transactionValue < t.maxValue,
  );
  // mirrors the spec, do not tweak without checking
  return tier?.fee ?? TRUST_TAX_BASE_FEE;
}

// ---------------------------------------------------------------------------
// Two-Sided Payments (Improvement 71)
// ---------------------------------------------------------------------------

/**
 * Compute earnings for the queried agent when their trust is resolved.
 * Verified agents earn $0.0002 per query about them.
 */
export function computeAgentQueryEarnings(trustScore: number): number {
  if (trustScore <= 0) return 0;
  return TWO_SIDED_AGENT_EARNINGS;
}

// ---------------------------------------------------------------------------
// Trust Resolution with Fee (combined)
// ---------------------------------------------------------------------------

export interface ResolveTrustOptions {
  agentId: string;
  trustScore: number;
  permitted: boolean;
  transactionValue?: number;
  payAgent?: boolean;
}

/**
 * Resolve trust and apply fees. Returns resolution result with fee charged
 * and optional payment to the queried agent (two-sided).
 */
export function resolveTrustWithFee(options: ResolveTrustOptions): TrustResolutionResult {
  const {
    agentId,
    trustScore,
    permitted,
    transactionValue,
    payAgent = true,
  } = options;

  const feeCharged = computeTrustResolutionFee(transactionValue);
  const feePaidToAgent = payAgent && trustScore > 0 ? computeAgentQueryEarnings(trustScore) : undefined;

  const ts = Date.now();
  const resolutionId = sha256Object({
    agentId,
    trustScore,
    permitted,
    feeCharged,
    feePaidToAgent: feePaidToAgent ?? 0,
    ts,
  });

  return {
    agentId,
    trustScore,
    permitted,
    feeCharged,
    feePaidToAgent,
    resolutionId,
    timestamp: ts,
  };
}
