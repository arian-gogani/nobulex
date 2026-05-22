# Nobulex Bilateral Receipt Test Vectors v0.1

Conformance test vectors for the nobulex bilateral-receipt format.

## Derivation

- `action_ref = SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))`
- JCS: RFC 8785, sorted keys, minimal encoding
- SHA-256: lowercase hexadecimal
- Signature: Ed25519 over JCS-canonical receipt body

## Vectors

| ID | Description | Verdict |
|----|-------------|---------|
| 0001 | Baseline ALLOW receipt (send_email) | ALLOW |
| 0002 | DENY receipt (caught violation) | DENY |
| 0003 | Receipt with policy_version | ALLOW |

## Cross-validation

These vectors are designed for cross-implementation validation
against the x402 canonicalization substrate (53 vectors, 5 impls).

The `action_ref` derivation uses the same JCS canonical preimage
discipline as the shared section in x402-foundation/x402#2326.

## License

Apache 2.0
