# Stele Protocol Specification

**Version 0.1.0 — Draft**

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction](#2-introduction)
3. [Covenant Protocol](#3-covenant-protocol)
4. [Agent Identity](#4-agent-identity)
5. [Enforcement](#5-enforcement)
6. [Trustless Verification](#6-trustless-verification)
7. [Reputation](#7-reputation)
8. [Breach Propagation](#8-breach-propagation)
9. [Chain Composition](#9-chain-composition)
10. [Web of Trust](#10-web-of-trust)
11. [Governance](#11-governance)
12. [Security Analysis](#12-security-analysis)

---

## 1. Abstract

Autonomous AI agents are executing consequential actions — transferring funds, signing contracts, deploying infrastructure, negotiating on behalf of principals — with no protocol-level mechanism to hold them accountable. Existing approaches rely on operator-controlled logs, platform-specific audit trails, and post-hoc forensics conducted by the same parties whose behavior is in question. There is no way for an independent third party to verify what an agent committed to doing before it acted, or to confirm that its actions remained within declared bounds. The accountability gap grows in direct proportion to agent autonomy.

Stele is a cryptographic protocol that introduces **behavioral commitments** as a first-class primitive for AI agents. Before acting, an agent inscribes a covenant — a signed, content-addressed document specifying its intended behavior, constraints, and scope. During operation, every action is logged against this covenant in a tamper-evident structure. After execution, any party can independently verify compliance without access to the agent, its operator, or any privileged system. The protocol requires no trusted intermediary. Verification is deterministic and reproducible from the proof alone.

The protocol provides the following properties: **immutability** (covenants cannot be modified after inscription), **completeness** (all observable actions are captured in the audit log), **independent verifiability** (verification requires only the covenant, the action log, and the proof — no oracle, no API call, no trust assumption), **composability** (covenants can be chained and delegated while maintaining monotonic constraint narrowing), and **economic accountability** (agents build non-transferable reputation through verifiable execution history, with cryptoeconomic consequences for breach).

---

## 2. Introduction

Every prior accountability system for software assumes a simple model: a human writes code, the code runs, the human is responsible. Logs exist for debugging. Audits exist for compliance. The chain of responsibility terminates at a person or an organization.

AI agents break this model. An agent that autonomously decides which API to call, which contract to sign, or which trade to execute is not a tool being wielded — it is an actor making decisions. The human who deployed it may not have anticipated its specific actions. The platform hosting it may not have visibility into its reasoning. The counterparty interacting with it has no way to distinguish between an agent operating within its principal's intent and one that has drifted, been compromised, or was never properly constrained.

This is not a hypothetical problem. Agents already manage portfolios, execute code in production environments, interact with other agents, and operate with increasing autonomy. The economic value under agent control is growing exponentially. Yet the accountability infrastructure is identical to what existed before agents: server logs controlled by operators, platform dashboards controlled by vendors, and trust assumptions that collapse exactly when they matter most.

Cryptographic accountability for AI agents is a new primitive because the problem it solves — holding a non-human autonomous actor accountable to commitments it made before acting — has never existed at scale. Traditional digital signatures prove that a message was sent by a particular key. Stele extends this to prove that an *entire sequence of behavior* conformed to a *declared specification*. The unit of accountability is not a single message but a complete execution trace, verified against a pre-committed behavioral contract.

The Stele protocol makes three claims:

1. **Accountability must be structural, not operational.** It cannot depend on the cooperation of the party being held accountable. It must be embedded in the protocol, not the application.

2. **Verification must be trustless.** Any party — a counterparty, a regulator, an automated monitor, another agent — must be able to verify compliance using only publicly available data and deterministic computation.

3. **Reputation must be non-transferable and economically meaningful.** An agent's track record must be bound to its identity, resistant to sybil attacks, and carry real economic consequences for breach.

---

## 3. Covenant Protocol

### 3.1 Overview

A **covenant** is the fundamental unit of the Stele protocol. It is a signed, content-addressed document in which an agent declares what it will do, what it will not do, and the constraints under which it will operate. Covenants are inscribed before execution begins and are immutable once published.

### 3.2 Document Format

A covenant is a JSON document conforming to the following canonical schema:

```json
{
  "stele": "0.1.0",
  "kind": "covenant",
  "id": "<content-address>",
  "agent": "<agent-identity>",
  "parent": "<parent-covenant-id | null>",
  "timestamp": "<ISO-8601 UTC>",
  "expires": "<ISO-8601 UTC | null>",
  "scope": {
    "description": "<human-readable scope>",
    "capabilities": ["<capability-uri>"],
    "resources": ["<resource-pattern>"]
  },
  "constraints": {
    "ccl": "<CCL expression>",
    "parameters": {}
  },
  "metadata": {},
  "signature": "<Ed25519 signature over canonical form>"
}
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `stele` | string | Protocol version. Follows semver. |
| `kind` | string | Document type. Always `"covenant"` for covenants. |
| `id` | string | Content address (SHA-256 of canonical form, hex-encoded). Computed, not supplied. |
| `agent` | string | Agent identity (see §4). |
| `parent` | string \| null | Content address of the parent covenant, or `null` for root covenants. |
| `timestamp` | string | ISO-8601 UTC timestamp of inscription. |
| `scope.capabilities` | string[] | List of capability URIs the agent is authorized to exercise. |
| `scope.resources` | string[] | Glob patterns specifying the resources the agent may access. |
| `constraints.ccl` | string | Constraint expression in Covenant Constraint Language. |
| `signature` | string | Ed25519 signature over the canonical form (see §3.5). |

### 3.3 Covenant Constraint Language (CCL)

CCL is a declarative, pure-functional constraint language for expressing behavioral bounds. It is intentionally limited — CCL expressions are total functions (they always terminate) and side-effect free.

**Grammar (EBNF):**

```ebnf
expression   = clause { "AND" clause } ;
clause       = "ALLOW" predicate
             | "DENY" predicate
             | "REQUIRE" predicate
             | "LIMIT" metric comparator value
             | "WHEN" predicate "THEN" expression ;
predicate    = capability [ "ON" resource ] [ "WHERE" condition ] ;
capability   = identifier { "." identifier } ;
resource     = pattern ;
condition    = field comparator value { ("AND" | "OR") field comparator value } ;
comparator   = "==" | "!=" | "<" | ">" | "<=" | ">=" ;
metric       = identifier ;
value        = number | string | boolean | duration | amount ;
```

**Semantics:**

- `ALLOW` explicitly permits a capability. Capabilities not explicitly allowed are denied by default (deny-by-default semantics).
- `DENY` explicitly prohibits a capability. DENY takes precedence over ALLOW at the same scope level.
- `REQUIRE` mandates that a condition hold throughout execution. A REQUIRE violation is an immediate breach.
- `LIMIT` bounds a quantitative metric (e.g., transaction count, total value, rate).
- `WHEN...THEN` introduces conditional constraints that activate only when the predicate is satisfied.

**Example:**

```
ALLOW transfer ON "treasury/*"
  WHERE amount <= 10000 AND currency == "USDC"
DENY transfer ON "treasury/reserves"
LIMIT transfer.count <= 50 per 24h
REQUIRE audit.log.enabled == true
WHEN transfer.amount > 5000 THEN REQUIRE approval.multisig >= 2
```

### 3.4 Evaluation Model

CCL expressions are evaluated against an **action record** — a structured representation of a single agent action. The evaluator returns one of three results:

| Result | Meaning |
|---|---|
| `PERMIT` | The action satisfies all applicable constraints. |
| `BREACH` | The action violates one or more constraints. The violated constraints are identified. |
| `UNDETERMINED` | The action falls outside the scope of the covenant (no matching capability). Treated as `BREACH` under deny-by-default. |

Evaluation is deterministic: the same covenant and action record always produce the same result. There is no ambient state, no external oracle, and no randomness in evaluation.

### 3.5 Canonical Form and Signing

The canonical form of a covenant is computed by:

1. Removing the `id` and `signature` fields.
2. Serializing the remaining JSON with keys sorted lexicographically at every nesting level.
3. Encoding as UTF-8 with no trailing whitespace or newline.

The `id` is the SHA-256 hash of the canonical form, hex-encoded. The `signature` is an Ed25519 signature over the canonical form bytes, using the agent's signing key.

### 3.6 Verification

To verify a covenant:

1. Strip `id` and `signature` from the document.
2. Compute the canonical form.
3. Verify that SHA-256(canonical form) equals the claimed `id`.
4. Verify the Ed25519 signature against the agent's public key.

If any step fails, the covenant is invalid. Invalid covenants MUST be rejected by all protocol participants.

---

## 4. Agent Identity

### 4.1 Composite Identity Model

An agent's identity in Stele is not a single key but a **composite identity** comprising multiple facets:

```json
{
  "stele": "0.1.0",
  "kind": "identity",
  "id": "<content-address>",
  "signingKey": "<Ed25519 public key>",
  "model": {
    "provider": "<model provider>",
    "family": "<model family>",
    "version": "<model version or checkpoint>"
  },
  "operator": {
    "entity": "<operating entity identifier>",
    "contact": "<contact URI>"
  },
  "lineage": "<parent-identity-id | null>",
  "evolution": {
    "policy": "<evolution-policy>",
    "carryForward": <0.0-1.0>
  },
  "created": "<ISO-8601 UTC>",
  "signature": "<Ed25519 signature>"
}
```

This composite structure captures the reality that an AI agent's identity is a function of its model, its operator, and its cryptographic key material — not any one of these alone. Two agents running the same model under different operators are different identities. The same operator running different models produces different identities.

### 4.2 Lineage Chains

Agents evolve. Models are updated, fine-tuned, retrained. An agent's identity must accommodate this without either (a) losing its history or (b) pretending nothing changed.

A **lineage chain** is a sequence of identity documents linked by the `lineage` field. Each identity document points to its predecessor. The chain is append-only — identities cannot be removed or reordered.

```
identity_v1 (lineage: null)
  └── identity_v2 (lineage: identity_v1.id)
        └── identity_v3 (lineage: identity_v2.id)
```

To update an identity, the agent creates a new identity document with the `lineage` field pointing to the previous identity's content address. The new document must be signed by the *previous* identity's signing key, proving continuity of control. The new identity may introduce a new signing key.

### 4.3 Evolution Policy

The `evolution.policy` field declares the conditions under which this identity may produce a successor. Supported policies:

| Policy | Description |
|---|---|
| `key-rotation` | Only the signing key changes. Model and operator remain identical. |
| `model-update` | The model version changes within the same family. |
| `model-migration` | The model family changes entirely. |
| `operator-transfer` | The operating entity changes. |
| `full-evolution` | Any combination of changes is permitted. |

Each policy implies a maximum `carryForward` rate (see §4.4). More disruptive changes carry forward less reputation.

### 4.4 Carry-Forward Rates

When an agent evolves its identity, it does not automatically inherit its predecessor's full reputation. The **carry-forward rate** determines what fraction of accumulated reputation survives the transition.

| Evolution Type | Maximum Carry-Forward |
|---|---|
| `key-rotation` | 1.0 |
| `model-update` | 0.8 |
| `model-migration` | 0.4 |
| `operator-transfer` | 0.2 |
| `full-evolution` | 0.1 |

The declared `carryForward` in the identity document must not exceed the maximum for its `policy`. This prevents an agent from claiming full reputation continuity through a disruptive identity change.

Carry-forward is multiplicative across the chain. An agent that undergoes a `model-update` (0.8) followed by an `operator-transfer` (0.2) retains at most 0.8 × 0.2 = 0.16 of its original reputation.

---

## 5. Enforcement

### 5.1 Architecture

Enforcement in Stele operates at two layers: **real-time gating** (preventing violations before they occur) and **post-hoc auditing** (detecting violations after the fact). Neither layer depends on the other; both can operate independently.

### 5.2 Monitor

The **Monitor** is a process that observes agent actions in real time, evaluates each action against the active covenant, and records the result. The Monitor does not have authority to halt the agent — it is a passive observer that produces a tamper-evident log.

```
Agent Action → Monitor → CCL Evaluator → Action Record → Audit Log
```

The Monitor is intentionally separated from the enforcement gate. This separation ensures that the audit log is a faithful record of what happened, not what was allowed to happen. An action that bypasses the CapabilityGate (through a bug, a misconfiguration, or a compromise) still appears in the Monitor's log as a breach.

### 5.3 CapabilityGate

The **CapabilityGate** is an enforcement boundary that intercepts agent actions before they reach external systems. It evaluates each action against the active covenant and returns one of:

| Decision | Effect |
|---|---|
| `ALLOW` | The action proceeds to the target system. |
| `DENY` | The action is blocked. The agent receives a denial with the violated constraint. |
| `ESCALATE` | The action requires human approval before proceeding. |

The CapabilityGate is the only component in the Stele architecture that has the power to prevent an action. It is optional — an operator may choose to run in monitor-only mode, where all actions are logged but none are blocked. This is useful during initial deployment or when the operator prefers post-hoc accountability over real-time prevention.

### 5.4 Tamper-Evident Audit Log

Every action, whether permitted or denied, is recorded in a tamper-evident audit log structured as an append-only Merkle tree.

Each leaf in the tree is an **action record**:

```json
{
  "stele": "0.1.0",
  "kind": "action",
  "covenant": "<covenant-id>",
  "sequence": <monotonic counter>,
  "timestamp": "<ISO-8601 UTC>",
  "action": {
    "capability": "<capability-uri>",
    "resource": "<resource>",
    "parameters": {},
    "result": "<outcome>"
  },
  "evaluation": {
    "result": "PERMIT | BREACH | UNDETERMINED",
    "constraints": ["<violated-constraint-ids>"]
  },
  "hash": "<SHA-256 of canonical form>",
  "previousHash": "<hash of previous action record>",
  "merkleRoot": "<current Merkle root>"
}
```

**Tamper-evidence properties:**

- Each action record includes the hash of the previous record, forming a hash chain. Removing or reordering a record breaks the chain.
- The Merkle root is updated with each new record. Any modification to a historical record changes the root, making tampering detectable.
- The sequence counter is monotonically increasing. Gaps in the sequence indicate omitted records.

### 5.5 Merkle Proof Structure

A **Merkle proof** for a specific action record consists of:

1. The action record itself.
2. The sibling hashes along the path from the leaf to the root.
3. The Merkle root at the time of the action.

Verification:

1. Hash the action record to produce the leaf hash.
2. Combine with sibling hashes to reconstruct the path to the root.
3. Compare the reconstructed root with the claimed Merkle root.

This allows a verifier to confirm that a specific action is included in the log without downloading the entire log. Proof size is O(log n) where n is the number of actions.

---

## 6. Trustless Verification

### 6.1 Design Goals

Verification in Stele must satisfy three requirements:

1. **No trusted party.** Verification must not require contacting the agent, the operator, or any third-party service.
2. **Deterministic.** The same inputs must always produce the same verification result.
3. **Privacy-preserving.** It must be possible to prove compliance without revealing the full action log.

Requirements (1) and (2) are satisfied by the Merkle proof structure in §5. Requirement (3) motivates zero-knowledge proofs.

### 6.2 ZK Proof Architecture

Stele uses zero-knowledge proofs to enable **selective disclosure verification** — proving that a sequence of actions satisfies a covenant's constraints without revealing the actions themselves.

The architecture has three components:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Proof Circuit  │     │  Proof Generator  │     │  Proof Verifier  │
│  (compiled CCL)  │────▶│  (client-side)    │────▶│  (anyone)        │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**Proof Circuit:** Each CCL expression compiles to an arithmetic circuit that encodes the constraint logic. The circuit takes as private inputs the action records and as public inputs the covenant ID and the claimed result (compliant / breach).

**Proof Generator:** Runs client-side (on the agent's or operator's infrastructure). Takes the private action log, the covenant, and the circuit, and produces a succinct proof.

**Proof Verifier:** Any party can verify the proof using only the public inputs (covenant ID and claimed result) and the proof itself. Verification is constant-time regardless of the number of actions.

### 6.3 Poseidon Commitments

Stele uses the **Poseidon** hash function for in-circuit commitments. Poseidon is designed for efficiency inside arithmetic circuits (SNARKs/STARKs), with significantly lower constraint counts compared to SHA-256 or Keccak.

A Poseidon commitment to an action record is computed as:

```
C = Poseidon(capability ‖ resource ‖ parameters_hash ‖ timestamp ‖ sequence)
```

The commitment is published alongside the Merkle root. The ZK proof demonstrates that:

1. The committed actions correspond to real action records (opening the commitment).
2. Each action record satisfies the covenant's constraints.
3. The commitment set is complete (no actions were omitted from the proof).

Completeness is enforced by proving that the sequence counter in the committed records forms a contiguous range matching the total action count declared in the covenant's execution receipt (see §7.1).

### 6.4 Client-Side Proof Generation

Proofs are generated on the agent operator's infrastructure, not on a trusted third-party service. This ensures that the private action data never leaves the operator's control.

The proof generation process:

1. Compile the covenant's CCL expression into an arithmetic circuit.
2. Load the action log as private witness data.
3. Compute Poseidon commitments for each action record.
4. Execute the circuit to produce the proof.
5. Package the proof with public inputs (covenant ID, Merkle root, action count, result).

Proof generation is computationally intensive but parallelizable. For a typical covenant with 10,000 actions, proof generation takes O(seconds) on commodity hardware.

### 6.5 Independent Verification

To verify a Stele proof, a verifier needs:

| Input | Source |
|---|---|
| The covenant document | Public (content-addressed, retrievable by ID) |
| The Merkle root | Published by the operator or anchored on-chain |
| The ZK proof | Published by the operator |
| The verification key | Derived from the covenant's compiled circuit |

The verification algorithm:

1. Retrieve the covenant by its content address. Verify its signature (§3.6).
2. Compile the covenant's CCL to an arithmetic circuit. Derive the verification key.
3. Verify the ZK proof against the verification key and public inputs.
4. If on-chain anchoring is used, verify that the Merkle root matches the anchored value.

Verification is constant-time and requires no network access beyond retrieving the covenant document (which can be cached or bundled with the proof).

---

## 7. Reputation

### 7.1 Execution Receipts

An **execution receipt** is a signed attestation that a covenant's execution has concluded. It is the atomic unit of reputation.

```json
{
  "stele": "0.1.0",
  "kind": "receipt",
  "covenant": "<covenant-id>",
  "agent": "<agent-identity>",
  "period": {
    "start": "<ISO-8601 UTC>",
    "end": "<ISO-8601 UTC>"
  },
  "summary": {
    "totalActions": <count>,
    "permitted": <count>,
    "breaches": <count>,
    "merkleRoot": "<final Merkle root>"
  },
  "proof": "<ZK proof | null>",
  "signature": "<Ed25519 signature>"
}
```

A receipt with zero breaches and a valid proof is a **clean receipt**. Clean receipts are the building blocks of reputation.

### 7.2 Trust Scoring

An agent's **trust score** is a function of its execution history. The score is computed deterministically from publicly available receipts.

```
trust_score(agent) = Σ (weight(receipt_i) × recency(receipt_i))
```

Where:

- `weight(receipt)` is a function of the covenant's complexity (constraint count, scope breadth) and the action count. More complex covenants with more actions produce higher-weight receipts.
- `recency(receipt)` is a time-decay function that reduces the contribution of older receipts. Recent behavior matters more than historical behavior.

The trust score is not a single number but a **vector** across capability categories. An agent with a strong track record in financial operations and no history in infrastructure management has a high trust score for finance and a low one for infrastructure.

### 7.3 Reputation Staking

Agents can **stake** reputation on a covenant, putting their accumulated trust score at risk. Staking serves two purposes:

1. **Signaling.** A staked covenant communicates that the agent considers its commitments credible enough to risk its reputation.
2. **Accountability.** If the agent breaches a staked covenant, the reputation loss is amplified by the stake multiplier.

Stake mechanics:

```
reputation_loss(breach) = base_penalty × stake_multiplier
```

Where `base_penalty` is determined by the severity of the breach (see §8) and `stake_multiplier` is proportional to the staked amount.

An agent cannot stake more reputation than it has. Staking is a commitment — once a covenant is staked, the stake cannot be withdrawn until the covenant expires or is completed.

### 7.4 Delegation

An agent may **delegate** a portion of its reputation to another agent, vouching for the delegate's behavior within a specified scope.

```json
{
  "stele": "0.1.0",
  "kind": "delegation",
  "delegator": "<agent-identity>",
  "delegate": "<agent-identity>",
  "scope": ["<capability-uri>"],
  "amount": <reputation-fraction>,
  "covenant": "<covenant-id constraining the delegate>",
  "expiry": "<ISO-8601 UTC>",
  "signature": "<delegator's Ed25519 signature>"
}
```

Delegation is scoped — it applies only to the specified capabilities and only under the specified covenant. If the delegate breaches the covenant, the delegator's reputation is reduced by the delegated amount (co-burn; see §7.5).

### 7.5 Co-Burn Mechanics

**Co-burn** ensures that delegation carries real consequences. When a delegate breaches a covenant, both the delegate and the delegator suffer reputation loss.

```
delegate_loss  = base_penalty × stake_multiplier
delegator_loss = delegation_amount × severity_factor
```

Co-burn propagates upward through the delegation chain. If agent A delegates to agent B, and agent B delegates to agent C, and agent C breaches, then C, B, and A all incur reputation loss — with attenuation at each level.

```
loss_at_depth(d) = delegation_amount × severity_factor × (attenuation_rate ^ d)
```

The default attenuation rate is 0.5. A breach by a depth-3 delegate costs the root delegator 12.5% of the delegation amount (assuming severity_factor = 1).

### 7.6 Non-Transferable Economic Personhood

Reputation in Stele is **non-transferable**. It cannot be bought, sold, gifted, or merged between identities. This is a deliberate design choice with three motivations:

1. **Sybil resistance.** If reputation were transferable, an attacker could farm reputation across many identities and consolidate it into one, or sell high-reputation identities on a secondary market.

2. **Accountability preservation.** Reputation represents a specific agent's track record. Transferring it would decouple the track record from the entity that produced it.

3. **Economic personhood.** Each agent identity accrues its own reputation through its own actions. Reputation is not a token — it is a history.

The non-transferability constraint is enforced at the protocol level. The reputation score function takes as input only receipts signed by the agent's own identity (including lineage predecessors, with carry-forward attenuation per §4.4). There is no `transfer` operation in the protocol.

---

## 8. Breach Propagation

### 8.1 Breach Attestations

When a verifier detects a covenant breach, it may publish a **breach attestation**:

```json
{
  "stele": "0.1.0",
  "kind": "breach-attestation",
  "agent": "<breaching agent identity>",
  "covenant": "<covenant-id>",
  "evidence": {
    "actionRecord": "<action-record-hash>",
    "constraint": "<violated CCL constraint>",
    "merkleProof": "<proof of inclusion>"
  },
  "severity": "minor | moderate | severe | critical",
  "attester": "<attester identity>",
  "timestamp": "<ISO-8601 UTC>",
  "signature": "<attester's Ed25519 signature>"
}
```

Attestations are independently verifiable — any party can check the Merkle proof, evaluate the action record against the cited constraint, and confirm the breach.

### 8.2 Severity Classification

| Severity | Definition | Reputation Impact |
|---|---|---|
| `minor` | Constraint violated but no material consequence. E.g., exceeding a rate limit by a small margin. | 5% of staked reputation |
| `moderate` | Material constraint violation within scope. E.g., accessing an unauthorized resource. | 20% of staked reputation |
| `severe` | Significant violation with potential for harm. E.g., exceeding financial limits substantially. | 50% of staked reputation |
| `critical` | Fundamental breach of covenant intent. E.g., acting entirely outside declared scope, evidence of tampering. | 100% of staked reputation |

Severity is declared by the attester and may be contested. Contested severity is resolved through the governance process (§11).

### 8.3 Trust Graph

The **trust graph** is a directed, weighted graph where:

- **Nodes** are agent identities.
- **Edges** are delegation relationships, weighted by the delegated reputation amount.

```
A ──(0.3)──▶ B ──(0.2)──▶ C ──(0.5)──▶ D
             │
             └──(0.4)──▶ E
```

The trust graph is constructed from published delegation documents and is publicly auditable.

### 8.4 BFS Propagation

When a breach attestation is published for agent X, the reputation impact propagates through the trust graph using breadth-first search (BFS):

```
procedure PROPAGATE_BREACH(agent X, severity S):
    queue ← [(X, 0)]
    visited ← {X}
    while queue is not empty:
        (current, depth) ← queue.dequeue()
        loss ← compute_loss(current, X, S, depth)
        apply_reputation_loss(current, loss)
        for each delegator D where D delegates to current:
            if D ∉ visited and depth + 1 ≤ MAX_PROPAGATION_DEPTH:
                visited ← visited ∪ {D}
                queue.enqueue((D, depth + 1))
```

`MAX_PROPAGATION_DEPTH` is a protocol parameter (default: 5). This bounds the blast radius of a breach and prevents unbounded propagation through deep delegation chains.

### 8.5 Severity-Mapped Degradation

Reputation loss at each propagation level is a function of severity and depth:

```
loss(depth, severity) = base_impact(severity) × attenuation^depth × delegation_fraction
```

Where `base_impact` maps severity to the reputation percentages in §8.2, `attenuation` is 0.5, and `delegation_fraction` is the fraction of reputation the delegator placed on the edge.

This ensures that:
- The breaching agent suffers the full impact.
- Direct delegators suffer significant but attenuated impact.
- Transitive delegators suffer progressively less, reaching negligible levels within a few hops.

---

## 9. Chain Composition

### 9.1 Monotonic Constraint Narrowing

Covenants can be chained through the `parent` field, forming a **covenant chain**. The fundamental invariant of chain composition is **monotonic constraint narrowing**: a child covenant can only be *more* restrictive than its parent, never less.

Formally, let `constraints(C)` denote the set of behaviors permitted by covenant C. For any child covenant C_child with parent C_parent:

```
constraints(C_child) ⊆ constraints(C_parent)
```

This is enforced at covenant creation. When a covenant with a `parent` field is submitted for inscription, the protocol verifier checks that every ALLOW in the child is permitted by the parent, and that the child does not remove any DENY or REQUIRE from the parent.

### 9.2 Delegation Chains

Chain composition enables **delegation**: a principal agent inscribes a broad covenant, then delegates specific tasks to sub-agents under narrower covenants.

```
Root Covenant (principal)
├── Child Covenant A (sub-agent for financial operations)
│   ├── Grandchild A.1 (sub-agent for USDC transfers)
│   └── Grandchild A.2 (sub-agent for reporting)
└── Child Covenant B (sub-agent for infrastructure)
```

Each level of delegation narrows the constraints. The principal's covenant permits financial operations and infrastructure management. Child A is restricted to financial operations only. Grandchild A.1 is further restricted to USDC transfers specifically.

### 9.3 Effective Constraint Computation

The **effective constraints** for a covenant are the intersection of all constraints in its chain, from the root to the leaf.

```
effective(C) = constraints(root) ∩ constraints(C_1) ∩ ... ∩ constraints(C)
```

Because of monotonic narrowing, this is equivalent to the leaf covenant's own constraints — but verification must confirm that the chain is valid (each child is a subset of its parent).

The effective constraint computation algorithm:

```
procedure COMPUTE_EFFECTIVE(covenant C):
    chain ← [C]
    current ← C
    while current.parent ≠ null:
        parent ← resolve(current.parent)
        if not VERIFY_NARROWING(parent, current):
            return ERROR("chain violation: child is not a subset of parent")
        chain.prepend(parent)
        current ← parent
    return constraints(C)  // valid chain; leaf constraints are effective
```

`VERIFY_NARROWING` checks:
1. Every `ALLOW` in the child matches an `ALLOW` in the parent.
2. Every `DENY` in the parent appears in the child.
3. Every `REQUIRE` in the parent appears in the child.
4. Every `LIMIT` in the child is equal to or stricter than the corresponding `LIMIT` in the parent.

---

## 10. Web of Trust

### 10.1 Endorsement Protocol

Beyond delegation (which implies a principal-agent relationship), Stele supports **endorsements** — attestations from one agent about another's capabilities or trustworthiness.

```json
{
  "stele": "0.1.0",
  "kind": "endorsement",
  "endorser": "<agent-identity>",
  "subject": "<agent-identity>",
  "scope": ["<capability-uri>"],
  "confidence": <0.0-1.0>,
  "evidence": ["<receipt-id>"],
  "expiry": "<ISO-8601 UTC>",
  "signature": "<endorser's Ed25519 signature>"
}
```

Endorsements are voluntary, scoped, and time-limited. An endorsement without evidence (referencing specific execution receipts) carries less weight than one backed by verifiable receipts.

### 10.2 Weighted Attestations

Not all endorsements are equal. The weight of an endorsement is a function of:

```
weight(endorsement) = endorser_trust_score
                    × scope_relevance
                    × evidence_strength
                    × recency
```

Where:
- `endorser_trust_score` is the endorser's own trust score in the relevant capability categories.
- `scope_relevance` measures overlap between the endorser's demonstrated expertise and the endorsement scope.
- `evidence_strength` is 1.0 if backed by verifiable receipts, 0.3 if not.
- `recency` applies time decay.

An endorsement from a high-reputation agent with relevant expertise and verifiable evidence carries substantially more weight than one from a new agent with no track record.

### 10.3 Sybil Resistance

The web of trust is vulnerable to sybil attacks: an adversary creates many identities that endorse each other to inflate their trust scores. Stele employs three defenses:

**1. Reputation cost.** Creating a new identity starts with zero reputation. Reputation can only be earned through verified covenant execution (§7.1). Farming reputation requires actually performing work under covenants and producing clean receipts. This makes sybil attacks expensive in terms of computation and time.

**2. Endorsement discounting.** Endorsements from low-reputation agents are discounted heavily (see weight formula in §10.2). A cluster of new, low-reputation identities endorsing each other produces negligible trust score gains.

**3. Graph analysis.** The trust graph is public. Community-run analysis tools can identify suspicious patterns: clusters of identities that only endorse each other, identities with endorsement patterns inconsistent with their execution history, and rapid reputation accumulation without corresponding covenant complexity. Identified sybil clusters can be flagged through the governance process (§11).

---

## 11. Governance

### 11.1 Principles

Stele governance follows three principles:

1. **Participation-weighted, not plutocratic.** Governance power derives from verified protocol participation (covenant execution, verification, attestation), not from token holdings or financial stake.
2. **Minimal governance surface.** The protocol should require as few governance decisions as possible. Anything that can be determined algorithmically should be.
3. **Transparency.** All governance proposals, votes, and outcomes are published as signed, content-addressed documents following the same format as other protocol objects.

### 11.2 Governance Scope

Governance decisions are limited to:

| Category | Examples |
|---|---|
| **Protocol parameters** | `MAX_PROPAGATION_DEPTH`, attenuation rates, carry-forward maximums, time-decay constants |
| **Severity disputes** | Contesting the severity classification of a breach attestation |
| **Sybil adjudication** | Reviewing and acting on suspected sybil clusters |
| **Protocol upgrades** | Changes to the CCL grammar, document schemas, cryptographic primitives |

Governance does NOT cover: individual covenant disputes (these are resolved by the protocol's verification mechanism), reputation scores (these are computed deterministically), or enforcement decisions (these are made by the CapabilityGate per the covenant's constraints).

### 11.3 Participation Weight

An agent's governance weight is computed from its protocol activity:

```
governance_weight(agent) = α × verified_execution_score
                         + β × verification_activity_score
                         + γ × attestation_accuracy_score
```

Where:
- `verified_execution_score` reflects the agent's history of covenant execution (clean receipts, covenant complexity).
- `verification_activity_score` reflects contributions to verification (proofs checked, breaches correctly identified).
- `attestation_accuracy_score` reflects the historical accuracy of the agent's attestations (breach claims that were later confirmed vs. disputed).
- α, β, γ are protocol parameters summing to 1.0 (default: 0.4, 0.3, 0.3).

This ensures that governance influence accrues to participants who actively contribute to the protocol's accountability function, not to passive token holders.

### 11.4 Proposal and Voting

Governance proposals follow a structured lifecycle:

1. **Proposal.** Any agent with governance weight > 0 may submit a proposal as a signed document.
2. **Discussion period.** A fixed window (default: 7 days) for public comment. Comments are signed documents.
3. **Voting period.** A fixed window (default: 7 days) for voting. Votes are participation-weighted.
4. **Threshold.** A proposal passes if it achieves > 66% of cast weighted votes, with a minimum quorum of 20% of total governance weight.
5. **Execution.** Passed proposals are implemented in the next protocol version.

---

## 12. Security Analysis

### 12.1 Threat Model

Stele assumes the following threat model:

**Trusted:**
- Cryptographic primitives (Ed25519, SHA-256, Poseidon) are secure.
- The ZK proof system is sound (a valid proof implies a true statement).

**Untrusted:**
- Agents may be adversarial — they may attempt to violate covenants, forge receipts, or evade accountability.
- Operators may collude with their agents to suppress breach evidence.
- Network participants may attempt sybil attacks, false attestations, or governance manipulation.
- The network itself is untrusted — messages may be delayed, reordered, or dropped.

### 12.2 Attack Vectors and Mitigations

#### 12.2.1 Covenant Forgery

**Attack:** An agent creates a retroactive covenant that matches its already-executed actions, claiming it was inscribed before execution.

**Mitigation:** Covenants are content-addressed and timestamped. When on-chain anchoring is used (via `@stele/evm`), the covenant's content address is recorded on an immutable ledger with a block timestamp. Even without on-chain anchoring, the covenant must be signed before any action records reference it, and the action records' hash chain includes the covenant ID. Backdating a covenant requires forging the entire action log.

#### 12.2.2 Action Log Omission

**Attack:** An agent or operator omits breach actions from the audit log, presenting only compliant actions.

**Mitigation:** The sequence counter in action records is monotonically increasing. Any gap in the sequence is detectable. The ZK proof of completeness (§6.3) requires proving that the committed action count matches a declared total with no gaps. If the agent is interacting with external systems that maintain their own logs (e.g., blockchain transactions, API calls with receipts), counter-evidence can expose omissions.

#### 12.2.3 Key Compromise

**Attack:** An attacker compromises an agent's signing key and inscribes covenants or publishes false attestations on the agent's behalf.

**Mitigation:** Key rotation through the lineage chain (§4.2). The compromised key can be superseded by a new identity document. Covenants signed by the compromised key after the rotation timestamp are invalid. The protocol does not prevent damage from key compromise during the window before detection — this is a fundamental limitation shared with all public-key systems.

#### 12.2.4 Sybil Attacks on Reputation

**Attack:** An adversary creates many identities to farm reputation through low-stakes covenants, then uses the inflated reputation for high-stakes delegation or governance influence.

**Mitigation:** Reputation weight is a function of covenant complexity and action count (§7.2). Farming reputation through trivial covenants produces low-weight receipts. Governance weight additionally factors in verification activity and attestation accuracy (§11.3), which require genuine protocol participation. The economic cost of producing meaningful reputation through sybil identities exceeds the cost of building reputation through a single honest identity.

#### 12.2.5 False Breach Attestations

**Attack:** A malicious actor publishes false breach attestations to damage an agent's reputation.

**Mitigation:** Breach attestations must include a Merkle proof and the specific action record that violated the constraint (§8.1). Any verifier can check the proof — a false attestation is immediately detectable because the cited action record either doesn't exist in the log (Merkle proof fails) or doesn't actually violate the cited constraint (CCL evaluation returns PERMIT). Repeated false attestations degrade the attester's own `attestation_accuracy_score` (§11.3).

#### 12.2.6 Governance Capture

**Attack:** A coordinated group accumulates disproportionate governance weight to pass self-serving proposals.

**Mitigation:** Governance weight derives from three independent factors — execution, verification, and attestation accuracy (§11.3). Capturing governance requires dominating all three, which demands sustained, genuine protocol participation across multiple dimensions. The 66% supermajority threshold and 20% quorum requirement further raise the bar. Protocol parameter changes are bounded — governance cannot, for example, set attenuation to 0 or remove breach propagation entirely, as these would violate protocol invariants.

#### 12.2.7 Merkle Root Substitution

**Attack:** An operator publishes a valid Merkle root for a sanitized version of the action log, omitting breach actions and recomputing the tree.

**Mitigation:** On-chain anchoring provides a timestamped commitment to the Merkle root at regular intervals. If an operator recomputes the tree, the new root won't match previously anchored roots. For intervals between anchoring, counterparties who received Merkle proofs during execution can present them as evidence of the original tree structure. Additionally, the ZK completeness proof (§6.3) binds the Merkle root to a specific action count — substituting the root requires producing a new valid ZK proof, which requires satisfying the circuit's completeness constraint with the modified data.

---

## Appendix A: Notation

| Symbol | Meaning |
|---|---|
| C | Covenant document |
| C.id | Content address of covenant C |
| constraints(C) | Set of behaviors permitted by C |
| trust_score(A) | Trust score vector for agent A |
| ⊆ | Subset (monotonic narrowing) |
| ‖ | Concatenation |
| Poseidon(x) | Poseidon hash of x |
| SHA-256(x) | SHA-256 hash of x |

## Appendix B: Protocol Parameters

| Parameter | Default | Governance-Modifiable |
|---|---|---|
| `MAX_PROPAGATION_DEPTH` | 5 | Yes |
| `ATTENUATION_RATE` | 0.5 | Yes |
| `CARRY_FORWARD.key_rotation` | 1.0 | No |
| `CARRY_FORWARD.model_update` | 0.8 | Yes |
| `CARRY_FORWARD.model_migration` | 0.4 | Yes |
| `CARRY_FORWARD.operator_transfer` | 0.2 | Yes |
| `CARRY_FORWARD.full_evolution` | 0.1 | Yes |
| `GOVERNANCE.supermajority` | 0.66 | No |
| `GOVERNANCE.quorum` | 0.20 | Yes |
| `GOVERNANCE.discussion_period` | 7 days | Yes |
| `GOVERNANCE.voting_period` | 7 days | Yes |
| `REPUTATION.time_decay_halflife` | 180 days | Yes |
| `EVIDENCE_WEIGHT.with_receipts` | 1.0 | No |
| `EVIDENCE_WEIGHT.without_receipts` | 0.3 | Yes |
