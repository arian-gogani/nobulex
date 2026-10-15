# Nobulex: Current Idea

This is the canonical current product thesis. Use it when describing Nobulex or making product and business decisions. Do not substitute the earlier agent-governance, generic financial firewall, broad data-integrity infrastructure, or standalone reconciliation framings.

## One sentence

> Nobulex finds the money software loses while reporting success, proves it with a reproduction and a regression test, and never claims more than it proved.

## The thesis

Software can report successful execution without being financially correct. Execution success and arithmetic truth are checked by different machinery, and the second check is often missing. Nobulex looks for discrepancies where billing or other money-moving software reports success, reproduces the defect, and preserves a test that can catch it again.

The current evidence motivating this thesis is the founder's reported audit of four production billing systems in one afternoon, which found instances of a shared defect class. These findings motivate the product direction; they are not, by themselves, proof of market demand or prevalence across the industry. Any public description must stay within the exact scope and evidence of each reproduction.

## Product staircase

1. **Billing Integrity Audit, now.** A fixed-fee audit of one revenue path at a pinned revision. Deliver a reproducible finding, regression test, and a report that states what was and was not established.
2. **Scanner, next.** Inspect historical billing events for internal contradictions without requiring Nobulex to know every customer's private business rules. This is intended to move beyond one-off audit revenue.
3. **Mutation CI, the revised product direction.** Deterministically mutate payloads and replay them on each code change. Check properties that can be tested without inferring the customer's business rules, such as order independence, idempotency, variant equivalence, and ingest-to-billing visibility.
4. **Differential engine, later.** The out-of-band comparison engine remains a possible enterprise layer, after the audit and CI product establish a reliable base.

## Why Mutation CI is the revision

The founder reports that three of four audited findings corresponded to the proposed mutation classes: reordering same-instant facts, changing format variants at ingest, and injecting null into a nullable field. Mutation CI packages those defect patterns as a recurring check instead of stopping at a one-time audit. The report should preserve the exact tested systems, revisions, cases, and outcomes rather than generalize beyond them.

## What was rejected or changed

- **Generic Data Integrity Infrastructure:** too abstract for the initial buyer and loses the familiar billing vocabulary.
- **Invariant Agent:** do not infer customer invariants from schemas and history as the core product. False positives could make a CI gate untrustworthy and quickly disabled.
- **Out-of-band differential engine as the immediate product:** retain it as a later enterprise capability; prioritize Mutation CI as the recurring product path.
- **Registry as a zero-defect stamp:** a finite run cannot prove that unobserved defects do not exist. The registry should issue a bounded receipt stating the corpus, variants executed, seeded-defect catch rate, and uncovered areas. Never sell a safety stamp.

## Positioning guardrails

- Lead with billing correctness and software that reports success while producing the wrong amount.
- The audit is the initial paid entry point; Mutation CI is the intended scalable, recurring product.
- Every finding needs a reproduction and a regression test where feasible.
- Receipts report the scope and limits of a run. They do not prove zero defects or universal correctness.
- Keep evidence of technical defects separate from evidence of customer demand. The market and willingness to pay remain to be validated.
