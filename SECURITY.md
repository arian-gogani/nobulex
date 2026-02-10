# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes (current) |

Only the latest minor release receives security patches. We recommend always running
the most recent version.

## Reporting a Vulnerability

If you discover a security vulnerability in Stele, please report it responsibly.

**Email**: security@stele.dev

Please include:

- A description of the vulnerability
- Steps to reproduce
- Affected package(s) and version(s)
- Any potential impact assessment

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation
within 7 days for critical issues. We will credit reporters in the release notes unless
anonymity is requested.

**Do NOT** open a public GitHub issue for security vulnerabilities.

## Security Model

### Cryptographic Primitives

Stele relies on the following cryptographic building blocks:

| Primitive | Library | Purpose |
|-----------|---------|---------|
| **Ed25519** | `@noble/ed25519` | Covenant signing, identity signing, countersignatures, breach attestations |
| **SHA-256** | `@noble/hashes/sha256` | Document IDs, canonical hashing, content-addressed identifiers |
| **Poseidon** | `@stele/proof` (internal) | Zero-knowledge-style compliance proof commitments |
| **CSPRNG** | `@noble/hashes/utils` (`randomBytes`) | Nonce generation, key generation |

All cryptographic operations use audited, pure-JavaScript implementations from the
`@noble` family of libraries (by Paul Miller), which are widely used in the
Web3 ecosystem and have undergone independent security reviews.

### Key Design Decisions

- **Canonical JSON (JCS / RFC 8785)**: All document hashing and signing uses
  deterministic JSON serialization to prevent signature malleability.
- **Constant-time comparison**: The `constantTimeEqual()` function in `@stele/crypto`
  prevents timing side-channel attacks when comparing signatures or hashes.
- **Immutable documents**: Functions like `countersignCovenant()` and `resignCovenant()`
  return new document copies rather than mutating the input, preventing accidental
  state corruption.
- **Nonce-per-document**: Every covenant document includes a unique 32-byte
  cryptographic nonce to prevent replay attacks.
- **Deny-by-default**: CCL evaluation returns `{ permitted: false }` when no rules
  match, ensuring that unrecognized actions are blocked by default.

### What Is Covered

- Ed25519 signature generation and verification for covenant documents
- SHA-256 document ID computation and integrity checking
- CCL constraint evaluation with deny-wins merge semantics
- Chain narrowing validation (children cannot broaden parent constraints)
- Countersignature verification
- Input validation and sanitization (`@stele/types` guards)
- Constant-time comparison for cryptographic values
- Poseidon-based compliance proof generation and verification

### What Is NOT Covered

- **Network transport**: Stele does not include TLS or transport-layer security.
  Documents should be transmitted over secure channels.
- **Key storage**: Private keys are handled as raw `Uint8Array` values. Secure key
  storage (HSM, KMS, encrypted keyring) is the responsibility of the integrator.
- **Access control to the store**: `MemoryStore` and `FileStore` do not implement
  authentication or authorization. Wrap them with appropriate access controls in
  production.
- **Denial-of-service protection**: The CCL parser and evaluator do not implement
  resource limits beyond `MAX_CONSTRAINTS` and `MAX_DOCUMENT_SIZE`.

## Known Limitations

- **No formal security audit**: The codebase has not yet undergone a formal
  third-party security audit. Use in production at your own risk.
- **MemoryStore and FileStore are not encrypted at rest**: Covenant documents stored
  via these backends are written as plaintext JSON. Use disk encryption or an
  encrypted storage backend for sensitive deployments.
- **No key rotation protocol**: While `resignCovenant()` supports re-signing with a
  new key, there is no built-in key rotation ceremony or revocation list.
- **Poseidon proofs are not full ZK-SNARKs**: The `@stele/proof` package uses
  Poseidon hashing for commitment schemes, but does not generate or verify
  zero-knowledge proofs in the formal cryptographic sense.
- **EVM anchoring is offline**: The `@stele/evm` package produces ABI-encoded
  calldata but does not submit transactions. On-chain verification requires a
  deployed smart contract (not included).

## Dependency Security

The project has minimal runtime dependencies:

- `@noble/ed25519` -- Ed25519 signatures
- `@noble/hashes` -- SHA-256 and utility functions

Both are pure JavaScript with no native addons or transitive dependencies, reducing
the attack surface. We pin exact versions and review updates before merging.

## Security Contacts

- **Primary**: security@stele.dev
- **GitHub**: https://github.com/agbusiness195/stele/security
