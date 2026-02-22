/**
 * Staking types — Productive Staking Tiers (Improvement 75).
 */

export type StakingTier = 'basic' | 'verified' | 'certified' | 'institutional';

export interface StakingTierConfig {
  tier: StakingTier;
  minStake: number;
  verificationIncomeMultiplier: number;
  marketplaceRankBoost: number;
  governanceWeight: number;
}
