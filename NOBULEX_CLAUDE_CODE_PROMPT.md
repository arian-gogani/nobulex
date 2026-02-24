# NOBULEX COVENANT PROTOCOL BUILD SPEC

## Vision
Smart contracts let strangers make trustless financial agreements. Smart covenants let agents make trustless behavioral agreements. Nobulex is the trust layer for the autonomous agent economy.

## Six Primitives to Build

1. Identity (DID) - W3C DID for every agent
2. Covenant (Behavioral Spec) - Cedar-like permit/forbid DSL over observable actions
3. Attestation - W3C Verifiable Credential wrapping signed covenant
4. Action Log - Hash-chained tamper-evident record of agent actions
5. Verification - deterministic function: verify(covenant, actionLog) → boolean
6. Enforcement - Solidity staking/slashing contracts

## Packages to Build (in order)

1. @nobulex/core-types - All TypeScript interfaces for the 6 primitives
2. @nobulex/identity - DID creation, resolution, signing, verification (Ed25519)
3. @nobulex/covenant-lang - Cedar-inspired DSL: lexer, parser, AST, compiler. Syntax: covenant Name { forbid transfer (amount > 500); permit api_call; require counterparty.compliance_score >= 0.9; }
4. @nobulex/action-log - Hash-chained event log with SHA-256, integrity verification
5. @nobulex/middleware - Compile CovenantSpec into enforcement function that blocks forbidden actions before execution
6. @nobulex/verification - Post-hoc verify(covenant, actionLog) → violations. Deterministic. Merkle proofs.
7. @nobulex/composability - checkCompatibility between covenants, find compatible agents, analyze trust topology
8. @nobulex/sdk - High-level API combining all primitives

Read the existing codebase first. Run existing tests. Build each package with full tests. Do not stop until done.
