# @nobulex/langchain

**The paper trail for AI agents.** Three lines of code. Every LangChain agent action becomes signed, hash-chained, independently verifiable evidence.

```bash
npm install @nobulex/langchain
```

## The 3-line integration

```typescript
import { nobulex } from '@nobulex/langchain'

const agent = nobulex.wrap(yourAgent, { covenant: 'your-policy-id' })
const result = await agent.invoke(input)   // same call, same result
```

That is the entire integration. No workflow changes. No new SDK. Every LLM call, tool invocation, and chain step inside `yourAgent` is now intercepted and recorded as a signed evidence item.

## What you get

After any agent run:

```typescript
const auditLog = await agent.getAuditLog()
// → { items, merkleRoot, signature, signerPublicKey, agentId, covenant, ... }

const integrity = await agent.verifyIntegrity()
// → { valid, errors, totalItems, merkleRoot, signatureValid }
```

Every action is:

- **Hash-chained**  - tampering is cryptographically detectable
- **Signed**  - Ed25519 signatures over the Merkle root
- **Independently verifiable**  - any third party can run `verifyIntegrity()` against the public key without trusting you
- **Court-, audit-, and underwriter-grade**  - the same evidence holds up in litigation discovery, regulatory examination, and insurance claims

## Why this exists

Your AI agents are making consequential decisions  - approvals, denials, recommendations, tool calls with side effects. When something goes wrong, the first question every CEO, regulator, auditor, and opposing counsel asks is: *"show me the paper trail."*

Right now you have server logs. Logs are what IT keeps for debugging. A paper trail is what the company keeps for accountability. The difference matters because logs are self-serving  - you control them, you could have modified them, and a competent opposing counsel will say so in court.

Nobulex receipts are bilateral cryptographic evidence. Hash-chained. Signed. Independently verifiable. The same evidence whether the reader is your board, your auditor, your insurer, or an opposing party in litigation.

## Try it

```bash
git clone https://github.com/arian-gogani/nobulex
cd nobulex
npx tsx examples/paper-trail.ts
```

Runs a complete demo end-to-end: a simulated LangChain agent makes a loan decision, the receipts are produced silently, integrity is verified, and the audit log is printed. ~5 seconds, no API keys required.

## API

### `nobulex.wrap(runnable, options)`

Wraps any LangChain Runnable (agent, chain, or tool with an `invoke()` method).

```typescript
const agent = nobulex.wrap(myAgent, {
  covenant: 'lending-policy-v3',
  agentId: 'loan-agent-prod-east-1',   // optional, auto-generated otherwise
})
```

Returns a `NobulexWrapper` with the same `invoke()` signature as the original, plus:

- `agent.invoke(input, options?)`  - forwards to the wrapped runnable, injecting the audit handler
- `agent.getAuditLog()`  - full signed audit log with Merkle root
- `agent.getComplianceReport()`  - EU AI Act Article 12 formatted compliance report
- `agent.verifyIntegrity()`  - independent verification of the entire receipt chain
- `agent.handler`  - the underlying callback handler for advanced use
- `agent.agentId`, `agent.covenant`  - identifiers

### `nobulex.createHandler(agentId?)`

For advanced use cases where you need to attach the callback handler manually rather than wrapping a runnable.

```typescript
const handler = nobulex.createHandler('my-agent-id')
const chain = new LLMChain({ callbacks: [handler], ... })
```

## What gets recorded

Every LangChain lifecycle event produces a signed evidence item:

| Action type | When |
|---|---|
| `chain_start` / `chain_end` / `chain_error` | Chain invocation boundaries |
| `llm_start` / `llm_end` / `llm_error` | Every LLM call |
| `tool_start` / `tool_end` / `tool_error` | Every tool invocation |

Each item contains: a unique ID, timestamp, agent ID, action type, input hash, output hash, run ID, parent run ID, and a self-hash. Items are batched into a Merkle tree; the root is signed with the agent's Ed25519 private key.

## Performance

The handler is async and non-blocking. Hashing is SHA-256 (Web Crypto). Signing is Ed25519. Typical overhead per action: <1ms. The Merkle tree is constructed only when you call `getAuditLog()`, not on every action.

## Standards

- Ed25519 signatures per RFC 8032
- SHA-256 hashing per FIPS 180-4
- JCS canonicalization per RFC 8785
- Compatible with CTEF v0.3.x claim envelopes
- EU AI Act Article 12 record-keeping aligned

## License

MIT. See [LICENSE](../../LICENSE).

## More

- Main repo: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
- Website: [nobulex.com](https://nobulex.com)
- Agent Reliability Index: [nobulex.com/observatory](https://nobulex.com/observatory)
