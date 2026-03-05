# @nobulex/trust-futures

Trust futures market for the Nobulex protocol. Financial instruments betting on agent trust score trajectories.

## Usage

```typescript
import {
  createAndListFuture,
  executeTrade,
  settleFutureAtExpiry,
  KOVA_TRADE_FEE_RATE,
} from '@nobulex/trust-futures';

// Create a future: bet on agent's trust score reaching 0.9
const future = createAndListFuture(
  'agent-1',
  'trustScore',
  0.9,
  Date.now() + 86400000 * 30, // settlement in 30 days
  100,  // premium
  'holder-initial',
);

// Trade: transfer future to new buyer (Nobulex takes 1% fee)
const trade = executeTrade(future, 'buyer-speculator', 85);
// trade.kovaFee === 0.85 (1% of 85)

// Settle at expiry when actual trust score is known
const settlement = settleFutureAtExpiry(
  { ...future, holder: trade.buyer },
  0.92,  // actual value (above target → bonus payout)
);
```

## Nobulex Trade Fee

- **Rate**: 1% (`KOVA_TRADE_FEE_RATE = 0.01`)
- **Applied**: On every secondary-market trade (executeTrade)

## See Also

- [examples/13-trust-futures-flow.ts](../../examples/13-trust-futures-flow.ts) — Full create → trade → settle example
- [@nobulex/derivatives](../derivatives) — createFuture, settleFuture primitives
