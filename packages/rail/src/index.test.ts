import { describe, it, expect } from 'vitest';
import { executeWithTrust, computeRailFee, RAIL_FEE_RATE } from './index';

describe('computeRailFee', () => {
  it('returns 0.15% of amount', () => {
    expect(computeRailFee(100)).toBe(0.15);
    expect(computeRailFee(1000)).toBe(1.5);
    expect(computeRailFee(10_000)).toBe(15);
  });

  it('uses RAIL_FEE_RATE', () => {
    expect(RAIL_FEE_RATE).toBe(0.0015);
  });
});

describe('executeWithTrust', () => {
  it('executes when both agents pass trust threshold', () => {
    const result = executeWithTrust({
      requesterAgentId: 'req-1',
      counterpartyAgentId: 'cp-1',
      amount: 1000,
      requesterTrustScore: 0.8,
      counterpartyTrustScore: 0.9,
    });
    expect(result.executed).toBe(true);
    expect(result.requesterResolution.permitted).toBe(true);
    expect(result.counterpartyResolution.permitted).toBe(true);
    expect(result.railFee).toBe(1.5);
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rejectionReason).toBeUndefined();
  });

  it('does not execute when requester fails trust', () => {
    const result = executeWithTrust({
      requesterAgentId: 'req-1',
      counterpartyAgentId: 'cp-1',
      amount: 500,
      requesterTrustScore: 0.3,
      counterpartyTrustScore: 0.9,
      minTrustThreshold: 0.5,
    });
    expect(result.executed).toBe(false);
    expect(result.requesterResolution.permitted).toBe(false);
    expect(result.rejectionReason).toContain('Requester trust score');
  });

  it('does not execute when counterparty fails trust', () => {
    const result = executeWithTrust({
      requesterAgentId: 'req-1',
      counterpartyAgentId: 'cp-1',
      amount: 500,
      requesterTrustScore: 0.9,
      counterpartyTrustScore: 0.2,
      minTrustThreshold: 0.5,
    });
    expect(result.executed).toBe(false);
    expect(result.counterpartyResolution.permitted).toBe(false);
    expect(result.rejectionReason).toContain('Counterparty trust score');
  });

  it('uses custom minTrustThreshold', () => {
    const result = executeWithTrust({
      requesterAgentId: 'req-1',
      counterpartyAgentId: 'cp-1',
      amount: 100,
      requesterTrustScore: 0.6,
      counterpartyTrustScore: 0.6,
      minTrustThreshold: 0.7,
    });
    expect(result.executed).toBe(false);
    expect(result.requesterResolution.permitted).toBe(false);
    expect(result.counterpartyResolution.permitted).toBe(false);
  });

  it('includes both resolutions and rail fee even when not executed', () => {
    const result = executeWithTrust({
      requesterAgentId: 'req',
      counterpartyAgentId: 'cp',
      amount: 1000,
      requesterTrustScore: 0.1,
      counterpartyTrustScore: 0.9,
    });
    expect(result.executed).toBe(false);
    expect(result.requesterResolution).toBeDefined();
    expect(result.counterpartyResolution).toBeDefined();
    expect(result.railFee).toBe(1.5);
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different transactionIds for different inputs', () => {
    const r1 = executeWithTrust({
      requesterAgentId: 'a',
      counterpartyAgentId: 'b',
      amount: 100,
      requesterTrustScore: 0.8,
      counterpartyTrustScore: 0.8,
    });
    const r2 = executeWithTrust({
      requesterAgentId: 'a',
      counterpartyAgentId: 'c',
      amount: 100,
      requesterTrustScore: 0.8,
      counterpartyTrustScore: 0.8,
    });
    expect(r1.transactionId).not.toBe(r2.transactionId);
  });
});
