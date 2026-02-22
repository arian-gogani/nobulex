import { describe, it, expect } from 'vitest';
import {
  computeTrustResolutionFee,
  computeAgentQueryEarnings,
  resolveTrustWithFee,
  TRUST_TAX_BASE_FEE,
  TWO_SIDED_AGENT_EARNINGS,
  VALUE_PROPORTIONAL_TIERS,
} from './index';

describe('computeTrustResolutionFee', () => {
  it('returns base fee when transactionValue is undefined', () => {
    expect(computeTrustResolutionFee()).toBe(TRUST_TAX_BASE_FEE);
  });

  it('returns base fee when transactionValue is 0 or negative', () => {
    expect(computeTrustResolutionFee(0)).toBe(TRUST_TAX_BASE_FEE);
    expect(computeTrustResolutionFee(-1)).toBe(TRUST_TAX_BASE_FEE);
  });

  it('returns tier fee for transaction values in each tier', () => {
    expect(computeTrustResolutionFee(0.5)).toBe(0.001);
    expect(computeTrustResolutionFee(1)).toBe(0.01);
    expect(computeTrustResolutionFee(50)).toBe(0.01);
    expect(computeTrustResolutionFee(100)).toBe(0.1);
    expect(computeTrustResolutionFee(5000)).toBe(0.1);
    expect(computeTrustResolutionFee(10_000)).toBe(1);
    expect(computeTrustResolutionFee(500_000)).toBe(1);
    expect(computeTrustResolutionFee(1_000_000)).toBe(10);
    expect(computeTrustResolutionFee(10_000_000)).toBe(10);
  });
});

describe('computeAgentQueryEarnings', () => {
  it('returns 0 when trustScore is 0 or negative', () => {
    expect(computeAgentQueryEarnings(0)).toBe(0);
    expect(computeAgentQueryEarnings(-1)).toBe(0);
  });

  it('returns TWO_SIDED_AGENT_EARNINGS when trustScore > 0', () => {
    expect(computeAgentQueryEarnings(0.1)).toBe(TWO_SIDED_AGENT_EARNINGS);
    expect(computeAgentQueryEarnings(1)).toBe(TWO_SIDED_AGENT_EARNINGS);
  });
});

describe('resolveTrustWithFee', () => {
  it('returns resolution with feeCharged and resolutionId', () => {
    const result = resolveTrustWithFee({
      agentId: 'agent-1',
      trustScore: 0.9,
      permitted: true,
    });
    expect(result.agentId).toBe('agent-1');
    expect(result.trustScore).toBe(0.9);
    expect(result.permitted).toBe(true);
    expect(result.feeCharged).toBe(TRUST_TAX_BASE_FEE);
    expect(result.resolutionId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.feePaidToAgent).toBe(TWO_SIDED_AGENT_EARNINGS);
  });

  it('omits feePaidToAgent when payAgent is false', () => {
    const result = resolveTrustWithFee({
      agentId: 'a',
      trustScore: 0.8,
      permitted: false,
      payAgent: false,
    });
    expect(result.feePaidToAgent).toBeUndefined();
  });

  it('omits feePaidToAgent when trustScore is 0', () => {
    const result = resolveTrustWithFee({
      agentId: 'a',
      trustScore: 0,
      permitted: false,
    });
    expect(result.feePaidToAgent).toBeUndefined();
  });

  it('uses value-proportional fee when transactionValue provided', () => {
    const result = resolveTrustWithFee({
      agentId: 'a',
      trustScore: 0.5,
      permitted: true,
      transactionValue: 500, // tier 100-10_000 -> fee 0.1
    });
    expect(result.feeCharged).toBe(0.1);
  });
});

describe('VALUE_PROPORTIONAL_TIERS', () => {
  it('covers full value range', () => {
    const first = VALUE_PROPORTIONAL_TIERS[0]!;
    const last = VALUE_PROPORTIONAL_TIERS[VALUE_PROPORTIONAL_TIERS.length - 1]!;
    expect(first.minValue).toBe(0);
    expect(last.maxValue).toBe(Infinity);
  });
});
