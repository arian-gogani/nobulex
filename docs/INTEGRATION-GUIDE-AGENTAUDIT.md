# Nobulex + AgentAudit AI — Integration Guide

## Overview

**Nobulex** generates tamper-evident receipts locally at each agent action.  
**AgentAudit AI** anchors the cryptographic proof on-chain across 5 EVM mainnets.

Together: pre-execution enforcement + post-execution immutable evidence = full EU AI Act Article 12 coverage.

## Architecture

```
Agent Action → Nobulex Receipt (Ed25519 signed, local)
                    ↓
              AgentAudit Anchor (on-chain, immutable)
                    ↓
              Verifiable by any third party
```

## Quick Start

### 1. Install

```bash
pip install nobulex
# AgentAudit: see https://github.com/agentauditAI/agentaudit
```

### 2. Generate Receipts

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("tool_call", scope="search_web:query_terms")
assert receipt.verify()  # Ed25519 signature check
```

### 3. Anchor On-Chain

```python
# Submit receipt to AgentAudit for on-chain anchoring
# AgentAudit uses the action_ref as the idempotency key
agentaudit.anchor(receipt.action_ref, receipt.export())
```

## Cross-Validation

Both systems produce **byte-identical digests** from the same input:

```
action_ref = SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))
```

Confirmed 2026-05-27: nobulex Python SDK and AgentAudit produce identical `action_ref` values for the same preimage.

## Receipt Format

| Field | Description |
|---|---|
| `agent_id` | Agent identifier |
| `action_type` | What the agent did |
| `scope` | Context/parameters |
| `timestamp_ms` | Epoch milliseconds |
| `action_ref` | SHA-256(JCS(preimage)) |
| `signature` | Ed25519 detached signature |
| `verdict` | ALLOW or DENY |

## EU AI Act Compliance

Article 12 requires "automatic recording of events" that "cannot be modified."

- **Nobulex**: Ed25519 signatures ensure receipts cannot be modified
- **AgentAudit**: On-chain anchoring ensures receipts cannot be deleted
- **Together**: Full tamper-evidence for Article 12

Enforcement deadline: **August 2, 2026**

## Links

- Nobulex: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
- AgentAudit AI: [github.com/agentauditAI/agentaudit](https://github.com/agentauditAI/agentaudit)
- Cross-validation: [nobulex#5](https://github.com/arian-gogani/nobulex/issues/5)
