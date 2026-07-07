# Mission Control Reference Implementation

TypeScript reference implementation of the nobulex Trust Capital integration described in [../builderz-labs-mission-control-rfc.md](../builderz-labs-mission-control-rfc.md).

This is not a published npm package. It is a self-contained reference that the Mission Control maintainers can copy or adapt into their codebase. It uses Node's built-in `node:crypto` for Ed25519 verification and the `canonicalize` npm package for RFC 8785 JCS.

## What's in here

```
src/
  types.ts     Type definitions for nobulex-trust-attestation-v1, BlendResult, etc.
  verify.ts    Attestation verification (structural + signature + freshness + allowlist)
  blend.ts     Pure blend function + full pipeline (verify then blend)
  index.ts     Public API surface
tests/
  blend.test.ts  Unit tests for the blend math (no crypto needed)
```

## What it does

Three composable pieces:

**1. `verifyAttestation(payload, opts)`** runs four checks in sequence and returns the first failure reason:
- Structural well-formedness (required fields present and correctly typed)
- Issuer is on the operator's trusted-issuer allowlist
- Attestation is within the freshness window (default 7 days)
- Ed25519 signature verifies against the issuer's resolved DID Document key

**2. `blendVerified(local, validExternals, maxExternalWeight)`** is a pure function that takes already-verified attestations and computes the blended Trust Capital. Three safety properties hold by construction:
- Local signals always count for at least `(1 - maxExternalWeight)` of the final score
- Each issuer's influence is bounded by its registered `max_weight`
- The aggregate of external weights cannot exceed `maxExternalWeight` (default 0.3)

**3. `blendExternalAttestations(local, candidates, opts)`** is the full pipeline: verify each candidate, drop the failures (returned in `rejected` for audit logging), blend the survivors with the local score.

## Why DID-based identity

A portable cross-deployment identity needs to be:
- **Globally unique** without depending on display names
- **Verifiable from the identifier alone** without an out-of-band registry
- **Method-agnostic** so future identity systems (on-chain DIDs, etc.) plug in

DIDs satisfy all three. The verifier delegates DID resolution to the `DidResolver` interface so Mission Control can plug in `did:web`, `did:key`, or anything else without changing this code.

## Why a trusted-issuer allowlist

It's the anti-inflation primitive. Without an explicit allowlist, anyone could publish signed attestations claiming high trust capital for an agent and have them counted. With the allowlist, only issuers a workspace admin has explicitly added can affect the blended score. Unknown issuers are not blended  - they're returned in the `rejected` array so the operator can see they tried.

## Why the cap

A single trusted issuer with a buggy or compromised scoring algorithm should not be able to override local signals. The `maxExternalWeight` cap (default 0.3) guarantees that local signals always count for at least 70% of the final score, regardless of how many issuers are trusted or how high their individual weights are set.

## Running the tests

```bash
cd docs/integrations/mission-control-reference-impl
npm install
npm test
```

Tests cover the blend math; signature verification tests would require generating Ed25519 keypairs and would belong in a separate test file (`verify.test.ts`).

## What's NOT here

This implementation deliberately does not include:
- The database migration for `trusted_attestation_issuers` (Mission Control's schema layer)
- The admin UI for managing the allowlist (Mission Control's frontend)
- The HTTP endpoint that accepts attestations (Mission Control's API layer)

Those are the parts that depend on Mission Control's specific stack and conventions. The verify and blend logic above is what's portable.

## Integration plan

If the Mission Control maintainers want to use this:
1. Copy `src/types.ts`, `src/verify.ts`, `src/blend.ts` into their tree (or vendor as a dependency)
2. Implement the `DidResolver` interface against their preferred DID method
3. Implement the `TrustedIssuerStore` interface against their database
4. Add a database migration for the `trusted_attestation_issuers` table per the RFC
5. Add a POST endpoint that calls `blendExternalAttestations` and writes the result to `agent_trust_scores`

## License

MIT. Same as the parent nobulex repo.
