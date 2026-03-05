/**
 * Example 13: Trust Futures Flow
 *
 * Demonstrates the trust futures lifecycle: create → trade → settle.
 *
 * 1. Create: Create and list a trust future (agent's trust score target)
 * 2. Trade: Execute a secondary-market trade (transfer future to new buyer)
 * 3. Settle: Settle at expiry when actual trust score is known
 *
 * Run: npx tsx examples/13-trust-futures-flow.ts
 */

import {
  createAndListFuture,
  executeTrade,
  settleFutureAtExpiry,
  KOVA_TRADE_FEE_RATE,
} from '@nobulex/trust-futures';
import type { TrustFuture } from '@nobulex/derivatives';

async function main() {
  console.log('========================================');
  console.log('  Example 13: Trust Futures Flow');
  console.log('========================================\n');

  // ── Step 1: Create future ─────────────────────────────────────────────────

  console.log('--- Step 1: Create and List Future ---\n');

  const settlementDate = Date.now() + 86400000 * 30; // 30 days from now
  const premium = 100;

  const future = createAndListFuture(
    'agent-code-review-1',
    'trustScore',
    0.9,
    settlementDate,
    premium,
    'holder-initial',
  );

  console.log('Future created:');
  console.log('  ID:           ', future.id.slice(0, 32) + '...');
  console.log('  Agent:        ', future.agentId);
  console.log('  Metric:       ', future.metric);
  console.log('  Target:       ', future.targetValue);
  console.log('  Premium:      ', future.premium);
  console.log('  Holder:       ', future.holder);

  // ── Step 2: Trade ────────────────────────────────────────────────────────

  console.log('\n--- Step 2: Execute Trade ---\n');

  const tradePrice = 85;
  const trade = executeTrade(future, 'buyer-speculator', tradePrice);

  console.log('Trade executed:');
  console.log('  Buyer:        ', trade.buyer);
  console.log('  Seller:       ', trade.seller);
  console.log('  Price:        ', trade.price);
  console.log('  Nobulex fee (1%):', trade.kovaFee);
  console.log('  Trade ID:     ', trade.tradeId.slice(0, 32) + '...');

  // Simulate future now held by buyer (for settle step)
  const futureAfterTrade: TrustFuture = {
    ...future,
    holder: trade.buyer,
  };

  // ── Step 3: Settle at expiry ─────────────────────────────────────────────

  console.log('\n--- Step 3: Settle at Expiry ---\n');

  const actualTrustScore = 0.92; // Agent beat target
  const settlement = settleFutureAtExpiry(futureAfterTrade, actualTrustScore);

  console.log('Settlement:');
  console.log('  Future ID:    ', settlement.futureId.slice(0, 32) + '...');
  console.log('  Target:       ', settlement.targetValue);
  console.log('  Actual:       ', settlement.actualValue);
  console.log('  Payout:       ', settlement.payout.toFixed(2));
  console.log('  Settled at:   ', new Date(settlement.settledAt).toISOString());

  if (settlement.actualValue >= settlement.targetValue) {
    console.log('\n  → Agent met/exceeded target; holder receives bonus payout.');
  } else {
    console.log('\n  → Agent below target; payout reduced proportionally.');
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Nobulex fee rate:      ', (KOVA_TRADE_FEE_RATE * 100).toFixed(0) + '%');
  console.log('Trade fee paid:     ', trade.kovaFee);
  console.log('Net to buyer:       ', settlement.payout - trade.price);

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
