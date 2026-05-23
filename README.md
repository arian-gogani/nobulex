<div align="center">

<img src="./assets/banner.svg" alt="Nobulex — Trust Capital for AI Agents" width="100%"/>

<br/>

[![CI](https://img.shields.io/github/actions/workflow/status/arian-gogani/nobulex/ci.yml?style=flat-square&label=CI&color=22c55e)](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml)
[![OpenSSF](https://img.shields.io/badge/OpenSSF-passing-22c55e?style=flat-square)](https://www.bestpractices.dev/projects/10338)
[![npm](https://img.shields.io/npm/v/@nobulex/core?style=flat-square&color=22c55e)](https://www.npmjs.com/package/@nobulex/core)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](https://opensource.org/licenses/MIT)
[![IETF](https://img.shields.io/badge/IETF-Draft_Published-22c55e?style=flat-square)](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/)

<br/><br/>

**Every person has a credit score. Every business has one.**
**AI agents have nothing.**

Nobulex is the credit and trust protocol for autonomous AI agents.<br/>
Agents earn Trust Capital through verified behavior. Higher trust, more access.<br/>
Autonomy earned, not granted.

[Website](https://nobulex.com) · [Try it live](https://nobulex.com/try) · [Quickstart](./GETTING-STARTED.md) · [IETF Draft](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) · [npm](https://www.npmjs.com/package/@nobulex/core)

</div>

---

## How it works

Every agent action produces a cryptographic receipt -- Ed25519 signed before and after execution, hash-chained for tamper evidence. A third party can verify the full history without trusting the agent or the operator.

Receipts accumulate into **Trust Capital** -- a credit score for the agent.

| Tier | Trust Capital | Access Level |
|------|--------------|--------------|
| Restricted | 0 -- 30 | Read-only, sandboxed execution |
| Standard | 30 -- 60 | Financial ops up to $500, API access |
| Trusted | 60 -- 85 | Cross-org operations, regulated markets |
| Sovereign | 85+ | Full autonomy, self-directed |

Agents that create more value earn more access. Agents that deviate get cut off automatically. Not as punishment -- as math.

---

## Quick start

### Python (recommended for AI agents)

```bash
# Install from source (PyPI coming soon)
pip install git+https://github.com/arian-gogani/nobulex.git#subdirectory=packages/python
```

```bash
# Or try the CLI demo instantly
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python
pip install -e .
python -m nobulex demo
```

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")
assert receipt.verify()       # Cryptographic proof
print(agent.trust_score)      # Trust Capital: 13.86
```

#### LangChain integration (2 lines)

```python
from nobulex.langchain import NobuReceipts
wrapped = NobuReceipts.wrap(your_agent, "my-agent")
# Every tool call now generates a tamper-proof receipt
```

### JavaScript / TypeScript

```bash
npm install @nobulex/core
npx tsx examples/trust-capital-demo.ts
```

```
Agent starts at RESTRICTED tier (Trust Capital: 0)

Action 1: read_data       — ALLOWED   (Trust Capital: 12)
Action 2: read_data       — ALLOWED   (Trust Capital: 24)
Action 3: process_payment — BLOCKED   (insufficient trust)
Action 4: read_data       — ALLOWED   (Trust Capital: 36)
Action 5: read_data       — ALLOWED   (Trust Capital: 48)

Agent promoted to STANDARD tier
Action 6: process_payment — ALLOWED   (Trust Capital: 65)

Agent promoted to TRUSTED tier (Trust Capital: 89)
Action 8: approve_contract — ALLOWED
```

---

## The protocol

```
DECLARE ──► ENFORCE ──► PROVE ──► ACCUMULATE

Covenant      Pre-execution     Receipt chain     Trust Capital
defines       receipt blocks    verified by       earned over
the rules     violations        third parties     time
              before they
              happen                              ──► more access
                                                      ──► more receipts
                                                           ──► higher trust
```

The flywheel: more Trust Capital leads to more valuable work, which produces more receipts, which builds higher Trust Capital. Accountability becomes the most profitable strategy.

---

## Code

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
  { action: 'transfer', params: { amount: 300 } },  // allowed
  async () => ({ success: true }),
);

await mw.execute(
  { action: 'transfer', params: { amount: 600 } },  // BLOCKED before execution
  async () => ({ success: true }),                    // never runs
);

const result = verify(spec, mw.getLog());
console.log(result.compliant);   // true
```

---

## Traction

| | Partner | Integration |
|---|---|---|
| | **Microsoft** | Merged receipt primitive into [Agent Governance Toolkit](https://github.com/microsoft/agt) |
| | **VISA** | Trusted Agent Protocol testing against receipt format |
| | **AlgoVoi** | 14/14 CTEF byte-match conformance in production across 8 chains |
| | **Dominion Observatory** | Pre-call trust scores for 14,800+ MCP servers |
| | **Agent Community** | ATF Verifiability Gate + COMMITTED Claim reference |
| | **Verascore** | `nobulex_trust_capital` conformance evidence class |
| | **OpenLineage** | Linux Foundation accepted into ecosystem |
| | **n50.io** | 87 autonomous agents, 3 months production |
| | **10+ implementations** | Cross-validated byte-identical output, no coordination |

Active discussions on **OpenAI**, **Google ADK**, **CrewAI**, **HuggingFace**, **AutoGen**, **Coinbase AgentKit**, **LangChain**, and **A2A Protocol**.

---

## Why now

AI agents are being deployed into production with no accountability infrastructure.

- **86%** of AI agents deployed without security approval (CSA, 2026)
- **UUMit** launched the first A2A marketplace with zero identity verification
- **$138B+** committed to physical AI with zero accountability layer
- Top models score **10-15%** on real problems (LemmaBench) with zero traceability on failure

The agents are deployed. The money is flowing. The accountability infrastructure doesn't exist yet. We're building it.

---

## Standards

| Standard | Status |
|---|---|
| IETF Internet-Draft | [`draft-gogani-nobulex-proof-of-behavior-00`](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) |
| Microsoft AGT | Bilateral receipt merged |
| CTEF v0.3.1 | 14/14 byte-match conformance |
| A2A Protocol | URN scheme registered: `urn:nobulex:receipt:<id>` |
| NIST RFI | Formal comments submitted |

---

## Development

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex && npm install
npx vitest run              # tests
npx tsx examples/demo.ts    # end-to-end
npx tsx benchmarks/bench.ts # benchmarks
```

---

<div align="center">

[Website](https://nobulex.com) · [Try it](https://nobulex.com/try) · [npm](https://www.npmjs.com/org/nobulex) · [IETF Draft](https://datatracker.ietf.org/doc/draft-gogani-nobulex-proof-of-behavior/) · [X @nobulexlabs](https://x.com/nobulexlabs)

**[Star this repo](https://github.com/arian-gogani/nobulex/stargazers)** to follow the project

MIT License

</div>
