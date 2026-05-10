# Agent Reliability Index — Issue NNN

**Volume V, Issue NNN · Week of DD MONTH YYYY**

*A weekly observatory of AI agent behavior change across frontier vendors.
Published by Nobulex.*

---

## This week's headline

*One-paragraph editorial summary of the most significant finding this week. Lead with silent drift if any was detected. If no significant drift, lead with the most interesting cross-vendor pattern. If a week is genuinely uneventful, say so explicitly — "no silent drift detected; CVRI flat across all tracked vendors" is a valid headline.*

---

## CVRI scorecards — this week

| Vendor    | CVRI    | Δ vs. last week | Drift events | Status |
|-----------|---------|-----------------|--------------|--------|
| Anthropic | XX.X    | +/− X.X         | N            | OK / Advisory / Regression / Critical |
| OpenAI    | XX.X    | +/− X.X         | N            | OK / Advisory / Regression / Critical |
| Google    | XX.X    | +/− X.X         | N            | OK / Advisory / Regression / Critical |
| Microsoft | XX.X    | +/− X.X         | N            | OK / Advisory / Regression / Critical |
| Meta      | XX.X    | +/− X.X         | N            | OK / Advisory / Regression / Critical |

*Note: CVRI is a change detector versus each vendor's 12-week rolling baseline, not an absolute capability score. Lower CVRI means more drift, not "worse model."*

---

## Drift events — this week

### Silent drift

*For each silent drift event detected this week, document under its own subheading. If none detected, write: "No silent drift events detected this week."*

#### [Vendor] [Endpoint] — [task class affected]

- **Detected**: DD MONTH YYYY
- **Dimension(s) affected**: output_stability / confidence_calibration / refusal_rate / latency_variance / tool_use_reliability
- **Magnitude**: X.X standard deviations from 4-week baseline
- **Editorial annotation**: 1-3 sentences interpreting the likely cause. Cross-reference any partial vendor disclosures, infrastructure changes, or community reports.
- **Vendor disclosure**: None located as of publication / Partial disclosure on [date] in [source] / Vendor was contacted on [date] and declined to comment.

### Announced drift

*For each drift event that coincides with vendor disclosure. If none, write: "No announced drift events this week."*

#### [Vendor] — [model update announced]

- **Vendor announcement**: link to release notes / model card / status page
- **Detected CVRI delta**: X.X
- **Editorial annotation**: brief note on whether observed drift is consistent with announced changes, larger than expected, smaller than expected.

---

## Notable incidents — this week

*Cross-referenced against the AI Incident Database, vendor status pages, regulatory filings, and verifiable press coverage. Each incident is classified per the methodology rubric.*

### Critical

*If none, write: "No critical incidents this week."*

#### [Brief incident title]

- **Vendor / product**: [Vendor] / [Product]
- **Source**: link to authoritative public report
- **Summary**: 2-3 sentences
- **Implications**: 1-2 sentences on what enterprise deployers should review

### Regression

*If none, write: "No regression-class incidents this week."*

### Advisory

*If none, write: "No advisory-class incidents this week."*

### Informational

*If none, write: "No informational incidents this week."*

---

## Methodology notes

*Any methodology changes pending or in 12-week back-test. If none, write: "Methodology unchanged this week."*

*Any vendor disputes received this week and their resolution. If none, write: "No vendor disputes received this week."*

*Any disclosure-policy items (new commercial relationships that warrant disclosure). If none, write: "No new disclosure items this week."*

---

## Looking ahead

*Optional 2-3 sentence editorial: what to watch for next week. Vendor announcements expected? Model releases anticipated? Industry events that may produce signal?*

---

## About Nobulex

Nobulex is the cross-organization receipt format for AI agent transactions. The Agent Reliability Index is the public observatory layer of the Nobulex methodology. The receipt format is MIT-licensed; the methodology behind the index is open; the underlying prompt set and the proprietary analytical layer that scores per-customer agent deployments are private.

For the strategic vision: [`docs/OBSERVATORY-VISION.md`](../docs/OBSERVATORY-VISION.md).
For the full methodology: [`docs/AGENT-RELIABILITY-INDEX.md`](../docs/AGENT-RELIABILITY-INDEX.md).

To subscribe: email `nobulex.dev@gmail.com` with subject "Agent Reliability Index Subscription."
To submit methodology critique: open an issue at `github.com/arian-gogani/nobulex/issues` with label `observatory:methodology`.
To submit a vendor dispute: email `feedback@nobulex.com` with the dispute and proposed methodological correction.

---

*Issue NNN · Methodology vX.Y · DD MONTH YYYY · Nobulex.*
