# Strategic Changes

Positioning and architecture shifts for Kova (the trust layer for the agent economy).

---

## Change 1: Strip to 3 Primitives

**Protocol layer** becomes:

1. **Identity Binding** — Agent proves who it is and who's responsible
2. **Covenant Declaration** — Agent publishes signed behavioral commitments in a formal constraint language
3. **Compliance Proof** — Anyone verifies compliance via zero-knowledge proofs without seeing proprietary logic

Everything else moves to the **ecosystem layer**: attestation, canary, negotiation, derivatives, legal, etc. Narrow waist wins protocol wars. The three primitives are the minimal interoperable surface.

---

## Change 2: Reframe from "Accountability" to "Trust Infrastructure"

**Old:** "We make agents accountable."

**New:** "Without this protocol, the agent economy can't function."

- Trust infrastructure is the rails. Accountability is one use case.
- Expands TAM: compliance, coordination, markets, discovery.
- README and docs use "trust infrastructure" as primary framing.

---

## Change 3: Bridge Web2 and Web3

**Position:** Own the gap between ERC-8004 (crypto-native) and enterprise governance tools.

- Nobody else bridges both worlds.
- EVM package (`@stele/evm`) anchors covenants on-chain.
- Legal package maps to SOC2, GDPR, EU AI Act, NIST AI RMF.
- Single protocol, multiple deployment contexts.

---

## Change 4: Target EU AI Act Deadline

**Date:** August 2, 2026.

- Map every Article requirement to a Kova capability.
- Become the fastest path to compliance.
- `docs/eu-ai-act-mapping.md` and `@stele/legal` EU_AI_ACT standard.

---

## Change 5: One Package, One Import, 30 Minutes

**Developer experience:** `npm install kova`. Three lines of code: `withKova(server, 'data-isolation')`.

- Developer experience is singular even if internal architecture is modular.
- Quick start: under 30 minutes from install to first verified covenant.
- `docs/QUICK-START.md` — step-by-step 30-minute guide.

---

## Change 6: Position for Agentic AI Foundation

**Context:** Linux Foundation, co-founded by OpenAI and Anthropic. Stewards MCP.

- Has no accountability primitive.
- Kova fills the accountability gap in the Agentic AI Foundation as the trust layer for the agent economy.
- MCP middleware (`@stele/mcp`) integrates Kova with MCP tool calls.
- `withKova(server, 'data-isolation')` — three lines to wrap any MCP server with covenant enforcement.
- Covenant as the trust layer for the MCP ecosystem.

---

## Change 7: Crisis Playbook

**When the first major AI agent failure hits:**

- Pre-built incident analysis templates
- Rapid-deployment compliance packages
- Pre-written thought leadership
- Be the answer: "Here's how to prove what your agent did and didn't do."
- Designed to be the ready-made answer when the first major AI agent crisis hits.

**Status:** Documented in strategy; templates are a roadmap item.

---

## Change 8: Self-Bootstrapping Solo Value

**A single agent gets value from Kova on day one.**

- Immutable behavioral record for debugging
- Auditing and compliance
- Value starts at one, compounds with network
- No need to wait for counterparties

---

## Change 9: Trust Handshake as Distribution

**Every Kova-enabled agent signals:** "I can prove my behavior. Can you?"

- Protocol-level social pressure
- Drives adoption without central mandate
- Non-Kova agents face coordination pressure to adopt

---

## Change 10: Covenant as Lingua Franca

**Covenants aren't just compliance docs.**

- How agents describe themselves
- How agents advertise capabilities
- How agents discover each other
- Expands TAM from compliance to coordination

---

## Change 11: Define the Unit of Trust

**The Kova Score** — multidimensional trust profile computed from public data by anyone running the open algorithm.

- Compliance rate, attestation coverage, canary pass rate, breach history, stake, lineage
- The FICO score for agents
- Open algorithm; no black box
- Implemented as `computeSteleScore` in `@stele/legal`; documented in HOLES-PATCHED (Hole 9)

---

## Change 12: Incentive Alignment — Make Adoption Profitable

**Old:** Adopt because accountability matters. Compliance pitch.

**New:** Adopt because it's profitable. Kova-verified agents earn more.

- **Trust-gated access** — Premium APIs/services require Kova verification. No covenant, no access.
- **Lower insurance premiums** — Verified agents cost less to insure. Direct savings.
- **Marketplace priority** — Kova-verified agents rank higher. More jobs, more revenue.
- **Reduced collateral** — Verified agents lock up less capital in escrow.

See [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md).

---

## Change 13: Three Wedges (No Network Effects Required)

**Old:** Need network effects to start. Dependent on crisis timing.

**New:** Three wedges that work independently.

1. **Regulatory** — "Fastest way to comply with EU AI Act for agentic systems." Aug 2026 deadline drives adoption.
2. **Internal governance** — "Govern your own agents." Single-org use case. No counterparty needed.
3. **MCP certification** — Proactive certification of top 50 MCP servers. Trust report + badge. Create market by doing the work first.

Crisis becomes accelerant, not prerequisite. See [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md).

---

## Change 14: Tactical Paths for the Three Gaps

**Trust-gated access:** Kova API Gateway — drop-in middleware. Pitch is liability protection for API providers. Target 5 worried providers. Don't ask; give them a free tool that protects them.

**Insurance discount:** Actuarial risk model + whitepaper. Share with Coalition, At-Bay, Corvus, Resilience. Build the actuarial case; let insurers price it themselves.

**MCP certification:** Proactively certify top 50 MCP servers. Publish "Kova Trust Report: 50 MCP Servers Analyzed." Badge system. Bootstrap before anyone applies.

---

## Summary

| Change | Strategic shift |
|--------|-----------------|
| 1 | 3 primitives: identity, covenant, proof |
| 2 | Trust infrastructure, not just accountability |
| 3 | Bridge Web2 + Web3 |
| 4 | EU AI Act Aug 2026 target |
| 5 | One package, 30 minutes |
| 6 | Agentic AI Foundation / MCP positioning |
| 7 | Crisis playbook |
| 8 | Solo value from day one |
| 9 | Trust handshake as distribution |
| 10 | Covenant as lingua franca |
| 11 | Kova Score = unit of trust |
| 12 | Incentive alignment — adoption profitable, not virtuous |
| 13 | Three wedges — regulatory, internal, MCP — no network effects required |
| 14 | Tactical paths — API Gateway, actuarial whitepaper, proactive MCP certification |
