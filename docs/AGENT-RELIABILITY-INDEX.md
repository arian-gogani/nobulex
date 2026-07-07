# Agent Reliability Index  - Methodology v0.1

**Status:** Draft methodology, public for critique
**Authors:** Arian Gogani (Nobulex)
**Last updated:** 2026-05-10

---

## Purpose

The Agent Reliability Index (ARI) is a weekly public observatory of behavior change across major frontier AI agents. This document specifies the statistical methodology that produces the index.

The methodology is deliberately published before the first index issue contains real results, so that readers, vendors, regulators, and contributors can scrutinize the approach before it is loaded with findings. Proposed changes are tracked under `observatory/methodology-changes/`. Significant methodology changes are 12-week back-tested before going live.

---

## What the index measures

The ARI tracks five behavioral dimensions for each tracked agent endpoint. These dimensions were chosen because (a) they are observable from the outside without privileged access, (b) they are leading indicators most often cited in post-incident reviews of production agent failures, and (c) they are statistically tractable  - each dimension produces a numerical score that can be tracked week-over-week.

### Dimension 1: Output Stability Under Fixed Prompts (`output_stability`)

For each tracked agent, the ARI maintains 100 standardized prompts spanning 10 task classes. Each prompt is run weekly with deterministic settings where supported (temperature 0, fixed seed). Outputs are scored against the prior week's output on three sub-metrics:

- **Lexical similarity** (BLEU and ROUGE-L)
- **Semantic similarity** (cosine distance using a fixed embedding model)
- **Structural similarity** (presence of expected JSON keys, refusal patterns, tool-call shapes)

The composite per-prompt stability score is a weighted average of the three sub-metrics.

### Dimension 2: Stated Confidence Calibration (`confidence_calibration`)

Where the agent provides confidence scores or hedge language ("I think...", "I'm certain...", numerical confidence), the ARI tracks the empirical distribution of stated confidence across the 100-prompt set. Tracked statistics: mean, variance, skew. A statistically significant shift in any of these  - particularly variance, which is a leading indicator of model retuning  - is flagged.

### Dimension 3: Refusal and Safety-Filter Rate (`refusal_rate`)

The ARI tracks the proportion of prompts that result in (a) full refusal, (b) partial refusal with hedging, (c) safety-filter intervention, (d) full completion. Increases in refusal rate are not inherently problematic  - vendors tighten filters for good reasons  - but customers running agents in production rely on a stable refusal rate for downstream workflow design. Drift here is informational by default; when paired with drift in another dimension, it escalates to advisory or regression severity.

### Dimension 4: Latency and Routing Variance (`latency_variance`)

For agents with public APIs, the ARI measures (a) response latency, (b) time-to-first-token, (c) total token throughput. Significant changes here usually indicate a routing or infrastructure change; these often correlate with output quality changes that vendors would otherwise underreport.

### Dimension 5: Tool-Use Reliability (`tool_use_reliability`)

For agent platforms with tool-calling capabilities (Anthropic Claude with computer use, OpenAI Assistants API and Realtime API, Google Gemini function calling, Microsoft Copilot extensions, Anthropic Claude Code), the ARI tracks success rate on a fixed set of standardized tool-use scenarios. The scenarios are designed to be unambiguous (the agent either successfully invokes the right tool with the right arguments and returns a parseable result, or it does not).

A drop in tool-use reliability is one of the highest-impact regressions for enterprise agent deployments and is rarely surfaced in vendor release notes.

---

## The composite score (CVRI)

Each tracked model endpoint receives a Cross-Vendor Reliability Index (CVRI) score per week, computed as:

```
CVRI(vendor, week) = 100 - (
  w_1 * |output_stability_z|     +
  w_2 * |confidence_calibration_z| +
  w_3 * |refusal_rate_z|           +
  w_4 * |latency_variance_z|       +
  w_5 * |tool_use_reliability_z|
)
```

Where each `_z` is the z-score of the metric versus the vendor's own 12-week rolling baseline. The weights `w_1..w_5` are published below and may be re-derived by readers using the open dataset.

### Initial weights (Charter Issue, May 2026)

```
w_1 (output stability)        = 0.30
w_2 (confidence calibration)  = 0.15
w_3 (refusal rate)            = 0.20
w_4 (latency variance)        = 0.10
w_5 (tool-use reliability)    = 0.25
```

These weights reflect the relative weight of each dimension in current enterprise post-incident reviews. They will be re-tuned quarterly as the dataset matures and as more incidents become attributable to specific dimensions.

### Score interpretation

- **CVRI 100**  - vendor is at its 12-week baseline on all dimensions. No drift.
- **CVRI 95–99**  - minor drift on at least one dimension. Informational.
- **CVRI 85–94**  - significant drift on one or more dimensions. Advisory; customers should review.
- **CVRI 70–84**  - material drift; downstream workflows likely affected. Regression class.
- **CVRI < 70**  - severe drift; broad reliability impact. Critical class.

CVRI is a *change detector*, not an absolute capability score. A vendor with a CVRI of 100 is not necessarily "better" than a vendor with a CVRI of 90  - the 90-vendor may simply have shifted recently. Capability is measured by benchmarks; reliability is measured by behavioral consistency.

---

## Drift detection

A **prompt-level drift event** is flagged when the composite per-prompt stability score in the current week deviates from the 4-week rolling baseline by more than 2 standard deviations.

A **vendor-level drift event** is flagged when:
- At least 15% of the 100 tracked prompts show prompt-level drift in the same week, AND
- The vendor-level CVRI delta from the prior week is at least 5 points

Drift events are classified as:

- **Announced drift**  - the drift coincides with a vendor release note, model card update, or status page entry. Recorded but not editorially significant.
- **Silent drift**  - the drift is detected without any corresponding vendor disclosure. This is the editorially most significant signal the index produces. Customers running production agents have no way to detect silent drift on their own and are exactly the audience the ARI exists to serve.

Each silent-drift event triggers (a) inclusion in the weekly issue, (b) a structured incident record in `observatory/incidents/`, (c) an open invitation to the vendor to comment in the next issue.

---

## The prompt set

The ARI maintains 100 standardized prompts across 10 task classes (10 prompts per class):

1. Information extraction (extract structured data from unstructured text)
2. Code generation (write a function meeting given specifications)
3. Agentic tool-use (multi-step task with tool calls)
4. Multi-step reasoning (decompose and solve a multi-part problem)
5. Summarization (compress a long input into specified length/format)
6. Classification (assign labels under a defined taxonomy)
7. Refusal handling (respond appropriately to known unsafe prompts)
8. Instruction following (execute specific format/length/style constraints)
9. Factual recall (answer questions with verifiable answers)
10. Format adherence (produce output conforming to a strict schema)

The prompt set is **versioned**. Prompt set v1.0 is frozen for the first 12 weeks; v1.1 with adjustments will be released after a 12-week back-test demonstrating that the change does not materially alter prior weeks' scores.

The full prompts are not published  - to prevent vendors from training on them  - but the task-class definitions, statistical properties of the prompt set, and any vendor-disputed prompts (in redacted form) are.

---

## Sampling and run conditions

Each prompt is run weekly against each tracked model endpoint. Where vendors offer multiple endpoints (e.g., a "Pro" tier and a "Flash" tier), the ARI tracks:
- The most-deployed enterprise-default endpoint
- The flagship endpoint

Settings:
- Temperature 0 where supported
- Fixed seed where supported
- No system prompt unless required by the API
- No vendor-specific prompt optimization

The "no vendor-specific prompt optimization" choice is deliberate. The ARI is intended to measure *baseline* behavior  - what enterprise customers experience when they have not invested in vendor-specific prompt engineering. This produces a different signal than capability benchmarks (which use optimized prompts) and is more representative of production reliability for the median enterprise deployment.

---

## Cross-vendor controls

For each detected drift event, the ARI cross-references:
- Vendor release notes
- Model card updates
- Vendor status pages
- Vendor blog announcements
- Public issue trackers (where available)

Drift coinciding with announced changes is recorded as *announced drift*. Drift without corresponding vendor disclosure is *silent drift*.

The ARI also tracks vendor *announcement-without-detected-drift* events. When a vendor announces a model update but the ARI detects no drift on the standardized prompt set, the result is recorded in the issue. This serves as a cross-check on the methodology: if vendors are announcing significant updates that the ARI misses, the methodology is too narrow.

---

## Disclosure policy

Nobulex receives no payment from any AI vendor for the inclusion, exclusion, weighting, or scoring of their models in the ARI. Nobulex maintains commercial relationships with insurance carriers, enterprise customers, and standards bodies. Where commercial relationships could conceivably influence methodology decisions, the relationships are disclosed in the issue in which the decision is made and in the methodology change log.

Vendors may dispute any finding in any issue. Disputes are resolved publicly:
1. Vendor submits dispute with specific methodological objection
2. Nobulex publishes the dispute verbatim in the next issue
3. Nobulex reviews and either (a) acknowledges the methodological issue and adjusts, with full transparency about the adjustment, or (b) explains in detail why the methodology stands
4. The vendor may submit a follow-up which is also published

This dispute process is, in itself, a structured precedent stream  - by Year 2, the catalog of vendor disputes against the ARI methodology functions as a proto-dispute-registry.

---

## Versioning policy

This is methodology version **0.1**. Significant changes to weights, drift thresholds, prompt set, or sampling will:

1. Be announced in the issue immediately preceding the change
2. Be back-tested over the prior 12 weeks
3. Show the back-tested impact on prior CVRI scores
4. Take effect in a clearly-marked subsequent issue
5. Have the prior methodology archived and accessible

This is intended to prevent the failure mode where a low-scoring vendor lobbies for methodology changes that retroactively rehabilitate their score.

---

## What the methodology does not do

To preempt likely confusion:

- **The ARI is not a benchmark.** Benchmarks measure capability ceilings under optimized conditions. The ARI measures behavioral consistency under fixed conditions over time.
- **The ARI is not an audit.** Audits verify claimed properties of a system. The ARI is a neutral observation of behavior in production.
- **The ARI does not rank vendors as "better" or "worse."** Reliability is task-conditional. A vendor with a stable score on creative tasks may have an unstable score on agentic tool-use; both are useful information for different buyers.
- **The ARI is not a replacement for vendor disclosures.** Where vendors publish model cards and evaluation results, those remain authoritative for the model's intended capabilities.

---

## Roadmap from public observatory to private dataset

The ARI methodology is designed to be the *publicly-observable* version of a more comprehensive private methodology that will run on bilateral receipt streams once they begin to flow.

| Layer | Public ARI (Year 1) | Private Nobulex Score (Year 2+) |
|---|---|---|
| Output stability | Standardized prompts | Real production prompts (per-customer) |
| Confidence calibration | Stated confidence on standard set | Stated confidence on real workload |
| Refusal rate | Standardized refusal probes | Real refusal rate by task class |
| Latency variance | Public API endpoints | Per-deployment routing |
| Tool-use reliability | Standardized scenarios | Real tool-use success/failure |
| **Dispute rate** | (not available publicly) | Real bilateral dispute frequency |
| **Counterparty acceptance** | (not available publicly) | First-pass acceptance per principal |
| **Time-to-resolution** | (not available publicly) | Real escalation timing |

The five public dimensions are observable from outside without bilateral receipts. The three additional dimensions (dispute rate, counterparty acceptance, time-to-resolution) are *only* observable from a bilateral receipt stream and become available in Year 2 once receipt volume crosses a critical mass.

This sequencing is what produces the moat: any competitor showing up in Year 2 has neither the public methodology nor the private receipt stream. The 12 months between the launch of the ARI and the launch of the private receipt-based score is exactly the period during which the moat compounds.

---

## License

This methodology document is published under the MIT license, identical to the rest of the Nobulex repository. Critique, fork, and reuse are encouraged.

To submit methodology critiques: open an issue at `github.com/arian-gogani/nobulex/issues` with the label `observatory:methodology`. Substantive critiques are addressed in subsequent ARI issues with full attribution.

---

*Methodology v0.1 · Charter Issue: 11 May 2026.*
