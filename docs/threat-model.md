# Threat Model

This document is a working sketch, not a formal security proof. It describes
what Nobulex is built to protect against today, what it explicitly does not
protect against, and the assumptions we're relying on. If you're integrating
Nobulex into a system that makes real decisions about real money, read this
carefully and decide whether the gaps are acceptable for your setting.

## What Nobulex is

At the core, Nobulex gives an agent (or any actor) a way to produce a signed,
chained record of actions that were taken under a stated policy (a covenant),
so a later verifier can reconstruct what happened and decide whether the
policy was followed. The primitives in this repo are the covenant language,
the attestation chain, the crypto wrappers, and the verifier.

## What we protect against

### Tampering with historical actions

Each attestation is hashed and the next attestation includes the previous
hash, producing a chain. An attacker who modifies a historical record has
to rewrite every subsequent record and re-sign each one. As long as any
verifier is holding an earlier, trusted tip of the chain, the forgery is
detectable. This is the standard append-only-log property, and we lean on
it heavily.

### Forged attestations from an unknown key

Attestations carry an Ed25519 signature and a reference to the signing key
(via DID). Without the private key, an attacker cannot produce an attestation
that a verifier will accept for that identity. The usual caveat applies:
this protection is only as strong as your key management.

### Covenant policy drift

A covenant document is content-addressed — its hash is what gets referenced
in attestations. Swapping in a more permissive version of a covenant after
the fact doesn't help an attacker, because the verifier is checking against
the specific hash the action committed to.

### Replay across contexts

Attestations are scoped to a session, and session digests are part of the
chain. Lifting a valid attestation from one session and dropping it into
another produces a chain that doesn't verify.

### Malformed input to public entry points

The SDK public surface now validates its arguments at runtime (empty
strings, wrong-length keys, missing required fields) and throws typed
errors. This is a defense-in-depth measure, not a security boundary —
it's about failing loud and fast instead of silently producing garbage.

## What we do NOT protect against

### Key compromise

If the private key for an identity is leaked, stolen, or extracted from a
compromised machine, the attacker can produce valid-looking attestations
indistinguishable from real ones. We have no key revocation mechanism yet:
there's no trust list, no revocation registry, no "kill this DID" story.
Key custody is entirely the operator's problem.

### Denial of service

Nothing in the library does rate limiting. A caller that hands us
pathologically large CCL documents, deeply nested conditions, or huge
attestation chains will consume CPU and memory proportional to what they
sent. If your deployment is exposed to untrusted callers, put a rate limiter
and a size cap in front.

### Verifier liveness

Nobulex produces evidence; it does not make the evidence available. If the
party that needs to verify can't reach the chain (network partition, lost
storage, offline), they can't verify. Availability is out of scope.

### Side channels

The crypto wrappers use constant-time primitives where the underlying
library provides them, but we have not audited the whole call path for
timing side channels. If your threat model includes an attacker who can
measure wall-clock time of operations on your server, treat this library
as unvetted for that setting.

### Trusted execution claims

The TEE integration package does what the TEE says. If the TEE is
compromised or the attestation document from the TEE is forged, we have
no independent way to detect that — we're trusting the hardware root of
trust, period.

### Social engineering, supply chain, compromised dependencies

Standard ecosystem risk. We pin dependencies in the lockfile but we don't
run a reproducible build, we don't sign releases, and we don't do
deterministic dependency auditing. If an upstream package is backdoored,
we probably eat it along with everyone else.

### Privacy

Attestation records contain claims about what was done. They are not
encrypted. A verifier who sees the chain sees everything in the chain.
If you need to hide the contents of actions from the verifier, you need
a zero-knowledge construction, which this library does not currently
provide.

## Trust assumptions

- The signer's key is held by the signer and nobody else.
- Clocks are "roughly right" — attestation timestamps are not used for
  security-critical ordering (the chain links provide ordering), but they
  are used in CCL time-window policies, and a sufficiently skewed clock
  on the prover's side will cause policy evaluation to go sideways.
- The underlying Ed25519 and SHA-256 primitives from `@noble/*` are
  correct and constant-time.
- The runtime (Node.js) is not malicious — we don't attempt to defend
  against a hostile JavaScript engine.

## Known limitations

- **No key revocation.** Tracked; planned. See the auth/identity roadmap.
- **No rate limiting in the library.** Wrap it at the edge.
- **No formal verification of the CCL evaluator.** It's tested, not proven.
- **No audit.** No third party has reviewed this code.
- **No HSM / KMS integration on the prover side yet.** Private keys
  currently live in process memory; getting them out of process memory
  is an operator responsibility.

## Reporting issues

If you find a security issue, please file it privately rather than
publicly. See SECURITY.md (if/when it lands in this repo) or email the
maintainers directly.
