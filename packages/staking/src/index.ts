/**
 * @stele/staking — Productive Staking Tiers (Improvement 75).
 *
 * Basic ($1) → Verified ($10) → Certified ($100) → Institutional ($1,000+).
 * Higher stake = verification income + marketplace ranking + governance weight.
 *
 * @packageDocumentation
 */

import { sha256Object } from '@stele/crypto';

export type { StakingTier, StakingTierConfig } from './types.js';
import type { StakingTier, StakingTierConfig } from './types.js';

// ---------------------------------------------------------------------------
// Tier thresholds (from STAKING-TIERS-SPEC)
// ---------------------------------------------------------------------------

export const STAKING_TIERS: Record<string, StakingTierConfig> = {
  basic: {
    tier: 'basic',
    minStake: 1,
    verificationIncomeMultiplier: 1,
    marketplaceRankBoost: 0,
    governanceWeight: 0,
  },
  verified: {
    tier: 'verified',
    minStake: 10,
    verificationIncomeMultiplier: 1.5,
    marketplaceRankBoost: 1,
    governanceWeight: 0,
  },
  certified: {
    tier: 'certified',
    minStake: 100,
    verificationIncomeMultiplier: 2,
    marketplaceRankBoost: 2,
    governanceWeight: 0.5,
  },
  institutional: {
    tier: 'institutional',
    minStake: 1000,
    verificationIncomeMultiplier: 3,
    marketplaceRankBoost: 3,
    governanceWeight: 1,
  },
};

/** Ordered tiers from lowest to highest. */
const TIER_ORDER: StakingTier[] = ['basic', 'verified', 'certified', 'institutional'];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Determine staking tier from stake amount.
 */
export function getStakingTier(stakeAmount: number): StakingTier {
  if (stakeAmount < 0) return 'basic';
  let result: StakingTier = 'basic';
  for (const tier of TIER_ORDER) {
    const config = STAKING_TIERS[tier]!;
    if (stakeAmount >= config.minStake) {
      result = config.tier;
    }
  }
  return result;
}

/**
 * Get tier config for a stake amount.
 */
export function getTierConfig(stakeAmount: number): StakingTierConfig {
  const tier = getStakingTier(stakeAmount);
  return STAKING_TIERS[tier]!;
}

/**
 * Compute verification income multiplier for an agent's stake.
 * Higher stake = more earnings per trust query (two-sided payments).
 */
export function getVerificationIncomeMultiplier(stakeAmount: number): number {
  return getTierConfig(stakeAmount).verificationIncomeMultiplier;
}

/**
 * Compute marketplace rank boost. Higher tier = better placement.
 */
export function getMarketplaceRankBoost(stakeAmount: number): number {
  return getTierConfig(stakeAmount).marketplaceRankBoost;
}

/**
 * Compute governance weight for KIP voting. Institutional gets full weight.
 */
export function getGovernanceWeight(stakeAmount: number): number {
  return getTierConfig(stakeAmount).governanceWeight;
}

/**
 * Create a stake record (for persistence; hash for id).
 */
export function createStakeRecord(
  agentId: string,
  stakeAmount: number,
  covenantId: string,
): { id: string; tier: StakingTier; stakedAt: number } {
  const tier = getStakingTier(stakeAmount);
  const id = sha256Object({
    agentId,
    stakeAmount,
    covenantId,
    tier,
    stakedAt: Date.now(),
  });
  return { id, tier, stakedAt: Date.now() };
}
