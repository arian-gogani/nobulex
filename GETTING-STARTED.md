# Getting Started with Nobulex

**Credit scores for AI agents. Every action builds a verifiable track record.**

Five minutes to your first verifiable receipt.

---

## Install

```bash
pip install nobulex
```

Or from source:

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python
pip install -e .
```

## See it work

```bash
python -m nobulex demo
```

Output:

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

## First receipt in code

```python
from nobulex import Agent

agent = Agent("my-agent")

# Every action produces a signed receipt
receipt = agent.act("send_email", scope="user@example.com")
assert receipt.verify()        # Ed25519 signature checks out

# A denied action is recorded too
agent.deny("delete_db", scope="production")

# Receipts accumulate into trust score
print(agent.trust_score)
```

## Verify a receipt from the command line

```bash
python -m nobulex verify receipt.json
```

Anyone can verify a receipt without trusting you or your infrastructure. That is the point: the proof travels with the receipt.

---

## JavaScript / TypeScript

```bash
npm install @nobulex/core
```

---

## Verify a receipt

Receipts verify **offline** — no server, no network, no callback to Nobulex.
Verification recomputes `action_ref` from the record and checks the Ed25519
signature against the agent's published public key:

```python
from nobulex.agent import Agent

agent = Agent("billing-bot")
receipt = agent.act("charge", scope="invoice:042")
assert receipt.verify()   # recomputes action_ref + checks the signature, fully offline
```

JavaScript/TypeScript verification uses `@nobulex/core`
(`verifyCovenant`, `verify`, `verifyEvidenceChain`) — see `packages/core/README.md`.

### Hosted verification API

A hosted verification service — rate-limited tiers, agent trust scores, and
chain/bundle compliance reports — lives in `packages/verify-api/`
(`pip install flask nobulex && python server.py`, Dockerfile included).
It is **not yet deployed to nobulex.com**; verify offline with the SDK today.

[Pricing](https://nobulex.com/pricing) |
[Methodology](https://nobulex.com/methodology)

---

## Framework examples

Working examples for PydanticAI, CrewAI, LangChain, Google ADK,
Haystack, and LlamaIndex in `packages/python/examples/`.

---

## Next steps

- [EU AI Act mapping](./docs/eu-ai-act-mapping.md)  - article-by-article
- [Examples](./examples/README.md)  - runnable samples
- [Proof-of-Behavior spec](./docs/proof-of-behavior-spec.md)  - the receipt format
