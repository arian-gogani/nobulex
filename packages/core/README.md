# @nobulex/core

Credit scores for AI agents. Cryptographic receipts for every agent action,
Ed25519 signed over RFC 8785 canonical JSON. The verified track record
becomes portable trust.

## Install

```bash
npm install @nobulex/core
```

## Usage

```typescript
import { generateKeyPair, buildCovenant, verifyCovenant } from "@nobulex/core";

const kp = await generateKeyPair();

const covenant = await buildCovenant({
  issuer: { id: "alice", publicKey: kp.publicKeyHex, role: "issuer" },
  beneficiary: { id: "bob", publicKey: kp.publicKeyHex, role: "beneficiary" },
  constraints: "permit read on '/data/**'",
  privateKey: kp.privateKey,
});

const result = await verifyCovenant(covenant);
console.log(result.valid); // true
```

`verifyCovenant` returns `{ valid, checks }`, where `checks` lists each
individual verification (id match, signature, constraint schema). Change any
field of the document and `valid` becomes `false`.

## API

- `generateKeyPair()`  - Ed25519 keypair (`privateKey`, `publicKeyHex`)
- `buildCovenant(options)`  - build and sign a covenant document
- `verifyCovenant(doc)`  - verify signature, id, and constraints
- `countersignCovenant(doc, keyPair, role)`  - add a counterparty signature
- `resolveChain(doc, resolver)`  - walk a delegation chain
- `serializeCovenant` / `deserializeCovenant`  - JSON round-trip

## Verify

Receipts and covenants verify **offline** — `verifyCovenant(doc)` checks the
signature, id, and constraints with no network call. A hosted verification
service (paid tiers, trust scores, compliance reports) is implemented in
`packages/verify-api/` but is not yet deployed to nobulex.com.

[Pricing](https://nobulex.com/pricing) | [Methodology](https://github.com/arian-gogani/nobulex/blob/main/docs/trust-capital-methodology.md)

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) | [nobulex.com](https://nobulex.com)
