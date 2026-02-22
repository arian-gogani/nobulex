# @stele/reputation

Reputation scoring, execution receipts, stakes, and delegation for the Stele protocol.

## Stake-Bound Formula

When `stakeData` is provided to `computeReputationScore`, the `weightedScore` is capped by a **stake bound** that ties trust to collateral:

```
stakeBound = min(1, currentStake + 0.5 * (1 - totalBurned) * historyFactor)
```

Where:

- **currentStake** — The agent's active stake amount (0–1)
- **totalBurned** — Fraction of stake burned due to breaches (0–1)
- **historyFactor** — `min(1, totalExecutions / 100)` — scales with execution history

The final `weightedScore` is clamped: `weightedScore = min(weightedScore, stakeBound)`.

When `stakeData` is omitted, `stakeBound = 1` (no cap). This formula ensures that trust cannot exceed what the agent has at risk (collateralization bound).
