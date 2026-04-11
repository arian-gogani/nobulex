# Proof-of-Behavior Specification v0.1.0

**Status:** Draft  
**Author:** Arian Gogani  
**Date:** April 2026  
**License:** CC-BY-4.0  

---

## Abstract

Proof-of-behavior is an open standard for how autonomous AI agents prove they operated within defined behavioral boundaries. It provides cryptographic verification that agents followed their declared rules, with tamper-evident audit trails that third parties can independently verify without trusting the operator.

This specification defines the data formats, verification steps, and protocol flows required for conforming implementations.

---

## 1. Overview

The proof-of-behavior protocol defines three primitives:

1. **Behavioral Declaration** — A formal specification of what an agent can and cannot do, expressed in a constraint language (permit/forbid/require).
2. **Runtime Enforcement** — A middleware layer that evaluates every agent action against the declaration before execution. Forbidden actions are blocked, not logged-and-reported.
3. **Cryptographic Proof** — A SHA-256 hash-chained audit trail where each entry is cryptographically linked to the previous. Any tampering breaks the chain and is immediately detectable.

The core verification function is:

```
verify(declaration, actionLog) → { compliant: boolean, violations: Violation[] }
```

This function is always decidable, always deterministic, and always efficient. No ML, no heuristics.

---

## 2. Behavioral Declaration Language

Declarations use a Cedar-inspired constraint syntax:

```
covenant <Name> {
  permit <action>;
  permit <action> (<field> <operator> <value>);
  forbid <action>;
  forbid <action> (<field> <operator> <value>);
  require <field> <operator> <value>;
}
```

### 2.1 Semantics

- `forbid` takes precedence over `permit` (deny-override).
- Unmatched actions are denied by default (default-deny).
- Conditions support: `>`, `<`, `>=`, `<=`, `==`, `!=`.
- Declarations are immutable once signed — they can only be narrowed, never loosened.

### 2.2 Example

```
covenant SafeTrader {
  permit read;
  permit transfer (amount <= 500);
  forbid transfer (amount > 500);
  forbid delete;
  require counterparty.compliance_score >= 0.8;
}
```

---

## 3. Agent Identity

Agents are identified by W3C Decentralized Identifiers (DIDs) using Ed25519 key pairs:

```
did:nobulex:<hex-encoded-hash-of-public-key>
```

Each agent MUST have:
- An Ed25519 key pair (private key for signing, public key for verification).
- A DID Document containing at least one verification method with the agent's public key.

---

## 4. Action Log Format

Each action log entry MUST contain:

| Field | Type | Description |
|-------|------|-------------|
| `index` | integer | Sequential entry number (0-indexed) |
| `timestamp` | string | ISO 8601 timestamp of evaluation |
| `agentDid` | string | The agent's decentralized identifier |
| `action` | string | The action attempted (e.g., "transfer", "read", "delete") |
| `resource` | string | The resource acted upon (default: "*") |
| `params` | object | Action parameters (e.g., `{ amount: 300 }`) |
| `outcome` | string | "success" (allowed and executed) or "blocked" (forbidden) |
| `previousHash` | string \| null | SHA-256 hash of the previous entry (null for first entry) |
| `hash` | string | SHA-256 hash of this entry including all fields above |

### 4.1 Hash Chain Construction

```
entry[0].hash = SHA-256(entry[0].index + entry[0].timestamp + ... + null)
entry[n].hash = SHA-256(entry[n].index + entry[n].timestamp + ... + entry[n-1].hash)
```

Any modification to any entry invalidates all subsequent hashes, making tampering immediately detectable.

---

## 5. Proof-of-Behavior Object

A portable proof-of-behavior contains everything a verifier needs:

| Field | Type | Description |
|-------|------|-------------|
| `agentDid` | string | Agent's DID |
| `didDocument` | DIDDocument | W3C DID document with public key |
| `covenant` | CovenantSpec | The behavioral rules the agent committed to |
| `covenantHash` | string | SHA-256 of the canonical covenant |
| `covenantSignature` | string | Ed25519 signature over covenant hash |
| `actionLog` | ActionLog | The complete hash-chained audit trail |
| `generatedAt` | string | ISO 8601 timestamp of proof generation |
| `proofSignature` | string | Ed25519 signature over the serialized proof payload |

---

## 6. Cross-Agent Verification Handshake

Before two agents transact, they exchange and verify each other's proof-of-behavior.

### 6.1 Protocol Flow

```
Agent A                              Agent B
   |                                    |
   |--- requestProof() --------------->|
   |<-- ProofOfBehavior ---------------|
   |                                    |
   | verifyCounterparty(proof)          |
   |   1. Verify covenant signature     |
   |   2. Verify proof signature        |
   |   3. Verify log integrity          |
   |   4. Verify compliance             |
   |   5. Check minimum history         |
   |   6. Check required covenant       |
   |                                    |
   | if (result.trusted)                |
   |--- executeTransaction() --------->|
   | else                               |
   |--- refuseTransaction() ---------->|
   |                                    |
```

**No proof, no transaction.** Agents without valid proof-of-behavior MUST be refused.

### 6.2 Verification Steps

A conforming implementation MUST perform these checks in order:

1. **Covenant signature** — The `covenantSignature` MUST be a valid Ed25519 signature of the `covenantHash`, verifiable against the public key in the DID document. If invalid: REJECT (agent may not have committed to these rules).

2. **Proof signature** — The `proofSignature` MUST be valid over the serialized proof payload. If invalid: REJECT (proof may have been tampered with in transit).

3. **Log integrity** — The hash chain MUST be intact. Each entry's `hash` MUST correctly incorporate the `previousHash`. If broken: REJECT (action log has been modified).

4. **Compliance** — Every action in the log MUST comply with the covenant. No `forbid` rules may be violated. If violations exceed `maxViolations`: REJECT.

5. **Minimum history** (OPTIONAL) — Implementations MAY require a minimum number of logged actions before trusting a counterparty.

6. **Required covenant** (OPTIONAL) — Implementations MAY require a specific covenant name or covenant hash.

### 6.3 Handshake Result

The verification MUST return:

| Field | Type | Description |
|-------|------|-------------|
| `trusted` | boolean | Whether the counterparty passed all checks |
| `agentDid` | string | The counterparty's DID |
| `covenantName` | string | The counterparty's covenant name |
| `signatureValid` | boolean | Whether the covenant signature verified |
| `logIntegrityValid` | boolean | Whether the hash chain is intact |
| `compliant` | boolean | Whether the agent followed its rules |
| `violationCount` | integer | Number of violations found |
| `totalActions` | integer | Total actions in the agent's history |
| `reason` | string | Human-readable explanation |

---

## 7. Regulatory Alignment

The proof-of-behavior protocol directly addresses:

- **EU AI Act Article 12** — Requires automatic event logging that is tamper-evident for high-risk AI systems. Proof-of-behavior's hash-chained action logs satisfy this requirement. Enforcement deadline: August 2, 2026.
- **NIST AI Agent Standards** — Behavioral accountability for autonomous agents. Nobulex submitted formal comments to Docket NIST-2025-0035.
- **OWASP Top 10 for Agentic Applications** — Addresses audit trail requirements, access control enforcement, and action verification.

---

## 8. Security Considerations

### 8.1 Threat Model

- **Tampered logs:** Detected by hash chain verification. Any modified entry breaks the chain.
- **Forged signatures:** Detected by Ed25519 signature verification against the DID document.
- **Impersonation:** Detected by verifying the covenant signature was produced by the key in the presented DID document.
- **Replay attacks:** Mitigated by timestamps and sequential indices in log entries.
- **Covenant substitution:** Detected by verifying the covenant hash matches the signed hash.

### 8.2 Limitations

- The protocol does not verify that the agent actually executed the middleware. It verifies that IF the middleware was used, the logs are consistent and untampered.
- TEE-based enforcement (ensuring the middleware cannot be bypassed) is defined but currently in simulation mode in the reference implementation.

---

## 9. Reference Implementation

The reference implementation is **Nobulex**, available under the MIT license:

- **GitHub:** [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
- **npm:** `@nobulex/sdk`
- **PyPI:** `langchain-nobulex`
- **MCP Server:** `@nobulex/mcp-server`
- **Website:** [nobulex.com](https://nobulex.com)
- **Tests:** 4,244 passing

---

## 10. Conformance

An implementation is conformant with this specification if it:

1. Implements the behavioral declaration language with deny-override semantics.
2. Produces hash-chained action logs with SHA-256.
3. Implements the cross-agent verification handshake with all 4 required steps.
4. Uses Ed25519 for all signatures.
5. Uses W3C DIDs for agent identity.

---

## 11. License

This specification is released under **CC-BY-4.0**. Anyone may implement it freely.
