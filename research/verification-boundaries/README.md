# What did PASS actually check?

**A reproducible study of five verification boundaries.** Arian Gogani / Nobulex, September 26, 2026. Version 1.

A successful verification result answers a bounded question. It can establish that a signature matches a key while leaving the key's authority unresolved. It can establish that a supplied log is internally consistent while saying nothing about events omitted before recording. Treating either result as a wider guarantee creates false confidence.

This report combines **six paired historical parser cases** with **27 deliberately constructed fixtures across five small models**. It is an executable explanation, not a prevalence study, a new cryptographic result, or a production certification. The historical defect was in **our own Nobulex driver contributed to an external repository**. We do not present it as a discovery in an independently authored product.

## The reproduced historical result

We executed the before and after modules for [ScopeBlind's merged PR #22](https://github.com/ScopeBlind/agent-governance-testvectors/pull/22), using fixed commits and verifying the source hashes before execution.

| Input | Before fix | After fix |
|---|---|---|
| Principal restriction outside the supported subset | allow | REFUSED |
| Resource restriction outside the supported subset | allow | REFUSED |
| `unless` restriction outside the supported subset | allow | REFUSED |
| Supported unconditional action | allow | allow |
| Supported matching condition | allow | allow |
| Supported nonmatching condition | deny | deny |

The error was interpreting unsupported policy syntax as though the restriction were absent. The fix refuses it. **REFUSED does not mean the policy is invalid in full Cedar.** This parser supports a subset; we did not execute a full Cedar implementation or test Cedar conformance.

The exact policies, observations, commits, and SHA-256 hashes are in [historical-results.json](historical-results.json). These are historical revisions, not a current upstream audit. Three controls remain unchanged, which bounds the claim more usefully than merely showing three refusals.

## Five boundaries, with runnable counterexamples

Each family has a deliberately weak branch and a reference branch implementing the stated boundary. Expectations are hand-written. The branches share fixture generation and code, so the reference is **not an independently implemented oracle**.

| Family | Question being tested | Reference expected-verdict matches | Weak expected-verdict matches |
|---|---|---:|---:|
| Coverage | Did verification inspect enough supplied receipts to justify its result? | 6/6 | 2/6 |
| Key origin | Does the signature match a separately selected trust anchor? | 4/4 | 1/4 |
| Policy interpretation | Are operative restrictions understood rather than ignored? | 5/5 | 3/5 |
| Log consistency | Does the supplied chain agree with a retained endpoint checkpoint? | 8/8 | 4/8 |
| Evidence preservation | Does a failed replacement retain the prior evidence? | 4/4 | 1/4 |

These are **matches to constructed expectations, not detection accuracy**. They do not estimate how common these failures are. In particular, L08 deliberately expects PASS despite an event being omitted before recording. Both implementations meet that expectation. The aggregate includes this admitted blind spot; it must not be advertised as a security success rate.

### 1. Coverage is part of the claim

The weak model checks only the last of four signed receipts. Corrupting an earlier receipt therefore leaves its result unchanged. The reference checks until the first failure and refuses to call an empty collection verified. Tests also enumerate all 15 nonempty subsets of corrupted positions.

A failure can be established by one counterexample; a successful result requires checking all supplied receipts. The `checked` field counts actual verification calls, including short-circuit behavior. Neither model proves that all real-world actions were supplied.

### 2. A matching key is not an authorized key

The weak model accepts the key embedded in the receipt itself. The reference uses an externally supplied anchor, returning UNKNOWN when it is missing. A signature under a different supplied anchor fails. Conversely, a key labeled `attacker` in the fixture succeeds when explicitly selected as the anchor: the label is not a security property.

The experiment assumes the external anchor is legitimately selected. It does not implement identity verification, anchor distribution, rotation, or revocation. Keys are deterministic, public test material and must never be used in a deployment.

### 3. Unsupported policy is not absent policy

The synthetic policy accepts only an action and an effect. Ignoring extra operative fields produces a permit that the reference declines to issue. This tiny JSON language is not Cedar. Missing or null action values return UNKNOWN rather than comparing two absent values equal. The historical replay above provides a separate real-code example of ignoring unsupported syntax; it does not validate every synthetic family.

### 4. A chain is not a record of everything

Internal hash linkage detects simple edits and interior deletion. By itself it accepts a valid prefix or a freshly recomputed chain. Comparing with a separately retained original head detects those changes in this fixed-endpoint experiment.

Checkpoint authenticity and retention are assumed, not implemented. This is not an append-consistency protocol: a legitimate extension would also differ from the fixed head. JSON encoding is fixture-specific, not a canonicalization interoperability standard. An event omitted before both recording and checkpoint creation remains invisible. **We retain that limitation as case L08.**

### 5. A refusal must not erase the evidence

The weak model clears old records before generating replacements. A later failure leaves evidence absent or partial. The reference prepares replacements before switching the stored array. Policy, signer, and second-record failures are exercised.

Here PASS means **the storage invariant holds**, including when the operation is REFUSED. It does not mean the operation was approved. Storage is an in-memory array, not a filesystem transaction. No crash, concurrent writer, persistence, or recovery guarantee is tested.

## Run it

From this repository's root, using Node with its built-in test runner:

```sh
node research/verification-boundaries/benchmark.mjs
node --test research/verification-boundaries/test.mjs
```

No package installation, financial credentials, or customer data is required. The synthetic run is offline. Tested locally with Node v25.1.0; compatibility with other versions has not been measured.

The historical replay is a separate, explicit opt-in. Review [reproduce_parser.py](reproduce_parser.py) and its pinned source URLs first. It downloads and **executes two hash-pinned public Python modules**, using the standard library:

```sh
python3 research/verification-boundaries/reproduce_parser.py --fetch-pinned
```

Alternatively, supply reviewed `before.py` and `after.py` files with the documented hashes:

```sh
python3 research/verification-boundaries/reproduce_parser.py --source-dir /path/to/reviewed-sources
```

Tested locally with Python 3.14.7. A changed source hash refuses execution. [results.json](results.json) contains the deterministic synthetic results. The test suite compares them with a fresh run. Each of five deliberate regressions to a weak model must produce CLI exit 1; a malformed CLI request exits 2.

## What public upstream evidence supports

All four pull requests below were merged. Source inspection checked nine changed-file occurrences against merged content. **Only #22 was executed again for this report.** Test results stated in the other PRs remain attributed historical reports, not fresh reproductions here.

| Public record | Bounded relevance |
|---|---|
| [ScopeBlind #15](https://github.com/ScopeBlind/agent-governance-testvectors/pull/15) | Verifier-loop coverage change in the conformance harness. |
| [ScopeBlind #22](https://github.com/ScopeBlind/agent-governance-testvectors/pull/22) | Unsupported-syntax rejection in Nobulex's own contributed parser; six paired cases reproduced above. |
| [ScopeBlind #23](https://github.com/ScopeBlind/agent-governance-testvectors/pull/23) | Preservation ordering in Nobulex's own contributed emitter. |
| [ScopeBlind #24](https://github.com/ScopeBlind/agent-governance-testvectors/pull/24) | Embedded-key negative fixtures and refusal checks. This is not evidence that a current verifier accepted an unauthorized key. |

A maintainer merging a contribution is not an endorsement of Nobulex's product or this report. We claim no MITRE, OWASP, standards-body, or customer endorsement.

## Prior art and what is not new

These questions have long-established foundations. Complete mediation and fail-safe defaults are articulated by [Saltzer and Schroeder](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html). Separately supplied trust-anchor inputs appear in [RFC 5280 §6.1.1](https://www.rfc-editor.org/rfc/rfc5280.html#section-6.1.1). We use that as a conceptual connection, not a requirement to deploy X.509.

[Experimental RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.html#section-2.1.2) specifies transparency-tree proofs relative to tree heads. Such proofs do not establish that every real event entered the log. Our toy hash chain is not an implementation of that protocol.

[XACML 3.0 §§7.19.1–7.19.3](https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html) addresses unsupported optional functionality through Indeterminate results; this is not a blanket prohibition on ignorable extensions. [RFC 6960 §2.2](https://www.rfc-editor.org/rfc/rfc6960.html#section-2.2) illustrates deliberately scoped good/revoked/unknown states. Our UNKNOWN is not a claim of conformance to either specification.

The contribution here is a small, inspectable set of reproductions and counterexamples tying these boundaries together. No claim of first discovery is made.

## Corrections found while preparing this report

Our initial benchmark had four defects. An AI-assisted adversarial review reproduced them; the original 12 tests did not catch them.

1. An inherited model name such as `constructor` could bypass family selection and report success without running a model. Empty direct studies also needed refusal.
2. Short-circuited verification reported the number of candidates as the number checked.
3. Two missing policy actions compared equal and could yield PASS.
4. A misspelled failure selector silently ran a successful replacement.

We added four regression tests and ran them on the original implementation: **12 passed, 4 failed**. After correction, **16 passed, 0 failed**, using the same test command. The original 27 fixture verdicts did not change; three reference `checked` counts were corrected. The tests now also assert refusal and retained storage independently for the supported failure selectors.

These corrections are part of the result, not evidence of a perfect harness. The suite tests stated fixtures and invariants, not arbitrary malformed inputs or all possible implementation bugs.

## Limits, authorship, and review

This is developer-run, AI-assisted research. AI agents helped create, review, and check artifacts; that is not independent human replication or peer review. Nobulex is both author and subject of the historical driver fixes, a conflict made explicit here.

No random product sample, financial-loss estimate, production deployment, customer adoption, or effectiveness of the current gateway is established. No held third-party findings are included. The gateway remains a prototype; this report does not certify it.

To challenge the report, provide a case ID, runtime, command, observed result, and the reason the stated expectation is wrong. Counterexamples and independently reproduced runs are more useful than endorsements. Ordinary research feedback can go to this repository's issues; undisclosed security findings belong in the affected project's security channel.
