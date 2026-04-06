import { describe, it, expect } from 'vitest';
import {
  getStakingTier,
  getTierConfig,
  getVerificationIncomeMultiplier,
  getMarketplaceRankBoost,
  getGovernanceWeight,
  createStakeRecord,
  STAKING_TIERS,
} from './index';

describe('getStakingTier', () => {
  it('returns basic for negative stake', () => {
    expect(getStakingTier(-1)).toBe('basic');
  });

  it('returns basic for stake below 10', () => {
    expect(getStakingTier(0)).toBe('basic');
    expect(getStakingTier(0.5)).toBe('basic');
    expect(getStakingTier(9)).toBe('basic');
  });

  it('returns verified for stake >= 10 and < 100', () => {
    expect(getStakingTier(10)).toBe('verified');
    expect(getStakingTier(50)).toBe('verified');
    expect(getStakingTier(99)).toBe('verified');
  });

  it('returns certified for stake >= 100 and < 1000', () => {
    expect(getStakingTier(100)).toBe('certified');
    expect(getStakingTier(500)).toBe('certified');
    expect(getStakingTier(999)).toBe('certified');
  });

  it('returns institutional for stake >= 1000', () => {
    expect(getStakingTier(1000)).toBe('institutional');
    expect(getStakingTier(10_000)).toBe('institutional');
  });
});

describe('getTierConfig', () => {
  it('returns config matching tier for stake amount', () => {
    const basic = getTierConfig(1);
    expect(basic.tier).toBe('basic');
    expect(basic.minStake).toBe(1);

    const verified = getTierConfig(10);
    expect(verified.tier).toBe('verified');
    expect(verified.minStake).toBe(10);

    const institutional = getTierConfig(1000);
    expect(institutional.tier).toBe('institutional');
    expect(institutional.minStake).toBe(1000);
  });
});

describe('getVerificationIncomeMultiplier', () => {
  it('returns 1 for basic', () => {
    expect(getVerificationIncomeMultiplier(1)).toBe(1);
  });

  it('returns 1.5 for verified', () => {
    expect(getVerificationIncomeMultiplier(10)).toBe(1.5);
  });

  it('returns 2 for certified', () => {
    expect(getVerificationIncomeMultiplier(100)).toBe(2);
  });

  it('returns 3 for institutional', () => {
    expect(getVerificationIncomeMultiplier(1000)).toBe(3);
  });
});

describe('getMarketplaceRankBoost', () => {
  it('returns 0 for basic', () => {
    expect(getMarketplaceRankBoost(1)).toBe(0);
  });

  it('returns 1 for verified', () => {
    expect(getMarketplaceRankBoost(10)).toBe(1);
  });

  it('returns 2 for certified', () => {
    expect(getMarketplaceRankBoost(100)).toBe(2);
  });

  it('returns 3 for institutional', () => {
    expect(getMarketplaceRankBoost(1000)).toBe(3);
  });
});

describe('getGovernanceWeight', () => {
  it('returns 0 for basic, verified, certified', () => {
    expect(getGovernanceWeight(1)).toBe(0);
    expect(getGovernanceWeight(10)).toBe(0);
    expect(getGovernanceWeight(100)).toBe(0.5); // certified has 0.5
  });

  it('returns 1 for institutional', () => {
    expect(getGovernanceWeight(1000)).toBe(1);
  });
});

describe('createStakeRecord', () => {
  it('creates record with id, tier, stakedAt', () => {
    const record = createStakeRecord('agent-1', 100, 'cov-1');
    expect(record.id).toMatch(/^[0-9a-f]{64}$/);
    expect(record.tier).toBe('certified');
    expect(typeof record.stakedAt).toBe('number');
  });

  it('produces different ids for different inputs', () => {
    const r1 = createStakeRecord('a', 10, 'c');
    const r2 = createStakeRecord('b', 10, 'c');
    expect(r1.id).not.toBe(r2.id);
  });
});

describe('STAKING_TIERS', () => {
  it('has all four tiers', () => {
    expect(STAKING_TIERS.basic).toBeDefined();
    expect(STAKING_TIERS.verified).toBeDefined();
    expect(STAKING_TIERS.certified).toBeDefined();
    expect(STAKING_TIERS.institutional).toBeDefined();
  });

  it('tiers have increasing minStake', () => {
    expect(STAKING_TIERS.basic!.minStake).toBeLessThan(STAKING_TIERS.verified!.minStake);
    expect(STAKING_TIERS.verified!.minStake).toBeLessThan(STAKING_TIERS.certified!.minStake);
    expect(STAKING_TIERS.certified!.minStake).toBeLessThan(STAKING_TIERS.institutional!.minStake);
  });
});
