# Why AI agents need credit scores

AI agents are starting to handle real things: money, data, decisions, and customer interactions. Their operators need records that can be checked outside the original runtime.

## The problem

When a human employee handles money, they have a track record. Background checks. Performance reviews. If they steal, there's a paper trail.

When an AI agent handles money, you get logs. Self-reported logs. Written by the same system you're trying to audit. That's like letting a bank audit itself.

## What we built

Nobulex generates signed receipts for claims about AI agent actions. Each receipt is:

- **Ed25519 signed**: identifies the signing key
- **SHA-256 hashed**: linked to the previous receipt in the chain
- **JCS canonical**: deterministic serialization for supported values
- **Independently checkable**: verification does not require the original runtime

Modify signed content after the fact and signature verification fails. This detects later alteration. It does not prove the action happened, that the fields were true when signed, or that omitted actions do not exist.

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

- **EU AI Act Article 12** requires automatic event logging for high-risk AI systems. It does not require cryptographic signatures or independently verifiable receipts. Current application dates are December 2, 2027 for Annex III systems and August 2, 2028 for Annex I systems.
- **Colorado AI Act** requires accountability for AI making consequential decisions. Deadline: June 30, 2026.
- Salesforce, Microsoft, and Google are all building agent frameworks. None of them solve the accountability gap.

## Open source

MIT licensed. Cross-validated across 4 JCS implementations. Already integrated with LangChain and CrewAI. Referenced in IETF Internet-Drafts and the x402 (Coinbase) ecosystem.

→ [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
