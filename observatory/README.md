# Nobulex Observatory

**The public layer of the Nobulex rating methodology.**

This directory contains the editorially-independent weekly publication produced by Nobulex: the **Agent Reliability Index**.

## What lives here

- **`issue-XXX-*.md`** — Weekly issues of the Agent Reliability Index. Each issue is published Monday and tracks behavior change across major frontier AI agents (Anthropic, OpenAI, Google, Microsoft, others).
- **`incidents/`** *(future)* — Structured records of flagged incidents. Each incident is filed as a separate document for citation.
- **`methodology-changes/`** *(future)* — A change log of every adjustment to the index methodology, with the back-test results that justified each change.

## Why this exists

Most successful trust-infrastructure companies in history started as publications, not as software products: Moody's, Best's, Underwriters Laboratories, FICO, Equifax. The category is entered through analytical authority, not through API endpoints. The published artifact is what builds the brand and the methodology trust. Software and proprietary data come later.

The Agent Reliability Index is Nobulex's published artifact. It runs on publicly-observable data (standardized prompts run weekly, public benchmark deltas, vendor model card changes, public incident reports). It does not require any bilateral receipts to begin operating, which solves the chicken-and-egg of "no data → no rating → no adoption → no data."

In Year 2+, the same methodology scales up to a private, higher-resolution score running on bilateral receipt streams. The public observatory is what makes the private scoring layer credible by the time it launches.

For the full strategic vision, see [`../docs/OBSERVATORY-VISION.md`](../docs/OBSERVATORY-VISION.md).
For the methodology, see [`../docs/AGENT-RELIABILITY-INDEX.md`](../docs/AGENT-RELIABILITY-INDEX.md).

## Editorial policy

1. **Vendor-payment-free.** Nobulex receives no payment from any AI vendor for inclusion, exclusion, weighting, or scoring. This is a contractual commitment and is the structural moat that protects the index against the conflict-of-interest pattern that has weakened other rating agencies.
2. **Disputes resolved publicly.** Vendors may dispute any finding. Disputes are published verbatim in the subsequent issue alongside Nobulex's response. The dispute catalog itself becomes a structured precedent stream.
3. **Methodology back-tested before changes go live.** Any methodology change is back-tested over 12 prior weeks with the impact disclosed before taking effect. This prevents the failure mode where a low-scoring vendor lobbies for retroactive rehabilitation.
4. **Open methodology, private prompts.** The full statistical methodology is open. The 100-prompt set is held privately to prevent vendors from training on it. Statistical properties of the prompt set (task-class distribution, difficulty curves) are published.

## Cadence

Every Monday. The first issue (charter) is `issue-001-charter.md`.
