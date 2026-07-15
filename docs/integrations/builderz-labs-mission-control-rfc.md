# RFC: Cross-Deployment Trust Score for Mission Control

> **Status:** Draft for discussion on [builderz-labs/mission-control#678](https://github.com/builderz-labs/mission-control/issues/678)
> **Author:** Arian Gogani (nobulex)
> **Audience:** @0xNyk and Mission Control contributors

## Problem statement (from @0xNyk's reply)

Mission Control's `agent_trust_scores` table is currently keyed by `(agent_name, workspace_id)`. Trust is local and per-deployment: when an agent runs in two workspaces, it gets two unrelated scores; when an operator runs many agents, MC can't tell them apart from agents with the same display name run by someone else.

Three things are needed to accept external trust score as a scoring input:

1. **A portable cross-deployment agent identity.** Globally unique, not display-name based.
2. **A federation/import format with a trusted source boundary.** Whose attestations does MC accept, and how are they signed so they can't be forged to inflate scores.
3. **A blend policy.** How external trust score weights against MC's local signals.

This document proposes a concrete design for all three.

## 1. Agent identity: DID-based, transport-agnostic

The portable identifier is a W3C DID. MC accepts any DID method but resolves and verifies via the standard DID resolution path.

```typescript
type AgentIdentity = {
  did: string;                    // e.g. "did:web:agent.example.com" or "did:key:z6Mk..."
  verificationMethod: string;      // DID Document fragment, e.g. "#key-1"
  // Local mapping retained for backward compat
  agent_name: string;
  workspace_id: string;
};
```

Why DIDs:
- DID resolution is method-agnostic: `did:web` for ops with domain control, `did:key` for ephemeral, future on-chain methods (`did:aip`, etc) plug in without schema change.
- The `verificationMethod` is what MC validates signatures against. This is what makes external attestations forgery-resistant.
- Migration is non-breaking: existing `(agent_name, workspace_id)` rows keep working. When an external attestation arrives, MC looks up the DID; first-time DIDs create new rows linked to the same agent.

## 2. Federation format: `nobulex-action-ref-v1` attestations

External trust score is delivered as **signed attestations** in the action-ref-v1 format (already cross-validated with byte-identical results across Python + JS implementations).

```json
{
  "schema": "nobulex-trust-attestation-v1",
  "issuer": "did:web:nobulex.com",
  "subject": "did:web:agent.example.com",
  "issued_at_ms": 1748769600000,
  "claim": {
    "trust_capital": 47.3,
    "tier": "Standard",
    "observation_window_ms": 2592000000,
    "receipt_count": 1247,
    "deny_rate": 0.018
  },
  "evidence": {
    "receipt_chain_head": "sha256:47fdb4e6c98819b154a4157fa2d7ec95...",
    "verifier_endpoint": "https://verify.nobulex.com/chain/...",
    "spec": "action-ref-v1.0"
  },
  "signature": {
    "alg": "Ed25519",
    "jcs_canonical": true,
    "value": "hex:..."
  }
}
```

Properties:
- **JCS-canonical (RFC 8785).** Signature covers the canonical preimage; tampering with any field invalidates it.
- **Issuer is itself a DID.** MC validates the signature against the issuer's DID Document `verificationMethod`. No PKI, no API keys.
- **Evidence is verifiable independently.** `receipt_chain_head` lets a sceptical MC operator fetch and recompute the chain instead of trusting the issuer.

### Trusted source boundary

MC maintains an allowlist of trusted issuer DIDs in `trusted_attestation_issuers`:

```sql
CREATE TABLE trusted_attestation_issuers (
  issuer_did TEXT PRIMARY KEY,
  max_weight REAL NOT NULL DEFAULT 0.5,    -- caps influence per-issuer
  added_at INTEGER NOT NULL,
  added_by TEXT NOT NULL,                  -- audit trail of who approved
  notes TEXT
);
```

Issuers are added explicitly by a workspace admin. An unknown issuer's attestation is ignored, not blended. This is the **anti-inflation primitive**: no one can drop external attestations into MC and get them counted unless an admin has explicitly trusted that issuer for that workspace.

## 3. Blend policy: capped weighted average with provenance

External trust score does not replace MC's local scoring. It contributes to a blended score where the operator controls the maximum influence external sources can have.

```typescript
function blendedTrust(local: number, externals: ExternalAttestation[]): BlendResult {
  const validExternals = externals
    .filter(a => verifySignature(a) && isTrustedIssuer(a.issuer))
    .filter(a => Date.now() - a.issued_at_ms < FRESHNESS_WINDOW_MS);  // default: 7d

  if (validExternals.length === 0) {
    return { score: local, sources: ['local'] };
  }

  // Hard cap on external influence (default 30% total across all issuers)
  const MAX_EXTERNAL_WEIGHT = 0.3;

  const weightedSum = validExternals.reduce((sum, a) => {
    const issuerWeight = trustedIssuers.get(a.issuer)!.max_weight;
    return sum + (a.claim.trust_capital * issuerWeight);
  }, 0);
  const totalIssuerWeight = validExternals.reduce(
    (sum, a) => sum + trustedIssuers.get(a.issuer)!.max_weight, 0
  );
  const externalAvg = weightedSum / totalIssuerWeight;
  const effectiveExternalWeight = Math.min(MAX_EXTERNAL_WEIGHT, totalIssuerWeight);

  const blended = local * (1 - effectiveExternalWeight) + externalAvg * effectiveExternalWeight;

  return {
    score: blended,
    sources: ['local', ...validExternals.map(a => a.issuer)],
    breakdown: { local, external: externalAvg, weight: effectiveExternalWeight },
  };
}
```

Properties:
- **Local always counts.** Even with multiple trusted issuers, local signals get at least 70% weight by default. Tunable per workspace.
- **Per-issuer weight cap.** A single bad-actor issuer with admin trust can affect at most their `max_weight`, defaulting to 0.5.
- **Freshness window.** Stale attestations (default >7d) are dropped. Forces issuers to keep evidence current.
- **Provenance in the result.** `sources` and `breakdown` go to the audit log; admins can see exactly why a score moved.

## What this gives Mission Control

1. **Globally unique agent identity** without ripping out the existing `(agent_name, workspace_id)` key.
2. **Forgery resistance** via DID-resolved signature verification, not API keys.
3. **Operator control** via the trusted-issuer allowlist and weight caps. No vendor lock-in.
4. **Audit trail** because every blended score carries its sources.
5. **Future-compatible** because new DID methods and new attestation issuers compose without schema change.

## What's needed from Mission Control

- Add the `trusted_attestation_issuers` table (one migration).
- Add a `did` + `verificationMethod` column to `agent_trust_scores` (nullable for backward compat).
- Endpoint that accepts a signed `nobulex-trust-attestation-v1` payload and updates the blended score for matching agents.
- Admin UI for managing the issuer allowlist.

Reference implementation in TypeScript (matching MC's stack): I can put a draft PR up against `mission-control` showing the migration, verification logic, and blend function if there's interest.

## What's available from Nobulex side today

- The action-ref-v1 spec and test vectors are at [arian-gogani/nobulex](https://github.com/arian-gogani/nobulex) (cross-validated, byte-identical across Python + JS).
- A working specimen receipt with verification recipe is at [fixtures/agentaudit-specimen-v1.json](https://github.com/arian-gogani/nobulex/blob/main/fixtures/agentaudit-specimen-v1.json).
- `pip install nobulex` for the receipt generator.

Open questions for the thread:
- Are DIDs the right portability primitive, or should MC bind to something narrower (a wallet address, a Github org)?
- Should the issuer allowlist be workspace-scoped, deployment-scoped, or both?
- Is 30% the right default external weight cap, or should this be opinionated per-tier (e.g. unrestricted agents get more local weight)?

Happy to iterate. The goal is something MC ships, not a paper RFC.
