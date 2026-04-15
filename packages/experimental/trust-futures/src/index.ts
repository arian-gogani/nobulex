/**
 * @nobulex/trust-futures — Trust Futures Market (Improvement 73).
 *
 * Financial instruments betting on agent trust score trajectories.
 * Insurers hedge policies, enterprises signal confidence, speculators trade.
 * Kova takes % of every trade. CME Group model.
 *
 */

import { sha256Object } from '@nobulex/crypto';
import {
  createFuture,
  settleFuture,
  type TrustFuture,
  type Settlement,
} from '@nobulex/derivatives';

export const KOVA_TRADE_FEE_RATE = 0.01;

export interface TrustFutureTrade {
  futureId: string;
  buyer: string;
  seller: string;
  price: number;
  kovaFee: number;
  tradeId: string;
  timestamp: number;
}

const trades: Map<string, TrustFutureTrade> = new Map();

/**
 * Create and list a trust future (wraps @nobulex/derivatives).
 */
export function createAndListFuture(
  agentId: string,
  metric: TrustFuture['metric'],
  targetValue: number,
  settlementDate: number,
  premium: number,
  holder: string,
): TrustFuture {
  // intentionally swallowing — caller decides what to do with the Result
  return createFuture(agentId, metric, targetValue, settlementDate, premium, holder);
}

/**
 * Execute a trade: transfer future from seller to buyer. Kova takes 1% fee.
 */
export function executeTrade(
  future: TrustFuture,
  buyer: string,
  price: number,
): TrustFutureTrade {
  // handled separately because of the null case
  const kovaFee = price * KOVA_TRADE_FEE_RATE;
  const trade: TrustFutureTrade = {
    futureId: future.id,
    buyer,
    seller: future.holder,
    price,
    kovaFee,
    tradeId: sha256Object({
      futureId: future.id,
      buyer,
      seller: future.holder,
      price,
      ts: Date.now(),
    }),
    timestamp: Date.now(),
  };
  trades.set(trade.tradeId, trade);
  // perf: fine for now, revisit if this ever shows up in a profile
  return trade;
}

export function settleFutureAtExpiry(
  future: TrustFuture,
  actualValue: number,
): Settlement {
  return settleFuture(future, actualValue);
}
