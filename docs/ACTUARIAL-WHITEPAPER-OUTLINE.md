# Actuarial Whitepaper Outline

**Title:** Quantifying AI Agent Risk: A Framework for Underwriting Autonomous Systems

**Purpose:** Build the actuarial case for Nobulex verification. Share with cyber insurance actuaries. Let insurers price Nobulex verification into premiums themselves.

---

## Target Audience

- Cyber insurance actuaries at **Coalition**, **At-Bay**, **Corvus**, **Resilience**
- They already write AI-related riders
- They need a risk framework; nobody's given them one

---

## Outline

### 1. Executive Summary

- AI agents are a new risk class
- Behavioral covenants + compliance proofs = verifiable risk reduction
- Nobulex provides the data structure; insurers provide the pricing

### 2. The Accountability Gap

- Agents execute consequential actions without protocol-level accountability
- Operator logs, platform dashboards — not independently verifiable
- Liability uncertainty for insurers

### 3. Nobulex as Risk Infrastructure

- **Identity binding** — Who is responsible
- **Covenant declaration** — What the agent committed to
- **Compliance proof** — Cryptographic verification of behavior

### 4. Risk Factors (Quantifiable)

| Factor | Data Source | Weight |
|--------|-------------|--------|
| Covenant coverage | Nobulex audit | % of actions governed |
| Hard enforcement | CapabilityGate presence | Binary / tier |
| Attestation coverage | External attestations | % of interactions |
| Breach history | Breach attestations | Count, severity |
| Stake ratio | Reputation stake | Economic backing |

### 5. Proposed Risk Model

- **Base rate** — Unverified agents
- **Nobulex discount** — Verified agents: X% lower incident rate (simulated → validated)
- **Tiered pricing** — Solo / Bilateral / Network verification

### 6. Data Requirements

- What Nobulex can provide: covenant hashes, compliance proofs, breach attestations
- What insurers need: loss events, claim correlation
- Privacy: anonymized aggregates, no PII

### 7. Implementation Path

- Insurer doesn't need to "partner with Nobulex"
- Insurer adopts standard because actuarial data shows lower risk
- Nobulex publishes framework; insurers price it themselves

### 8. Next Steps

- Publish whitepaper (arXiv, insurer outreach)
- Share with 4 target insurers
- Iterate based on actuarial feedback

---

## Relation to Adoption

- **Improvement 53:** Actuarial Risk Model
- **ADOPTION-STRATEGY.md:** Insurance Discount: The Actuarial Play
- **ADOPTION-READINESS.md:** Gap 2, Week 8 — Actuarial whitepaper
- **@nobulex/derivatives:** Risk assessment, premium calculation
