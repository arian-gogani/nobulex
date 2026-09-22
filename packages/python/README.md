# nobulex

> **Status:** This package is a prior Nobulex direction and is maintained for compatibility. Current work is in the [Nobulex registry](https://github.com/arian-gogani/nobulex-registry). Version 0.1.2 corrects the claims published with 0.1.1. It does not add a claim that receipts prove real-world events.

**Signed claims about AI agent actions.**

Credit scores exist for people. They don't exist for machines. Until now.

## Install

```bash
pip install nobulex
```

## Quick Start

**One line to add receipts to any function:**

```python
from nobulex import track

@track(agent_id="my-agent")
def send_email(to, subject, body):
    return smtp.send(to, subject, body)

# Every decorated call produces a signed receipt. Exceptions produce DENY receipts.
send_email("user@example.com", "Hello", "Report attached")
print(send_email.receipts)     # tamper-evident
print(send_email.trust_score)  # accumulates over time
```

**Or use the Agent API directly:**

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")
assert receipt.verify()  # Ed25519 signature check
print(receipt.action_ref)  # SHA-256 hash of the action

# trust score builds with every verified action
print(agent.trust_score)  # 13.86

# Denied actions prove the system caught violations
agent.deny("delete_database", scope="production")
print(agent.trust_score)  # 15.22
```

## What is this?

Every time an AI agent does something, Nobulex generates a **cryptographic receipt**:

- **WHO** acted (agent_id)
- **WHAT** they did (action_type)
- **ON WHAT** (scope)
- **WHEN** (timestamp_ms)
- **WHETHER** it was allowed (verdict)
- **SIGNED CLAIM** about the action (Ed25519 signature + SHA-256 hash)

Receipts are tamper **evident**, not tamper proof. Editing one after the fact breaks the hash chain, so the edit is detectable by anyone holding a later receipt. That is a different and weaker property than being unfakeable, and the difference matters: an operator who chooses what to record can omit an action, misstate an outcome, or sign an inaccurate account at the moment it happens, and every cryptographic property here still holds. A signature proves who made a claim. It does not prove the claim was true.

What this does give you is that an independent verifier can check the signature without running the original agent and detect changes to the signed content.

Over time, receipts build into **trust score**  - a portable trust score that follows the agent across deployments. You can copy an agent's code, but you can't copy its credit score. The copy starts at zero.

## Use Cases

- **Audit trails**: EU AI Act Article 12 requires automatic event logging for high-risk systems. It does not require cryptographic signatures or independently verifiable receipts. Signed receipts address a separate need: detecting later changes when evidence must survive a dispute.
- **Agent-to-agent trust**: Agents verify each other's track records before collaborating
- **Disputes**: Records a counterparty can check themselves, for financial, healthcare and legal agents
- **Accountability**: When something goes wrong, receipts show what was recorded at the time, and show whether that record has been altered since

## API

### Agent

```python
from nobulex import Agent

agent = Agent("my-agent")          # Create agent identity
receipt = agent.act("tool_call",   # Record an action
                    scope="api.stripe.com")
agent.deny("unauthorized_action",  # Record a caught violation
           scope="admin_panel")
print(agent.trust_score)           # Get trust score score
print(agent.receipts)              # Get all receipts
```

### Receipt

```python
from nobulex import Receipt, KeyPair

keys = KeyPair()
receipt = Receipt.create(
    agent_id="agent-1",
    action_type="send_email",
    scope="user@example.com",
    keys=keys,
)
assert receipt.verify()            # Verify signature
print(receipt.action_ref)          # Content-addressable hash
print(receipt.to_json())           # JSON serialization
```

## Framework Examples

Working examples for all 6 supported frameworks (each runs standalone):

```bash
python examples/pydantic_ai_receipts.py   # PydanticAI
python examples/crewai_receipts.py        # CrewAI
python examples/langchain_receipts.py     # LangChain
python examples/google_adk_receipts.py    # Google ADK
python examples/haystack_receipts.py      # Haystack
python examples/llamaindex_receipts.py    # LlamaIndex
```

## Verify API

The SDK is free. The hosted verification layer is the product.

```bash
curl -X POST https://api.nobulex.com/v1/verify \
  -d '{"agent_id":"my-agent","action_type":"tool:search",...}'
```

[Pricing](https://nobulex.com/pricing) |
[API docs](https://nobulex.com/api-docs) |
[Methodology](https://github.com/arian-gogani/nobulex/blob/main/docs/trust-capital-methodology.md)

## License

MIT - Arian Gogani (@nobulexlabs)
