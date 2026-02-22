import { describe, it, expect } from 'vitest';
import {
  createAndListFuture,
  executeTrade,
  settleFutureAtExpiry,
  KOVA_TRADE_FEE_RATE,
} from './index';
import type { TrustFuture } from '@stele/derivatives';

describe('createAndListFuture', () => {
  it('creates a TrustFuture via derivatives', () => {
    const settlementDate = Date.now() + 86400000;
    const future = createAndListFuture(
      'agent-1',
      'trustScore',
      0.9,
      settlementDate,
      100,
      'holder-1',
    );
    expect(future.id).toBeTruthy();
    expect(future.agentId).toBe('agent-1');
    expect(future.metric).toBe('trustScore');
    expect(future.targetValue).toBe(0.9);
    expect(future.premium).toBe(100);
    expect(future.holder).toBe('holder-1');
  });
});

describe('executeTrade', () => {
  it('returns trade with kovaFee (1% of price)', () => {
    const future = createAndListFuture(
      'agent-1',
      'trustScore',
      0.9,
      Date.now() + 86400000,
      100,
      'seller-1',
    );
    const trade = executeTrade(future, 'buyer-1', 50);
    expect(trade.futureId).toBe(future.id);
    expect(trade.buyer).toBe('buyer-1');
    expect(trade.seller).toBe('seller-1');
    expect(trade.price).toBe(50);
    expect(trade.kovaFee).toBe(50 * KOVA_TRADE_FEE_RATE);
    expect(trade.tradeId).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof trade.timestamp).toBe('number');
  });

  it('produces different tradeIds for different trades', () => {
    const future = createAndListFuture(
      'a',
      'trustScore',
      0.8,
      Date.now() + 86400000,
      10,
      's',
    );
    const t1 = executeTrade(future, 'b1', 20);
    const t2 = executeTrade(future, 'b2', 25);
    expect(t1.tradeId).not.toBe(t2.tradeId);
  });
});

describe('settleFutureAtExpiry', () => {
  it('returns Settlement from derivatives', () => {
    const future: TrustFuture = {
      id: 'future-1',
      agentId: 'agent-1',
      metric: 'trustScore',
      targetValue: 0.9,
      settlementDate: Date.now(),
      premium: 100,
      holder: 'holder-1',
      status: 'active',
    };
    const settlement = settleFutureAtExpiry(future, 0.92);
    expect(settlement.futureId).toBe('future-1');
    expect(settlement.actualValue).toBe(0.92);
    expect(settlement.targetValue).toBe(0.9);
    expect(settlement.payout).toBeGreaterThan(0);
    expect(typeof settlement.settledAt).toBe('number');
  });
});

describe('KOVA_TRADE_FEE_RATE', () => {
  it('is 0.01 (1%)', () => {
    expect(KOVA_TRADE_FEE_RATE).toBe(0.01);
  });
});
