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

## Verify API

The SDK produces receipts locally. The hosted API verifies them:

```bash
curl -X POST https://nobulex.com/api/verify \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"my-agent","action_type":"tool:search",...}'
```

[API docs](https://nobulex.com/api-docs) | [Pricing](https://nobulex.com/pricing) | [Methodology](https://nobulex.com/methodology)

## Learn More

[github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) | [nobulex.com](https://nobulex.com)
