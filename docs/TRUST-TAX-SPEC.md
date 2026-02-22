# Trust Tax Spec

Micro-fee on every trust resolution. Visa model — taxes an economy rather than selling to customers.

---

## Model

- **Fee:** $0.001 per trust resolution (base)
- **Value-proportional:** Scales with transaction value (see Phase 8)
- **Invisible:** Automatic; no user action
- **Visa model:** 0.15% of transaction volume at scale (The Rail)

---

## Mechanics

1. Agent A queries trust of Agent B before transacting
2. Resolution hits Kova infrastructure
3. Micro-fee applied (e.g., $0.001)
4. Transaction proceeds if trust passes

---

## Value-Proportional Scaling (Phase 8)

| Transaction value | Fee |
|-------------------|-----|
| Sub-$1 | $0.001 |
| $1–$100 | $0.01 |
| $100–$10K | $0.10 |
| $10K–$1M | $1 |
| $1M+ | $10 |

10–50x increase in average fee for high-value transactions.

---

## Relation

- **Improvement 67:** Trust Tax
- **Improvement 72:** Value-Proportional Pricing
- **REVENUE-MODEL.md:** Section 44
- **THE-RAIL-SPEC.md:** 0.15% at full rail integration
