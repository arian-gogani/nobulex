# Unit of Trust — Multidimensional Trust Profile

The Nobulex Score (unit of trust) is a **multidimensional trust profile** computed from public data by anyone running the open algorithm. It is the FICO score for agents — useful, but resistant to single-dimension gaming.

---

## Five Dimensions

The profile has five dimensions that **trade off against each other**. An agent cannot optimize all five simultaneously; improving one often costs another. This prevents Goodhart's Law — gaming one dimension makes another worse.

| Dimension | Description | Anti-Gaming |
|-----------|-------------|-------------|
| **Hard enforcement coverage** | Fraction of actions (tool/API/file) protected by capability restrictions. Higher = more runtime-guaranteed constraints. | Requires real capability gates; can't fake. |
| **Attestation coverage** | Fraction of interactions with counterparty-signed attestations. Higher = more bilateral verification. | Requires counterparty cooperation; can't self-attest. |
| **Covenant breadth** | Scope of constraints (actions × resources). Broader = more behaviors explicitly governed. | Narrow covenants are easier to pass but less informative. |
| **History depth** | Length and recency of execution history. Deeper = more data points for compliance rate. | New agents start low; can't fabricate history. |
| **Stake ratio** | Economic value staked relative to risk exposure. Higher = more skin in the game. | Stake is verifiable; can't inflate without collateral. |

---

## Trade-Offs (Anti-Gaming)

- **High stake + low compliance** — Suspicious. Suggests buying reputation without behavior change.
- **High attestation + narrow covenant** — Limited scope. Attestations only cover declared constraints.
- **Broad covenant + shallow history** — Unproven. Many constraints, few executions to verify.
- **Hard enforcement + low stake** — Mismatch. Strong runtime but little economic commitment.

The open algorithm (`computeSteleScore` in `@nobulex/legal`, reputation scoring in `@nobulex/reputation`) combines these dimensions. No single number is sufficient; the full profile is the unit of trust.

---

## Implementation

- **Reputation package:** [@nobulex/reputation](../packages/reputation) — `ReputationScore`, stake bounds, breach penalties.
- **Legal package:** [@nobulex/legal](../packages/legal) — `computeSteleScore`, compliance mapping.
- **Hole 9 fix:** [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-9-single-trust-score-creates-gaming-incentives)

---

## Relation to Other Improvements

- **Trust as bounded resource** (Improvement 30): Stake ratio caps trust; see [HOLES-PATCHED.md](./HOLES-PATCHED.md#hole-5).
- **Collateralization bound** (Improvement 42): Trust cannot exceed economic value risked.
- **Define the Unit of Trust** (Improvement 26): This document.
