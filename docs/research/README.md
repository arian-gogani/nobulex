# Nobulex evidence notes

Small, executable explanations of what a verification result establishes and what it leaves unresolved. This is an early research collection, not a standard, certification program, or claim of institutional adoption. The financial decision-integrity prototype remains in [nobulex-registry](https://github.com/arian-gogani/nobulex-registry).

| Note | Reproduction | Scope |
|---|---|---|
| [Hash-chain consistency is not event completeness](chain-consistency.md) | `python3 examples/receipt_chain_limits.py` from repository root | Eight fictional cases, no external dependencies |

## Contributing a case

Useful contributions are small inputs that change a concrete verdict, including cases where our expected verdict is wrong. Include:

1. The claim being tested and the assumptions it needs.
2. Public, fictional, or appropriately sanitized input. No credentials or personal records.
3. The exact command, runtime, observed output, and exit code.
4. The expected result and why it follows from those assumptions.
5. A clean control case, plus a deliberately broken implementation that the check rejects.
6. Known limits, source references, and any conflict of interest.

Use an issue for ordinary documentation or synthetic-case feedback. Do not place an undisclosed third-party vulnerability in a public issue; use that project's published security channel.

## Editorial rules

- Each note must run locally without a customer account.
- Missing evidence is labeled as missing, not counted as a passing check.
- A passing example is not evidence of production coverage or real-world completeness.
- Reports of external use and independent reproduction require a link and an explicit statement of what the external party did. Self-runs do not count.
- Corrections remain visible. A withdrawn claim keeps its reason for withdrawal.
- No paid badges, compliance conclusions, product endorsements, or star-count thresholds.

External review is welcome. Inclusion in this collection does not mean MITRE, OWASP, or any other organization has accepted it.
