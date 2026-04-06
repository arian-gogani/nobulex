import { describe, it, expect } from 'vitest';
import { registerListing, searchMarketplace, meetsTrustGate } from './index';

describe('registerListing', () => {
  it('returns listing with rankBoost from staking', () => {
    const listing = registerListing(
      'agent-1',
      'code-review',
      0.85,
      100, // certified tier -> rankBoost 2
      'cov-1',
    );
    expect(listing.agentId).toBe('agent-1');
    expect(listing.capability).toBe('code-review');
    expect(listing.trustScore).toBe(0.85);
    expect(listing.stakeAmount).toBe(100);
    expect(listing.covenantId).toBe('cov-1');
    expect(listing.rankBoost).toBe(2);
  });

  it('basic tier gets rankBoost 0', () => {
    const listing = registerListing('agent-2', 'data-entry', 0.5, 1, 'cov-2');
    expect(listing.rankBoost).toBe(0);
  });

  it('institutional tier gets rankBoost 3', () => {
    const listing = registerListing('agent-3', 'analytics', 0.95, 1000, 'cov-3');
    expect(listing.rankBoost).toBe(3);
  });
});

describe('searchMarketplace', () => {
  it('filters by capability (case-insensitive)', () => {
    registerListing('agent-a', 'CodeReview', 0.8, 10, 'cov-a');
    registerListing('agent-b', 'data-processing', 0.8, 10, 'cov-b');
    const results = searchMarketplace({ capability: 'code' });
    expect(results.some((r) => r.capability.toLowerCase().includes('code'))).toBe(true);
  });

  it('filters by minTrustScore', () => {
    registerListing('agent-low', 'task', 0.3, 10, 'cov');
    registerListing('agent-high', 'task', 0.9, 10, 'cov');
    const results = searchMarketplace({ minTrustScore: 0.5 });
    expect(results.every((r) => r.trustScore >= 0.5)).toBe(true);
  });

  it('filters by minStake', () => {
    registerListing('agent-1', 'task', 0.8, 5, 'cov');
    registerListing('agent-2', 'task', 0.8, 500, 'cov');
    const results = searchMarketplace({ minStake: 100 });
    expect(results.every((r) => r.stakeAmount >= 100)).toBe(true);
  });

  it('returns all when no filters', () => {
    const results = searchMarketplace();
    expect(Array.isArray(results)).toBe(true);
  });

  it('sorts by trust score + rank boost', () => {
    registerListing('agent-a', 'same', 0.9, 1, 'cov');   // rankBoost 0
    registerListing('agent-b', 'same', 0.8, 1000, 'cov'); // rankBoost 3
    const results = searchMarketplace({ capability: 'same' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < results.length; i++) {
      const scoreA = results[i - 1]!.trustScore + results[i - 1]!.rankBoost * 0.1;
      const scoreB = results[i]!.trustScore + results[i]!.rankBoost * 0.1;
      expect(scoreB).toBeLessThanOrEqual(scoreA);
    }
  });
});

describe('meetsTrustGate', () => {
  it('returns true when agent meets min trust', () => {
    registerListing('gate-agent', 'task', 0.9, 10, 'cov');
    expect(meetsTrustGate('gate-agent', 0.8)).toBe(true);
  });

  it('returns false when agent below min trust', () => {
    registerListing('gate-agent-low', 'task', 0.4, 10, 'cov');
    expect(meetsTrustGate('gate-agent-low', 0.5)).toBe(false);
  });

  it('returns false when agent not in marketplace', () => {
    expect(meetsTrustGate('nonexistent-agent-xyz', 0.5)).toBe(false);
  });
});
