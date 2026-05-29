# @nobulex/core

Cryptographic covenant lifecycle for the Nobulex framework: build a signed
covenant that declares what an agent is permitted to do, then verify it
independently. Ed25519 signatures over RFC 8785 canonical JSON.

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

- `generateKeyPair()` — Ed25519 keypair (`privateKey`, `publicKeyHex`)
- `buildCovenant(options)` — build and sign a covenant document
- `verifyCovenant(doc)` — verify signature, id, and constraints
- `countersignCovenant(doc, keyPair, role)` — add a counterparty signature
- `resolveChain(doc, resolver)` — walk a delegation chain
- `serializeCovenant` / `deserializeCovenant` — JSON round-trip

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) · [nobulex.com](https://nobulex.com)
