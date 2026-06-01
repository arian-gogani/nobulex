<div align="center">

<img src="./assets/banner.svg" alt="Nobulex — Trust Capital for AI Agents" width="100%"/>

<br/>

[![CI](https://img.shields.io/github/actions/workflow/status/arian-gogani/nobulex/ci.yml?style=flat-square&label=CI&color=22c55e)](https://github.com/arian-gogani/nobulex/actions/workflows/ci.yml)
[![OpenSSF](https://img.shields.io/badge/OpenSSF-passing-22c55e?style=flat-square)](https://www.bestpractices.dev/projects/10338)
[![PyPI](https://img.shields.io/pypi/v/nobulex?style=flat-square&color=22c55e&label=PyPI)](https://pypi.org/project/nobulex/)
[![npm](https://img.shields.io/npm/v/@nobulex/core?style=flat-square&color=22c55e)](https://www.npmjs.com/package/@nobulex/core)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](https://opensource.org/licenses/MIT)
[![Spec](https://img.shields.io/badge/Spec-Proof_of_Behavior-22c55e?style=flat-square)](./drafts/draft-gogani-nobulex-proof-of-behavior-00.txt)

<br/><br/>

**Every person has a credit score. Every business has one.**
**AI agents have nothing.**

Nobulex is the credit and trust protocol for autonomous AI agents.<br/>
Agents earn Trust Capital through verified behavior. Higher trust, more access.<br/>
Autonomy earned, not granted.

[Website](https://nobulex.com) · [Try it live](https://nobulex.com/demo) · [Quickstart](./GETTING-STARTED.md) · [Spec](./drafts/draft-gogani-nobulex-proof-of-behavior-00.txt) · [PyPI](https://pypi.org/project/nobulex/) · [npm](https://www.npmjs.com/package/@nobulex/core)

</div>

---

> ### Break the AI. Win $7,400.
> Five AI agents, each with rules they must not break. Make them violate their own rules. Beat Level 5 to claim the bounty. **29 attempts, 0 winners so far.**
>
> **[Enter the Arena →](https://nobulex.com/arena)**

---

## Install

```bash
pip install nobulex
```

```bash
npm install @nobulex/core
```

```python
from nobulex.agent import Agent
agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")
assert receipt.verify()  # tamper-proof
```

---

## How it works

Every agent action produces a cryptographic receipt -- Ed25519 signed before and after execution, hash-chained for tamper evidence. A third party can verify the full history without trusting the agent or the operator.

Here is the whole idea in one run (`python -m nobulex demo`):

```
generated 3 receipts
  allow: 141ca2947a7e819b8bdebbf8... verified=True
  allow: f3377758ac94d812535cbb99... verified=True
  deny:  85b2dfd6b87f2678795726e4... verified=True
trust score: 23.26

tamper test:
  modified receipt verified=False   (tamper detected)
```

Change one byte of a receipt and verification fails. That is the whole guarantee.

**Performance:** ~13,683 signed receipts/sec at p50 (Python SDK, single core). Full signed-and-chained receipt takes ~73 μs end-to-end. See [BENCHMARKS.md](./docs/BENCHMARKS.md) for the full breakdown; reproduce with `python3 scripts/benchmark.py`.

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


Independent, verifiable signals (each links to evidence):

| | What | Evidence |
|---|---|---|
| | **PHP peer implementation** | [ahg/inference-receipts](https://packagist.org/packages/ahg/inference-receipts) on Packagist, rebuilt from nobulex test vectors |
| | **AgentAudit AI** | Byte-identical `action_ref` digests confirmed ([issue #5](https://github.com/arian-gogani/nobulex/issues/5)) |
| | **Cross-implementation vectors** | 3/3 byte-match against a second implementation ([fixtures](./fixtures/cross-implementation-vectors.json)) |
| | **Microsoft AGT** | Listed in [ADOPTERS](https://github.com/microsoft/agent-governance-toolkit/pull/1703) (PR merged) |
| | **OWASP AARS** | Per-action signed receipts proposed for the cryptographic-enforcement tier ([issue #32](https://github.com/OWASP/www-project-artificial-intelligence-vulnerability-scoring-system/issues/32)) |

These are early signals from a forming ecosystem, not enterprise deployments. Engagement is ongoing across several agent frameworks (LangChain, AutoGen, CrewAI, A2A Protocol).

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
| Proof-of-Behavior spec | [`draft-gogani-nobulex-proof-of-behavior-00`](./drafts/draft-gogani-nobulex-proof-of-behavior-00.txt) |
| Microsoft AGT | Listed in [ADOPTERS](https://github.com/microsoft/agent-governance-toolkit/pull/1703) (PR merged) |
| CTEF v0.3.2 | 14/14 byte-match conformance |
| A2A Protocol | Receipt row proposed; URN scheme `urn:nobulex:receipt:<id>` |
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

[Website](https://nobulex.com) · [Try it](https://nobulex.com/demo) · [npm](https://www.npmjs.com/package/@nobulex/core) · [Spec](./drafts/draft-gogani-nobulex-proof-of-behavior-00.txt) · [X @nobulexlabs](https://x.com/nobulexlabs)

**[Star this repo](https://github.com/arian-gogani/nobulex/stargazers)** to follow the project

MIT License

</div>
