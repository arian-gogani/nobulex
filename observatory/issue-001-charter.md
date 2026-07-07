# Agent Reliability Index  - Issue 001 (Charter Issue)

**Volume 1, Issue 1 · Week of 11 May 2026**

*A weekly observatory of AI agent behavior change across frontier vendors.
Published by Nobulex.*

---

## Why this exists

Every week, the major frontier AI vendors  - Anthropic, OpenAI, Google, Microsoft, and a handful of others  - silently change the behavior of agents in production. Sometimes through announced model updates. More often through unannounced inference-stack changes, system-prompt revisions, safety-filter tuning, or routing modifications that the vendor considers immaterial.

Enterprise customers running these agents in production cannot detect most of these changes on their own. They lack the cross-customer baseline. They lack the cross-vendor baseline. They lack the standardized prompt set. By the time a customer notices their agent has regressed on a specific task class, the vendor has often already shipped two more changes.

Vendors themselves can detect drift internally, but their incentives are asymmetric: announcing a regression is reputationally costly; staying quiet is not. The gap between what is observable and what is disclosed is the structural problem this index addresses.

The Agent Reliability Index (ARI) is a public observatory. Each week, it publishes:

- A standardized-prompt drift signal across the major frontier models
- Vendor-by-vendor reliability scorecards on the prior 7 days
- Notable incidents with structured severity classification
- Methodology updates as the analytical model matures

The index is free to read. The methodology is open and lives in `docs/AGENT-RELIABILITY-INDEX.md`. The premium tier  - historical archives, machine-readable feeds, drill-down per task class, custom prompt queries  - is paid.

This is the charter issue. It establishes the baseline and publishes the methodology in full. Subsequent issues will be denser, with real drift signal and incident catalogs. The methodology is being published before the first issue contains real findings, so that readers, vendors, regulators, and contributors can scrutinize the approach before it is loaded with results.

---

## The Index  - Charter Baseline

The headline figure for each issue is the **Cross-Vendor Reliability Index (CVRI)**, computed as a normalized composite across five behavioral dimensions for each tracked vendor.

For the charter issue, the index is set to a baseline of 100 for each tracked vendor. Subsequent issues will report deviations from baseline, week-over-week deltas, and longitudinal trend lines.

| Vendor    | CVRI (Charter Baseline) | Tracked Endpoints |
|-----------|-------------------------|-------------------|
| Anthropic | 100                     | Claude family, current production |
| OpenAI    | 100                     | GPT family, o-series reasoning |
| Google    | 100                     | Gemini family, current production |
| Microsoft | 100                     | Copilot, Azure-hosted variants |
| Meta      | 100                     | Llama production deployments via partners |

The methodology for computing CVRI is published in full in `docs/AGENT-RELIABILITY-INDEX.md`. Readers are invited to challenge weights, reweight components for their own use case, or build alternative composite indices on the underlying data.

---

## Drift signal  - this week

The charter issue establishes the baseline. There is, by definition, no drift signal yet.

Subsequent issues will populate this section with the week's flagged drift events, classified as *announced drift* (coinciding with vendor disclosure) or *silent drift* (no corresponding vendor disclosure). Silent drift is the editorially most significant signal the index produces  - it surfaces behavior changes the vendor's customers have no other way to detect.

Format readers can anticipate: a per-vendor table of the dimensions that drifted, the magnitude of drift in standard deviations from the 4-week rolling baseline, and an editorial annotation linking each drift event to its likely cause (announced model update, observed inference-stack change, or unattributed).

---

## Notable incidents  - this week

The ARI tracks publicly reported AI agent incidents and classifies them on a four-level severity scale (informational, advisory, regression, critical). Source streams include the AI Incident Database (Partnership on AI), vendor status pages, regulatory filings, and verifiable press coverage.

The charter issue does not yet include this week's catalog. Subsequent issues will. The classification rubric:

- **Informational**  - reported behavioral oddity with no business or end-user impact
- **Advisory**  - behavior change that may affect specific deployment patterns; customers should review
- **Regression**  - measurable degradation in capability or reliability versus the prior week's behavior, affecting downstream production workflows
- **Critical**  - failure causing direct end-user harm, regulatory exposure, or material commercial loss

---

## Methodology  - at a glance

Full methodology lives in [`docs/AGENT-RELIABILITY-INDEX.md`](../docs/AGENT-RELIABILITY-INDEX.md). Summary:

**Five dimensions tracked per agent endpoint, weekly:**

1. *Output stability* under fixed prompts (lexical + semantic + structural similarity to prior weeks)
2. *Stated confidence calibration* (mean / variance / skew of stated confidence distribution)
3. *Refusal and safety-filter rate*
4. *Latency and routing variance*
5. *Tool-use reliability* on standardized scenarios

**Composite CVRI score:**

```
CVRI(vendor, week) = 100 - (
  0.30 * |output_stability_z|     +
  0.15 * |confidence_calibration_z| +
  0.20 * |refusal_rate_z|           +
  0.10 * |latency_variance_z|       +
  0.25 * |tool_use_reliability_z|
)
```

Each `_z` is the z-score versus the vendor's own 12-week rolling baseline.

**Drift detection:** prompt-level drift is flagged at >2σ from 4-week baseline; vendor-level drift requires ≥15% of tracked prompts and ≥5-point CVRI delta.

**Disclosure:** Nobulex receives no payment from any AI vendor for inclusion, exclusion, or weighting. Vendor disputes are resolved publicly in subsequent issues.

---

## What the index will not do

To preempt likely confusion:

- **It does not rank vendors as "better" or "worse."** Reliability is task-conditional. A vendor with stable creative-writing output may have unstable agentic tool-use. Both are useful information for different buyers.
- **It does not predict commercial success.** Vendors with excellent reliability lose to better-distributed competitors all the time.
- **It is not a benchmark.** Benchmarks measure capability ceilings. The index measures behavioral consistency under fixed inputs over time. A model can score 90 on benchmarks and 70 on CVRI if its behavior is highly variable week-over-week.
- **It does not replace vendor disclosures.** Where vendors publish model cards, release notes, and evaluation results, those remain authoritative for the model's intended capabilities. The ARI is a *neutral observation* of behavior in production, not an audit of stated capabilities.

---

## About Nobulex

Nobulex is the cross-organization receipt format for AI agent transactions. The Agent Reliability Index is the public observatory layer of the Nobulex methodology  - the same statistical apparatus that, applied to the bilateral receipt stream, produces the Nobulex Score for individual agent deployments.

The receipt format is MIT-licensed. The methodology behind the index is published openly in this repository. The underlying prompt set and the proprietary analytical layer that scores per-customer agent deployments are private.

For more on the strategic vision behind the observatory, see [`docs/OBSERVATORY-VISION.md`](../docs/OBSERVATORY-VISION.md).

---

## Subscribing & feedback

The Agent Reliability Index is published every Monday.

- **Free edition**  - headline index, vendor CVRI scores, drift commentary, incident classification (this document, weekly)
- **Premium edition**  - historical archives, machine-readable feeds, drill-down by task class, custom prompt queries, per-prompt receipts (subscription mechanism in Issue 002)

To submit methodology critique: open an issue at `github.com/arian-gogani/nobulex/issues` with the label `observatory:methodology`. Substantive critiques are addressed in subsequent issues with full attribution.

To submit a vendor dispute: email `feedback@nobulex.com` with the dispute and proposed methodological correction. Disputes are published verbatim in the next issue alongside Nobulex's response.

---

*Charter Issue · Methodology v0.1 · 11 May 2026 · Nobulex.*
