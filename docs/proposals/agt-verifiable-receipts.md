# Proposal: Independently Verifiable Compliance Receipts

**Author:** Arian Gogani (@arian-gogani)  
**Date:** 2026-04-21  
**Status:** Draft  
**Related issues:** #1249, #787, #1196

## Problem

AGT's audit logger writes append-only hash chains. This gives you ordering guarantees, which is good. But the evidence lives on infrastructure the operator controls. If an auditor wants to verify compliance, they have to trust that nobody modified the chain after the fact.

For EU AI Act Art. 12 (enforceable December 2, 2027) and SOC 2 audit scenarios, the question isn't "did you check?" It's "can you prove you checked, and can I verify that proof without trusting you?"

The missing piece: compliance evidence that a third party can verify independently, without access to the operator's infrastructure.

## Proposed solution

When `agent-compliance` runs verification, it emits a signed receipt alongside the compliance grade. The receipt carries enough information for an external verifier to confirm what happened without needing to trust the operator.

### Receipt fields

```json
{
  "receiptId": "sha256:<hash-of-canonical-receipt>",
  "agentDid": "did:key:z6Mk...",
  "timestamp": "2026-04-21T09:30:00Z",
  "covenantHash": "sha256:<hash-of-policy-in-effect>",
  "action": {
    "type": "tool_call",
    "name": "readPatientRecord",
    "inputHash": "sha256:<hash-of-input>"
  },
  "decision": "permit",
  "authorizationHash": "sha256:<hash-of-pre-execution-state>",
  "authorizationSignature": "<ed25519-signature>",
  "resultHash": "sha256:<hash-of-post-execution-state>",
  "resultSignature": "<ed25519-signature>",
  "previousReceiptHash": "sha256:<hash-of-previous-receipt>",
  "signerKeyId": "did:key:z6Mk...#keys-1"
}
```

### What each field does

**`covenantHash`**: Hash of the policy document that was in effect when the action happened. An auditor can check this against the declared policy to confirm the right rules were applied.

**`authorizationHash` + `authorizationSignature`**: Signed before execution. Proves the policy was evaluated and the action was authorized before anything ran. This is the "pre-execution commitment."

**`resultHash` + `resultSignature`**: Signed after execution. Binds the actual outcome to the authorization. This is the "post-execution proof."

Both signatures use the same Ed25519 key (`signerKeyId`), so a verifier can confirm they came from the same agent process.

**`previousReceiptHash`**: Links to the previous receipt in the chain. Change any receipt and every receipt after it breaks. Same principle as AGT's existing hash chains, but now each link is independently signed.

**`decision`**: `permit` or `deny`. If `deny`, the action never executed and the receipt proves the block happened.

## Verification model

A verifier receives a chain of receipts and checks three things:

1. **Signature validity.** Each receipt's Ed25519 signatures are valid against the declared signer key. No private key access needed.
2. **Chain integrity.** Each receipt's `previousReceiptHash` matches the hash of the receipt before it. Any gap or edit breaks the chain.
3. **Policy binding.** Each receipt's `covenantHash` matches the expected policy. The verifier confirms the agent was operating under the right rules.

The verifier doesn't need access to the operator's infrastructure, the agent's runtime, or any trusted third party. The signatures and hashes are self-contained.

## How this maps to AGT

AGT already has the right building blocks:

**agent-compliance** produces compliance grades and OWASP evidence. The receipt would be emitted alongside the grade, not instead of it. The grade tells you "this agent is compliant." The receipt proves it.

**agent-mesh** uses Ed25519 DIDs for agent identity. The receipt uses the same key material. No new crypto infrastructure needed. The agent's existing DID becomes the `signerKeyId` on the receipt.

**Signet attestations (#1196)** use a similar shape. Converging on a shared receipt format between Signet and this proposal would give AGT one consistent evidence format across compliance, tool-call attestation, and audit proofs.

**#787 (physical AI receipts)** can use the same format. The bilateral receipt structure (pre-execution + post-execution signatures) works for physical actuator governance the same way it works for software tool calls.

## Canonicalization

All hashes are computed as SHA-256 of the RFC 8785 JCS (JSON Canonicalization Scheme) canonical form. This means sorted keys, no whitespace, UTF-8 encoding.

This path has been cross-verified between two independent implementations:
- Nobulex (TypeScript/Node.js)
- AgentLedger (Python)

Three test vectors produce byte-identical digests across both implementations. The canonicalization is stable and reproducible.

## Integration path

The simplest integration point: when `agt verify` runs a compliance check, it optionally emits a receipt. The receipt wraps the compliance grade in a signed, hash-chained envelope.

```typescript
// pseudocode for the integration surface
const grade = await agtCompliance.verify(agent);
const receipt = await nobulex.createReceipt({
  agentDid: agent.did,
  covenantHash: hashOf(agent.policy),
  action: { type: "compliance_check" },
  decision: grade.passed ? "permit" : "deny",
  previousReceiptHash: lastReceipt.hash
});
// receipt is now independently verifiable
```

Operators who don't need independent verifiability keep using AGT as-is. Operators in regulated environments turn on receipts and hand them to auditors.

## Cross-framework status

This receipt format is also being discussed in:
- LangChain RFC #35691 (12+ teams)
- AutoGen discussion #7609
- CrewAI issue #5541
- NousResearch hermes-agent #487
- OpenLineage PR #4480 (proposed as a facet in the Linux Foundation spec)
- aeoess/agent-governance-vocabulary interop test #36 (4 independent implementations)

Converging on one receipt format across AGT, these frameworks, and the OpenLineage spec would give the ecosystem a single evidence standard rather than N competing formats.

## Next steps

Happy to iterate on this. If the direction looks right, I can follow up with a concrete implementation PR against `agent-compliance`.
