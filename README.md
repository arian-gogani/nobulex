# Stele

**The accountability primitive for AI agents.**

Stele is a cryptographic protocol that lets AI agents make verifiable behavioral commitments before they act. An agent inscribes what it will do, operates within those bounds, and anyone can verify compliance after the fact — no trust required.

## Quickstart

```bash
npm install @stele/mcp-server
npx @stele/mcp-server
```

Point your MCP-compatible agent at the server. It now has tools to inscribe commitments, log actions, and produce verification proofs.

## Protocol Flow

Stele follows a three-phase protocol: **Inscribe → Operate → Verify**.

### 1. Inscribe

Before acting, the agent creates a **stele** — a signed, content-addressed commitment declaring its intended behavior, constraints, and scope. This is cryptographically sealed and timestamped. Once inscribed, it cannot be altered.

### 2. Operate

The agent executes its task. Every action is logged against the inscribed commitment, building a Merkle tree of observable behavior. The agent works freely within its declared boundaries; the protocol stays out of the way.

### 3. Verify

Any third party can independently verify that the agent's recorded actions satisfy its inscribed commitments. Verification is deterministic and requires no access to the agent, its operator, or any privileged system. The proof stands on its own.

See [PROTOCOL.md](./PROTOCOL.md) for the full specification.

## Packages

| Package | Description |
|---|---|
| [`@stele/core`](./packages/core) | Protocol engine — commitment creation, action logging, and verification proof generation |
| [`@stele/mcp-server`](./packages/mcp-server) | Model Context Protocol server that exposes Stele tools to any AI agent |
| [`@stele/sdk`](./packages/sdk) | TypeScript SDK for embedding Stele into agent frameworks and applications |
| [`@stele/cli`](./packages/cli) | Command-line tools for inspecting, querying, and verifying steles |
| [`@stele/verifier`](./packages/verifier) | Standalone verification engine for third-party auditors |
| [`@stele/store`](./packages/store) | Pluggable storage backends — SQLite, PostgreSQL, S3 |
| [`@stele/crypto`](./packages/crypto) | Merkle trees, content-addressed hashing, and digital signatures |
| [`@stele/types`](./packages/types) | Shared TypeScript type definitions and protocol schemas |
| [`@stele/react`](./packages/react) | React components for accountability dashboards and stele explorers |
| [`@stele/evm`](./packages/evm) | Solidity contracts and ethers.js bindings for on-chain anchoring |

## Why This Matters

Autonomous agents are beginning to manage money, sign contracts, deploy infrastructure, and make decisions with real consequences. The amounts they control will grow from billions to trillions. The accountability infrastructure for this does not exist.

Today, when an agent misbehaves, the best case is a log file on a server controlled by the agent's operator. There is no independent verification. There is no way for a counterparty to confirm what an agent committed to doing before it acted. There is no audit trail that doesn't require trusting the same party you're trying to audit.

Stele fixes this by making accountability a protocol-level primitive — not a feature bolted onto an application, not a policy document in a compliance folder, but a cryptographic structure that agents produce as naturally as they produce API calls. Commitments are immutable, actions are logged against them, and verification requires nothing but the data itself.

The window to build this infrastructure is now, before the defaults are set.

## Philosophy

Read the [MANIFESTO.md](./MANIFESTO.md).

## License

[MIT](./LICENSE)
