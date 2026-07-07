# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Nobulex, please report it responsibly.

**Email:** nobulex.dev@gmail.com

**Do not** open a public issue for security vulnerabilities.

## Cryptographic Primitives

Nobulex uses well-established cryptographic primitives:

- **Ed25519**  - Digital signatures (RFC 8032)
- **SHA-256**  - Hash function (FIPS 180-4)
- **JCS**  - JSON Canonicalization Scheme (RFC 8785)

The `cryptography` Python package provides the Ed25519 implementation. The `rfc8785` package provides strict JCS conformance.

## Scope

The Nobulex SDK generates and verifies receipts. It does not:

- Store secrets or private keys persistently
- Make network requests
- Execute agent actions

The SDK is a pure cryptographic library. The security boundary is the receipt format and its verification logic.
