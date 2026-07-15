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

## Verify API (live)

The SDK produces receipts locally. The hosted API verifies them:

```bash
# See a live tamper detection demo
curl https://nobulex.com/api/verify?action=demo

# Verify a receipt
curl -X POST https://nobulex.com/api/verify \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"my-agent","action_type":"tool:search","scope":"q=test","timestamp_ms":1720000000000,"action_ref":"..."}'
```

[API docs](https://nobulex.com/api-docs) |
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
