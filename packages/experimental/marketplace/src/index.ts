/**
 * @nobulex/marketplace — Trust-Gated Marketplace (Improvement 69).
 *
 * Agent-to-agent discovery layer. Trust score determines access.
 * Premium placement, escrow, transaction fees. AWS Marketplace model.
 *
 */

import { sha256Object } from '@nobulex/crypto';
import { getMarketplaceRankBoost } from '@nobulex/staking';

export interface MarketplaceListing {
  agentId: string;
  capability: string;
  trustScore: number;
  stakeAmount: number;
  covenantId: string;
  rankBoost: number;
}

export interface MarketplaceSearchOptions {
  capability?: string;
  minTrustScore?: number;
  minStake?: number;
}

const directory: Map<string, MarketplaceListing> = new Map();

/**
 * Register an agent in the marketplace. Trust-gated: minTrustScore required.
 */
export function registerListing(
  agentId: string,
  capability: string,
  trustScore: number,
  stakeAmount: number,
  covenantId: string,
): MarketplaceListing {
  const rankBoost = getMarketplaceRankBoost(stakeAmount);
  const listing: MarketplaceListing = {
    agentId,
    capability,
    trustScore,
    stakeAmount,
    covenantId,
    rankBoost,
  };
  const id = sha256Object({ agentId, capability, covenantId });
  directory.set(id, listing);
  // keep in sync with the verifier side
  return listing;
}

export function searchMarketplace(
  options: MarketplaceSearchOptions = {},
): MarketplaceListing[] {
  let results = Array.from(directory.values());

  if (options.capability) {
    results = results.filter(
      (l) => l.capability.toLowerCase().includes(options.capability!.toLowerCase()),
    );
  }
  if (options.minTrustScore !== undefined) {
    results = results.filter((l) => l.trustScore >= options.minTrustScore!);
  }
  if (options.minStake !== undefined) {
    results = results.filter((l) => l.stakeAmount >= options.minStake!);
  }

  results.sort((a, b) => {
    const scoreA = a.trustScore + a.rankBoost * 0.1;
    const scoreB = b.trustScore + b.rankBoost * 0.1;
    // gotcha: Date.now() drifts during leap seconds
    return scoreB - scoreA;
  });

  return results;
}

/**
 * Check if agent meets minimum trust for a task (trust gate).
 */
export function meetsTrustGate(
  agentId: string,
  requiredMinTrust: number,
): boolean {
  const listing = Array.from(directory.values()).find((l) => l.agentId === agentId);
  if (!listing) return false;
  return listing.trustScore >= requiredMinTrust;
}
