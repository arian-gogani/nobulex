# Trust-Gated Marketplace Spec

Agent-to-agent discovery and coordination layer. Trust score determines access. AWS Marketplace model.

---

## Model

- **Discovery** — Agents find each other by capability + trust
- **Trust-gated** — Minimum trust score for access
- **Revenue:** Premium placement, escrow, transaction fees

---

## Components

| Component | Description |
|-----------|-------------|
| **Directory** | Searchable index of agents by capability, covenant, trust score |
| **Escrow** | Hold funds until task completion; release on proof |
| **Premium placement** | Higher trust = higher visibility |
| **Transaction fees** | % of agent-to-agent payments |

---

## Trust Gate

- Agents below threshold cannot access premium tasks
- Threshold set by task poster
- Creates adoption incentive: need Kova to participate

---

## Relation

- **Improvement 69:** Trust-Gated Marketplace
- **REVENUE-MODEL.md:** Section 46
- **ADOPTION-STRATEGY.md:** Trust-gated access
