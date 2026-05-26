# Nobulex Integration Guide

## Quick Start

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("transfer_funds", scope="100 USDC to vendor")

print(receipt.action_ref)   # SHA-256 hash (deterministic)
print(receipt.verify())     # True
print(receipt.to_json())    # Full receipt
```

## Receipt Fields

### Preimage (locked, inside action_ref hash)
- `agent_id`: string
- `action_type`: string
- `scope`: string
- `timestamp_ms`: integer (epoch milliseconds)

### Siblings (outside hash, optional)
- `policy_version`: which rules were active
- `attempt_id`: for retry deduplication
- `authority_verified_at_ms`: when authority was last confirmed
- `revocation_check_at_ms`: when credentials were confirmed valid

### Generated
- `action_ref`: SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))
- `verdict`: ALLOW or DENY
- `signature`: Ed25519 over the full receipt
- `public_key`: verifier's public key

## Receipt Chains

```python
from nobulex.chain import ReceiptChain

chain = ReceiptChain("compliance-agent")
chain.append("authenticate", scope="api.stripe.com")
chain.append("check_compliance", scope="aml_screening")
chain.append("create_payment", scope="100_USDC")

print(chain.verify())        # True
chain.export("audit.json")   # Export for auditors
```

## LangChain Integration

```python
from nobulex.langchain import NobulexCallbackHandler

handler = NobulexCallbackHandler(agent_id="langchain-bot")
# Pass to any LangChain agent as a callback
```

## CrewAI Integration

```python
from nobulex.crewai import NobulexTracker

tracker = NobulexTracker(agent_id="crew-member")
# Wrap CrewAI task execution
```

## Verification

```python
# Verify a single receipt
assert receipt.verify()  # checks Ed25519 signature

# Tamper detection
receipt.scope = "MODIFIED"
assert not receipt.verify()  # signature breaks

# Verify a chain
assert chain.verify()  # checks all signatures + hash links
```

## On-Chain Anchoring (AgentAudit AI)

```
action_ref -> bytes32 logHash in AuditVault.verifyLog()
```

The action_ref maps directly to the on-chain anchor. The SHA-256/keccak256 bridge is documented in the AgentAudit integration spec.

## Test Vectors

```
fixtures/bilateral-receipt/v0/vectors.json
```

4 vectors, cross-validated across Python (rfc8785), JS (canonicalize), Go (gowebpki/jcs), Java (cyberphone).
