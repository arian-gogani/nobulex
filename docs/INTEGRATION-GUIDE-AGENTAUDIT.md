# Nobulex + AgentAudit Integration Guide

> **Status:** Draft — Architecture and Nobulex side complete.
> AgentAudit on-chain anchoring section is a placeholder for Piotr to fill in.

## TL;DR

Nobulex generates Ed25519-signed cryptographic receipts for AI agent actions, locally. AgentAudit anchors each receipt's digest on-chain across 5 EVM mainnets, durably. The integration gives you pre-execution enforcement plus post-execution immutable evidence in one pipeline.

```python
from nobulex.agent import Agent
from agentaudit import OnChainAnchor

agent = Agent("my-agent")
anchor = OnChainAnchor(network="base", contract="0x...")

receipt = agent.act("transfer_funds", scope="500_USDC_to_vendor")
tx = anchor.persist(receipt)            # one EVM tx, ~2-5s
assert anchor.verify(receipt) == tx     # six months later, still verifiable
```

## Architecture

```
┌─────────────────┐    receipt      ┌──────────────────┐    digest    ┌─────────────┐
│   Your Agent    │ ─────────────→  │  Nobulex (local) │ ───────────→ │ AgentAudit  │
│  (CrewAI,       │   action_type   │   Ed25519 sign   │  contentURI  │  (on-chain) │
│   LangChain,    │   scope         │   JCS canonical  │  SHA-256     │  5 EVMs     │
│   custom)       │   timestamp_ms  │   action_ref     │  keccak256   │             │
└─────────────────┘                 └──────────────────┘              └─────────────┘
                                            │                                │
                                            ▼                                ▼
                                    auditor verifies:                auditor verifies:
                                    - signature                      - on-chain digest
                                    - hash chain                     - timestamp ordering
                                    - canonical form                 - non-repudiation
```

Each layer is independently verifiable. An auditor doesn't have to trust either operator: Nobulex receipts are reproducible from the four-field preimage, and AgentAudit anchors are reproducible from the contentURI + on-chain transaction.

## Why both layers

| Question | Nobulex answers | AgentAudit answers |
|----------|-----------------|---------------------|
| What did the agent claim it did? | ✅ Signed receipt | — |
| Was the receipt tampered with? | ✅ Ed25519 verification fails | — |
| Did the receipt exist at time T? | — | ✅ on-chain block timestamp |
| Was the receipt produced AFTER the fact? | — | ✅ block ordering proves it wasn't |
| Can an auditor verify without trusting the operator? | ✅ recompute action_ref | ✅ read the chain |

Use just Nobulex if you only need tamper-evident local proof. Use both if you need the operator to be unable to backdate receipts after a dispute.

## Receipt format (action-ref-v1)

Every receipt contains a four-field preimage that uniquely identifies the action:

```json
{
  "agent_id": "did:nobulex:specimen-agent-001",
  "action_type": "transfer_funds",
  "scope": "500_USDC_to_vendor_acme",
  "timestamp_ms": 1748769600000
}
```

The `action_ref` is `SHA-256(JCS(preimage))` per RFC 8785. This is the canonical identifier that travels with the receipt across all integrations.

Optional siblings outside the preimage:
- `policy_version` — which policy was in force at issuance
- `attempt_id` — for retry deduplication
- `authority_verified_at_ms` — when the agent's authority was last verified

These don't change `action_ref`, so the same receipt is identifiable across policy rotations.

## Specimen receipt

Full signed specimen with verification recipe:
[fixtures/agentaudit-specimen-v1.json](../fixtures/agentaudit-specimen-v1.json)

Contains:
- One real Ed25519-signed receipt (action_ref `0595aac4...1221`)
- A 3-receipt hash-chain showing the linking
- All four cross-validation vectors (Python + JS produce byte-identical action_refs)
- Inline verification recipe (10 lines of Python)

## Installation

```bash
pip install nobulex          # Nobulex SDK (Python 3.9+)
pip install agentaudit       # AgentAudit SDK (placeholder — Piotr to confirm)
```

## Quickstart

```python
from nobulex.agent import Agent
from nobulex.chain import ReceiptChain

# 1. Create an agent
agent = Agent("kyc-checker-001")

# 2. Single signed receipt
receipt = agent.act(
    action_type="screen_sanctions",
    scope="customer:CUST-92481",
    metadata={"sanctions_list_version": "ofac-2026-05-31"},
)
print(receipt.action_ref)  # 64-char SHA-256 hex
print(receipt.verify())    # True

# 3. Hash-chained audit trail
chain = ReceiptChain(agent_id="customer-onboarding-001")
chain.append("read_kyc_record", scope="customer:CUST-92481")
chain.append("screen_sanctions", scope="customer:CUST-92481")
chain.append("approve_account", scope="customer:CUST-92481")

assert chain.verify()      # tampering with any link breaks the chain
chain.export("audit-trail.json")
```

## On-chain anchoring with AgentAudit

> **Piotr: this section is for you to fill in.** I've sketched the shape based on our thread but you own the canonical version.

### Persistence model

Nobulex receipt → AgentAudit `contentURI` field. The digest stored on-chain is `SHA-256` (matching Nobulex's hash) so a verifier can take the off-chain receipt, recompute `action_ref`, and confirm it matches the on-chain anchor without trusting either party.

Bridge to `keccak256` (EVM-native hash) is via `contentURI`: the URI references the off-chain receipt, the on-chain record stores `keccak256(contentURI)` for EVM-native lookup plus the original SHA-256 for cross-system verification.

### Supported networks

[Piotr to fill in — 5 EVM mainnets]

### Dual-timestamp model

- `issued_at_ms` — when Nobulex signed the receipt (off-chain, in the receipt)
- `anchored_at` — block timestamp when AgentAudit wrote the digest on-chain
- Dispute resolution: a receipt with `issued_at_ms` after `anchored_at - epsilon` is suspect (operator may have backdated). epsilon = your protocol's clock skew tolerance.

[Piotr to confirm the field names and any additional fields]

### Code sketch

```python
from agentaudit import OnChainAnchor

# [Piotr to confirm constructor and method names]
anchor = OnChainAnchor(network="base", rpc_url="...", contract="0x...")

tx_hash = anchor.persist(receipt)
print(f"Anchored on Base: {tx_hash}")

# Later, even months later:
anchor_record = anchor.verify(receipt)
assert anchor_record.action_ref == receipt.action_ref
assert anchor_record.anchored_at_block_timestamp > 0
```

## Verification flow (independent of either operator)

```python
import hashlib
from rfc8785 import dumps as jcs_dumps
from nacl.signing import VerifyKey

# A third party who trusts neither operator:

# 1. Pull the off-chain receipt
receipt = json.loads(open("receipt.json").read())

# 2. Recompute action_ref from preimage
preimage = {
    "agent_id": receipt["agent_id"],
    "action_type": receipt["action_type"],
    "scope": receipt["scope"],
    "timestamp_ms": receipt["timestamp_ms"],
}
canonical = jcs_dumps(preimage)
expected_ref = hashlib.sha256(canonical).hexdigest()
assert expected_ref == receipt["action_ref"]  # nobulex side

# 3. Verify Ed25519 signature
vk = VerifyKey(bytes.fromhex(receipt["signer_public_key"]))
vk.verify(canonical, bytes.fromhex(receipt["signature"]))  # raises if invalid

# 4. Pull the on-chain anchor
# [Piotr: AgentAudit verification recipe goes here]
```

## Conformance

- Nobulex cross-validation: Python + JS implementations produce byte-identical `action_ref` values on the test vector set at `fixtures/bilateral-receipt/v0/vectors.json`.
- AgentAudit cross-validation: [Piotr to fill in]
- Joint specimen: `fixtures/agentaudit-specimen-v1.json` is the canonical reference fixture for the integration.

## What's locked

- ✅ Four-field preimage (`agent_id`, `action_type`, `scope`, `timestamp_ms`)
- ✅ Optional siblings outside preimage (`policy_version`, `attempt_id`, `authority_verified_at_ms`)
- ✅ JCS canonicalization per RFC 8785
- ✅ Ed25519 signature scheme
- ✅ Empty result payload convention: `result_hash = sha256("") = e3b0c442...855`
- ✅ `data_read` scope convention: strict three-segment parse from the right
- ✅ SHA-256 / keccak256 bridge via `contentURI`
- ✅ Dual-timestamp model

## What's open

- The neutral repo for `action-ref-v1` spec (Piotr to spin up `action-ref-spec`)
- AgentAudit on-chain contract addresses per network
- Joint case study + logo

## Status

| Item | Status |
|------|--------|
| Receipt format | ✅ locked, cross-validated |
| Hash chain | ✅ locked, working in PyPI release |
| Specimen fixture | ✅ committed, byte-verified |
| Empty result convention | ✅ locked |
| `data_read` scope | ✅ locked |
| Nobulex SDK on PyPI | ✅ `pip install nobulex` |
| AgentAudit SDK | ⏳ Piotr to publish |
| Joint neutral repo | ⏳ Piotr to spin up |
| On-chain anchoring section | ⏳ Piotr to fill in this doc |
| Joint case study | ⏳ ahead of Aug 2 |

## Authors

- Arian Gogani — Nobulex (nobulex.dev@gmail.com)
- Piotr — AgentAudit / RunLockAI (agentaudit@proton.me)

## License

MIT
