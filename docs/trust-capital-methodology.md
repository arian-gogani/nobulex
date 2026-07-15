# trust score Methodology (v0)

Behavioral reputation scoring for AI agents, derived from cryptographically
signed action receipts. Scores are independently reproducible by any verifier
with the issuer JWKS and the receipt corpus.

## Overview

trust score is a reputation score for AI agents derived from a track record of
cryptographically signed action receipts. An agent earns trust score through
verified behavior over time and gates what it is allowed to do on its score.
Autonomy earned, not granted.

## Inputs

Consumes bilateral receipts conforming to OWASP AST09 Execution Receipts
(PR #35, merged June 25, 2026). Per agent_id:

- Admission records: count, verdict distribution (ALLOW/DENY/ESCALATE),
  policy_version churn
- Outcome records: count, paired-admission presence, timing bounds,
  side effects within declared scope
- Denied-before-dispatch signal: DENY admissions with no outcome record
- Time-in-service: earliest verifiable admission to most recent

Receipts must verify against a pre-published JWKS. The verifier never
trusts the emitting runtime.

## Scoring function (v0)

Integer in [0, 1000]. Initial value at first verified action: 100.

Per verified action:
- +2  ALLOW admission with matching outcome record within declared scope
- +3  DENY admission with no outcome record and correct policy_version binding
- -8  ALLOW admission whose outcome shows side effects outside declared scope
- -15 missing outcome record after ALLOW admission
- -25 signature failure on any receipt
- -50 policy_version mismatch vs policy known in effect at that timestamp

Decay: -5 per 30 days with no signed receipt activity. Idle agents do not
accumulate reputation.

Bounds: min 0, max 1000. Rate-limited such that 1000 requires at least
90 days of continuous verified activity.

## Autonomy gating (intended use)

- below 200: read-only actions
- 200-500: reversible actions within scope
- 500-800: externally-reversible actions
- 800+: irreversible actions permitted with additional policy checks

Other uses: underwriting input (one signal among many), minimum-score
requirements before delegating to subagents.

## Non-goals

- Not a safety guarantee. One signal, not the only one.
- Not a substitute for pre-execution policy enforcement.
- Not a universal identifier. agent_id is a signing key; rotation resets score.

## Public verification

Scores compute from public receipts. Any verifier with issuer JWKS and the
receipt corpus reproduces the score independently. Nobulex does not gate this.

Planned endpoint: https://api.nobulex.com/v0/score/{agent_id}
Returns: score, input receipt count, confidence interval from data completeness.

## Out of scope for v0 (v1 roadmap)

Cross-issuer aggregation, adversarial injection resistance beyond signature
verification, trust score transfer at delegation, interpretability audits.

## References

- OWASP AST09 PR #35 (merged June 25, 2026)
- EU AI Act Article 12 (enforcement December 2, 2027)
- github.com/arian-gogani/nobulex
