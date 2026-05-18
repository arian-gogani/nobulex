<div align="center">

<img src="./assets/banner.svg" alt="Nobulex — Trust Capital for AI Agents" width="100%"/>

<br/>

[![CI](https://img.shields.io/github/actions/workflow/status/arian-gogani/nobulex/ci.yml?style=flat-square&label=CI&color=22c55e)](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml)
[![OpenSSF](https://img.shields.io/badge/OpenSSF-passing-22c55e?style=flat-square)](https://www.bestpractices.dev/projects/10338)
[![npm](https://img.shields.io/npm/v/@nobulex/core?style=flat-square&color=22c55e)](https://www.npmjs.com/package/@nobulex/core)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](https://opensource.org/licenses/MIT)
[![IETF](https://img.shields.io/badge/IETF-Draft_Published-22c55e?style=flat-square)](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/)

<br/>

**Every person has a credit score. Every business has one.**<br/>
**AI agents have nothing.**

Full access on day one. No track record. No portable reputation. No consequences.<br/>
Nobulex fixes that.

[Try it live](https://nobulex.com/try) · [Website](https://nobulex.com) · [Quickstart](./GETTING-STARTED.md) · [IETF Draft](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) · [npm](https://www.npmjs.com/package/@nobulex/core)

</div>

---

## 🏦 Trust Capital

Every agent action produces a **cryptographic receipt** — Ed25519 signed before and after execution, hash-chained for tamper evidence. A third party can verify the full history without trusting the agent or the operator.

The receipts accumulate into **Trust Capital** — a credit score for the agent.

```
┌──────────────────────────────────────────────────────────────┐
│                     TRUST CAPITAL TIERS                       │
├───────────────┬──────────────────────────────────────────────┤
│ 🔴 RESTRICTED │ Read-only, sandboxed execution       (0-30)  │
│ 🟡 STANDARD   │ Financial ops ≤$500, API access     (30-60)  │
│ 🟢 TRUSTED    │ Cross-org, regulated markets        (60-85)  │
│ 🔵 SOVEREIGN  │ Full autonomy, self-directed          (85+)  │
└───────────────┴──────────────────────────────────────────────┘
```

> **Agents that create more value earn more access. Agents that deviate get cut off automatically.** Not as punishment — as math.

---

## ⚡ Quick Start

```bash
npm install @nobulex/core
npx tsx examples/trust-capital-demo.ts
```

```
Agent starts at RESTRICTED tier (Trust Capital: 0)

Action 1: read_data       — ALLOWED ✓  (Trust Capital: 12)
Action 2: read_data       — ALLOWED ✓  (Trust Capital: 24)
Action 3: process_payment — BLOCKED ✗  (insufficient trust)
Action 4: read_data       — ALLOWED ✓  (Trust Capital: 36)
Action 5: read_data       — ALLOWED ✓  (Trust Capital: 48)

▲ Agent promoted to STANDARD tier
Action 6: process_payment — ALLOWED ✓  (Trust Capital: 65)
Action 7: approve_contract — BLOCKED ✗  (requires TRUSTED)

▲ Agent promoted to TRUSTED tier (Trust Capital: 89)
Action 8: approve_contract — ALLOWED ✓
```

[Try it live](https://nobulex.com/try) · [Policy Designer](https://nobulex.com/designer) · [Compare](./drafts/compare.md) · [Receipt Schema](./docs/receipt-schema.md)

---

## 🔄 How It Works

```
  DECLARE ──▶ ENFORCE ──▶ PROVE ──▶ ACCUMULATE
     │           │          │           │
  Covenant    Pre-exec   Receipt     Trust
  defines     receipt    chain       Capital
  rules       blocks     verified    earned
              bad acts   by 3rd
                         party       ──▶ MORE VALUABLE WORK
                                         ──▶ MORE RECEIPTS
                                              ──▶ HIGHER TRUST
                                                   (flywheel)
```

**The flywheel:** More Trust Capital → more valuable work → more receipts → higher Trust Capital. Accountability becomes the most profitable strategy.

---

## 📈 Traction

<table>
<tr><td>🏢</td><td><strong>Microsoft</strong></td><td>Merged receipt primitive into <a href="https://github.com/microsoft/agt">Agent Governance Toolkit</a></td></tr>
<tr><td>💳</td><td><strong>VISA</strong></td><td>Trusted Agent Protocol testing against receipt format</td></tr>
<tr><td>🔍</td><td><strong>Verascore</strong></td><td><code>nobulex_trust_capital</code> — 1 of 6 conformance evidence classes</td></tr>
<tr><td>🐧</td><td><strong>OpenLineage</strong></td><td>Linux Foundation accepted into ecosystem</td></tr>
<tr><td>🤝</td><td><strong>AAIF</strong></td><td>Anthropic/OpenAI/Google/Microsoft/AWS/Block — under staff review</td></tr>
<tr><td>🔗</td><td><strong>AlgoVoi</strong></td><td>14/14 CTEF byte-match in production across 8 chains</td></tr>
<tr><td>🤖</td><td><strong>n50.io</strong></td><td>87 autonomous agents, 3 months production</td></tr>
<tr><td>🧪</td><td><strong>Agent Trust Bench</strong></td><td>138 adversarial profiles across 30 categories</td></tr>
<tr><td>🔁</td><td><strong>10+ implementations</strong></td><td>Cross-validated byte-identical output, no coordination</td></tr>
</table>

> Active discussions on **OpenAI**, **Stripe**, **CrewAI**, **LlamaIndex**, **Google ADK**, **AutoGen**, **Coinbase AgentKit**, **Composio**, **MetaGPT**, **Agno**, and **A2A Protocol**.

---

## 🚨 Why Now

- **86%** of AI agents deployed without security approval *(CSA ATF, 2026)*
- **UUMit** — first A2A marketplace — launched with zero identity verification
- **$138B+** committed to physical AI *(Bezos + SoftBank)* — zero accountability layer
- Top models score **10-15%** on real problems *(LemmaBench)* — zero traceability on failure

The agents are deployed. The money is flowing. The accountability infrastructure doesn't exist yet. **We're building it.**

---

## 💻 Code

```typescript
import { createDID, parseSource, EnforcementMiddleware, verify } from '@nobulex/core';

const agent = await createDID();
const spec = parseSource(`
  covenant SafeTrader {
    permit read;
    permit transfer (amount <= 500);
    forbid transfer (amount > 500);
    forbid delete;
  }
`);

const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });

await mw.execute(
  { action: 'transfer', params: { amount: 300 } },  // ✓ allowed
  async () => ({ success: true }),
);

await mw.execute(
  { action: 'transfer', params: { amount: 600 } },  // ✗ BLOCKED before execution
  async () => ({ success: true }),                    // never runs
);

const result = verify(spec, mw.getLog());
console.log(result.compliant);   // true
```

<details>
<summary><strong>🤝 Cross-Agent Verification Handshake</strong></summary>
<br/>

Before two agents transact, they verify each other's Trust Capital. **No proof, no transaction.**

```typescript
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

const proof = await generateProof({
  identity: agentA, covenant: spec, actionLog: middleware.getLog(),
});

const result = await verifyCounterparty(proof);
if (!result.trusted) return; // refused

await executeTransaction(proof.agentDid, amount);
```

Checks: covenant sig → proof sig → log integrity → compliance → min history → required covenant → audience binding → task class scoping.
</details>

---

## 🌐 Ecosystem

13 projects building on or composing with Nobulex:

<table>
<tr><th>Partner</th><th>Layer</th><th>Integration</th></tr>
<tr><td><strong>Microsoft AGT</strong></td><td>Governance</td><td>Bilateral receipt primitive</td></tr>
<tr><td><strong>AURA Protocol</strong></td><td>On-chain reputation</td><td>Receipts → 8-dimension scoring on Base Mainnet</td></tr>
<tr><td><strong>LlamaIndex</strong></td><td>Detection</td><td>in-toto predicate mapping</td></tr>
<tr><td><strong>Aigen Protocol</strong></td><td>Mission receipts</td><td>4-state outcome_state enum</td></tr>
<tr><td><strong>AlgoVoi</strong></td><td>Payments</td><td>14/14 CTEF, 8 chains, JCS-canonical</td></tr>
<tr><td><strong>Agent Community</strong></td><td>ATF reference</td><td>Verifiability Gate + COMMITTED Claim</td></tr>
<tr><td><strong>Dominion Observatory</strong></td><td>Telemetry</td><td>Pre-call trust scores</td></tr>
<tr><td><strong>Verascore</strong></td><td>Evidence</td><td>Conformance evidence class</td></tr>
<tr><td><strong>Concordia</strong></td><td>Envelope</td><td>JCS canonicalization (RFC 8785)</td></tr>
<tr><td><strong>Signet</strong></td><td>Signing</td><td>Bilateral co-signing</td></tr>
<tr><td><strong>n50.io</strong></td><td>Production</td><td>87 agents, fate-separated verification</td></tr>
<tr><td><strong>AgentGraph</strong></td><td>CTEF vectors</td><td>Byte-match validation</td></tr>
<tr><td><strong>APS</strong></td><td>Receipt schema</td><td>10/10 bilateral-delegation match</td></tr>
</table>

---

## 📋 Standards

| Standard | Status |
|---|---|
| IETF Internet-Draft | [`draft-gogani-nobulex-proof-of-behavior-00`](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) |
| Microsoft AGT | Bilateral receipt merged |
| CTEF v0.3.1 | 14/14 byte-match conformance |
| Verascore Evidence Schema | `nobulex_trust_capital` fixture |
| LangChain RFC #35691 | ComplianceCallbackHandler |
| NIST RFI | Formal comments submitted |

---

<details>
<summary><strong>🔒 Security</strong></summary>
<br/>

✅ Hash chain integrity — property-tested with fast-check<br/>
✅ Signature forgery — rejected 100%<br/>
✅ Replay prevention — audience-bound proofs<br/>
✅ Covenant enforcement — blocked before execution<br/>

See [docs/threat-model.md](./docs/threat-model.md)
</details>

---

## 🛠️ Development

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex && npm install
npx vitest run              # tests
npx tsx examples/demo.ts    # end-to-end
npx tsx benchmarks/bench.ts # benchmarks
```

---

<div align="center">

[Website](https://nobulex.com) · [Try it](https://nobulex.com/try) · [npm](https://www.npmjs.com/org/nobulex) · [IETF Draft](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) · [𝕏 @nobulexlabs](https://x.com/nobulexlabs)

⭐ **[Star this repo](https://github.com/arian-gogani/nobulex/stargazers)** to help others find it

MIT License

</div>
