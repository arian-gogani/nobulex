# @nobulex/a2a

A2A Agent Card extension for Nobulex proof-of-behavior.

Converts a `ProofOfBehavior` into a JSON extension object that can be embedded in a [Google A2A Agent Card](https://google.github.io/A2A/), letting any A2A-compatible agent advertise cryptographically verifiable behavioral evidence.

## Install

```bash
npm install @nobulex/a2a
```

## Usage

```typescript
import { generateProof } from '@nobulex/sdk';
import { toAgentCardExtension } from '@nobulex/a2a';

// After your agent has run actions through enforcement...
const proof = await generateProof({
  identity: agent,
  covenant: spec,
  actionLog: middleware.getLog(),
  audience: 'did:example:counterparty',
});

// Convert to A2A Agent Card extension format
const extension = toAgentCardExtension(proof);

// Embed in your Agent Card
const agentCard = {
  name: 'PaymentAgent',
  description: 'Processes payments under covenant governance',
  extensions: [extension],
};
```

## Extension Format

```json
{
  "name": "nobulex-behavioral-evidence",
  "version": "1.0",
  "identity": {
    "did": "did:nobulex:abc123...",
    "publicKeyHex": "deadbeef...",
    "verificationMethod": "did:nobulex:abc123...#key-1"
  },
  "behavior": {
    "covenantHash": "aabbccdd...",
    "actionCount": 10,
    "complianceRate": 1.0,
    "proofSignature": "...",
    "generatedAt": "2026-04-16T...",
    "audience": "did:example:verifier",
    "taskClass": "payments"
  }
}
```

A receiving agent can use `verifyCounterparty` from `@nobulex/sdk` against the original `ProofOfBehavior` to independently verify the claims. The extension is a summary for discovery; the full proof is exchanged during the handshake.

## License

MIT
