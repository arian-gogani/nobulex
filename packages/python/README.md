# nobulex

**Credit scores for AI agents. Every action builds a verifiable track record.**

Credit scores exist for people. They don't exist for machines. Until now.

## Install

```bash
pip install nobulex
```

## Quick Start (5 minutes)

```python
from nobulex import Agent

# Create an agent with a cryptographic identity
agent = Agent("my-agent")

# Every action generates a signed receipt
receipt = agent.act("send_email", scope="user@example.com")

# Receipts are cryptographically verifiable
assert receipt.verify()  # Ed25519 signature check
print(receipt.action_ref)  # SHA-256 hash of the action

# Trust Capital builds with every verified action
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
- **PROOF** it happened (Ed25519 signature + SHA-256 hash)

Receipts are tamper-proof. You can't edit them after the fact. You can't fake them. An independent verifier can check any receipt without trusting the agent.

Over time, receipts build into **Trust Capital**  - a portable trust score that follows the agent across deployments. You can copy an agent's code, but you can't copy its credit score. The copy starts at zero.

## Use Cases

- **Audit trails**: Prove what your agent did to regulators (EU AI Act Article 12)
- **Agent-to-agent trust**: Agents verify each other's track records before collaborating
- **Compliance**: Tamper-evident records for financial, healthcare, and legal agents
- **Accountability**: When something goes wrong, receipts prove what happened

## API

### Agent

```python
from nobulex import Agent

agent = Agent("my-agent")          # Create agent identity
receipt = agent.act("tool_call",   # Record an action
                    scope="api.stripe.com")
agent.deny("unauthorized_action",  # Record a caught violation
           scope="admin_panel")
print(agent.trust_score)           # Get Trust Capital score
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

## License

MIT  - Arian Gogani (@nobulexlabs)
