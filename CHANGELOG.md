# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-02-07

Initial release. All packages are pre-release and APIs are subject to change.

### Packages

- **@stele/types** — Shared TypeScript type definitions and protocol schemas
- **@stele/crypto** — Merkle trees, content-addressed hashing, and digital signatures
- **@stele/core** — Protocol engine: commitment creation, action logging, verification proof generation
- **@stele/store** — Pluggable storage backends (SQLite, PostgreSQL, S3)
- **@stele/verifier** — Standalone verification engine for third-party auditors
- **@stele/sdk** — TypeScript SDK for embedding Stele into agent frameworks and applications
- **@stele/cli** — Command-line tools for inspecting, querying, and verifying steles
- **@stele/mcp-server** — Model Context Protocol server exposing Stele tools to any AI agent
- **@stele/react** — React components for accountability dashboards and stele explorers
- **@stele/evm** — Solidity contracts and ethers.js bindings for on-chain anchoring

### Protocol

- Covenant document format and canonical serialization
- Covenant Constraint Language (CCL) grammar and evaluator
- Ed25519 signing and verification
- Composite agent identity model with lineage chains
- Tamper-evident audit log (Merkle tree)
- Inscribe → Operate → Verify protocol flow
