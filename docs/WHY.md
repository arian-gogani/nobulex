# Why AI agents need credit scores

AI agents are starting to handle real things  - money, data, decisions, customer interactions. But there's no way to know which agents deserve trust and which ones don't.

## The problem

When a human employee handles money, they have a track record. Background checks. Performance reviews. If they steal, there's a paper trail.

When an AI agent handles money, you get logs. Self-reported logs. Written by the same system you're trying to audit. That's like letting a bank audit itself.

## What we built

Nobulex generates tamper-proof cryptographic receipts for every AI agent action. Each receipt is:

- **Ed25519 signed**  - proves who generated it
- **SHA-256 hashed**  - linked to the previous receipt in the chain
- **JCS canonical**  - deterministic across implementations (RFC 8785)
- **Independently verifiable**  - no trust in the operator required

Modify anything after the fact and the signature breaks.

## 4 lines of Python

```python
from nobulex import Agent

agent = Agent("payment-bot")
receipt = agent.act("transfer_funds", scope="100 USDC")
assert receipt.verify()  # True
```

## Receipts accumulate into trust score

Every verified receipt builds the agent's reputation. Over time, agents earn autonomy:

- **New agents**: restricted permissions, human approval required
- **Proven agents**: expanded scope, higher transaction limits
- **Trusted agents**: autonomous operation within their covenant

The score follows the agent, not the operator. You can copy the code but you can't copy the score.

## Why now

- **EU AI Act Article 12** requires tamper-evident audit logs for high-risk AI systems. Deadline: December 2, 2027.
- **Colorado AI Act** requires accountability for AI making consequential decisions. Deadline: June 30, 2026.
- Salesforce, Microsoft, and Google are all building agent frameworks. None of them solve the accountability gap.

## Open source

MIT licensed. Cross-validated across 4 JCS implementations. Already integrated with LangChain and CrewAI. Referenced in IETF Internet-Drafts and the x402 (Coinbase) ecosystem.

→ [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
