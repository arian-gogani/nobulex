# Stele Architecture

## Overview

Stele is a digital accountability protocol for AI agents. It provides cryptographically signed **covenants** — binding constraint documents that govern what an AI agent may or may not do — with delegation chains, identity lineage, and formal verification.

## Layer Diagram

```
┌──────────────────────────────────────────────────────────┐
│                      Platform                             │
│         react  ·  evm  ·  mcp-server  ·  cli              │
├──────────────────────────────────────────────────────────┤
│                        SDK                                │
│          sdk  (SteleClient, QuickCovenant)                 │
├──────────────────────────────────────────────────────────┤
│                     Protocol                              │
│  attestation · canary · gametheory · composition ·         │
│  antifragile · negotiation · consensus · robustness ·      │
│  temporal · recursive · alignment · norms · substrate ·    │
│  derivatives · legal                                       │
├──────────────────────────────────────────────────────────┤
│                   Enforcement                             │
│     enforcement  ·  proof  ·  breach  ·  reputation        │
├──────────────────────────────────────────────────────────┤
│                    Foundation                              │
│  types · crypto · ccl · core · store · verifier · identity │
└──────────────────────────────────────────────────────────┘
```

## Dependency Graph

```
types ─────────────────────────────────────────────┐
  │                                                 │
crypto ← ccl ← core ← identity                     │
  │        │      │       │                         │
  │        │      ├── store                         │
  │        │      │     │                           │
  │        │      ├── verifier                      │
  │        │      │                                 │
  │        │      └── enforcement ← proof           │
  │        │            │           │               │
  │        │            breach ← reputation         │
  │        │                                        │
  └── sdk (unifies all foundation + identity) ──────┘
        │
        ├── mcp-server (JSON-RPC over stdio)
        ├── react (reactive primitives)
        ├── evm (blockchain anchoring)
        └── cli (command-line interface)
```

## Core Data Flow

```
1. Key Generation      generateKeyPair()           → KeyPair { privateKey, publicKey }
2. Covenant Building   buildCovenant(opts)          → CovenantDocument (signed)
3. Verification        verifyCovenant(doc)          → VerificationResult { valid, checks[] }
4. Countersigning      countersignCovenant(doc,kp)  → CovenantDocument (with countersig)
5. Chain Delegation    buildCovenant({chain:...})   → Child document (narrower constraints)
6. CCL Evaluation      evaluate(cclDoc, action, resource) → { permitted, matchedRule }
```

## CCL (Covenant Constraint Language)

CCL is a domain-specific language for expressing permissions and restrictions:

```
permit read on '/data/**'
deny write on '/system/**'
permit api.call on '/public/**' when role = 'admin'
limit api.call 1000 per 1 hours
require audit.log on '**'
```

### Semantics

- **Deny-wins**: When both permit and deny match, deny takes precedence
- **Default deny**: When no rules match, the action is denied
- **Exact matching**: `/secrets` does NOT match `/secrets/key` — use `/**` for wildcards
- **Reserved words**: `severity` is reserved in `when` conditions — use `risk_level` instead
- **Narrowing**: Child covenants may only restrict, never broaden, parent constraints

### Statement Types

| Type | Syntax | Effect |
|------|--------|--------|
| Permit | `permit <action> on '<resource>'` | Allow action |
| Deny | `deny <action> on '<resource>'` | Forbid action |
| Require | `require <action> on '<resource>'` | Mandate action |
| Limit | `limit <action> <count> per <n> <unit>` | Rate limit |

## Chain Model

Covenants form **delegation chains** where each child narrows its parent's constraints:

```
Root Covenant (broadest permissions)
  └── Child (adds deny for /admin/**)
       └── Grandchild (further restricts to read-only)
```

- Max chain depth: 10 (configurable)
- Each child references its parent via `chain.parentId`
- `validateChainNarrowing()` enforces the narrowing invariant
- `computeEffectiveConstraints()` merges the full chain via CCL merge

## Identity Model

Agent identities track **lineage** across model upgrades and capability changes:

```
Identity v1 (GPT-4, capabilities: [read, write])
  └── Identity v2 (GPT-4o, capabilities: [read, write, execute])
       └── Identity v3 (same model, added: [network])
```

- Each identity is signed by an operator key pair
- Evolution preserves lineage with carry-forward scores
- `verifyIdentity()` validates the full chain of evolution

## Security Model

| Component | Mechanism |
|-----------|-----------|
| Signing | Ed25519 via @noble/ed25519 |
| Hashing | SHA-256 |
| Canonicalization | RFC 8785 (JCS) |
| Timing safety | `constantTimeEqual()` for signature comparison |
| Nonce | 32-byte random per document |
| Document integrity | `id = SHA-256(canonicalForm(doc))` |

## Extension Points

| Interface | Purpose | Default |
|-----------|---------|---------|
| `CovenantStore` | Document persistence | `MemoryStore`, `FileStore` |
| `ChainResolver` | Parent document lookup | `MemoryChainResolver` |
| `SpanCollector` | Trace span collection | `InMemoryCollector` |
| `LogOutput` | Log entry destination | `console.log(JSON.stringify)` |
| `SteleClient.on()` | Event system | 8 event types |

## Package Summary

| Package | Lines | Purpose |
|---------|-------|---------|
| types | 500+ | Error hierarchy, validation, guards, logging, tracing, retry |
| crypto | 350+ | Ed25519, SHA-256, encoding, canonicalization |
| ccl | 800+ | Constraint language parser, evaluator, merger |
| core | 800+ | Covenant build, verify, chain, serialize |
| store | 550+ | MemoryStore, FileStore with atomic writes |
| verifier | 480+ | Stateful verification engine with history |
| identity | 500+ | Agent identity creation, evolution, lineage |
| sdk | 760+ | SteleClient unified API, QuickCovenant builders |
| enforcement | 400+ | Enforcement strategy evaluation |
| proof | 400+ | Proof generation and verification |
| breach | 400+ | Breach detection and tracking |
| reputation | 500+ | Reputation scoring with decay |
| mcp | 400+ | Model context protocol integration |
| mcp-server | 630+ | JSON-RPC 2.0 server with 6 tools |
| react | 400+ | Observable, CovenantState, IdentityState, StoreState |
| evm | 400+ | ABI encoding, anchor calldata, registry ABI |
| cli | 300+ | Command-line interface |
| 15 protocol pkgs | 300-800 each | Game theory, consensus, derivatives, temporal, etc. |
