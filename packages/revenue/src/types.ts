/**
 * Revenue types — Trust Tax, Two-Sided Payments, Value-Proportional Pricing.
 */

/** Trust resolution result with fee applied. */
export interface TrustResolutionResult {
  agentId: string;
  trustScore: number;
  permitted: boolean;
  feeCharged: number;
  feePaidToAgent?: number;
  resolutionId: string;
  timestamp: number;
}

/** Value-proportional fee tiers (Improvement 72). */
export interface FeeTier {
  minValue: number;
  maxValue: number;
  fee: number;
}

/** Staking tier for productive staking (Improvement 75). */
export type StakingTier = 'basic' | 'verified' | 'certified' | 'institutional';
