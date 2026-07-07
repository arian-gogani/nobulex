# Outreach: Michael von Gablenz, Head of Insure AI, Munich Re / HSB

**Date drafted:** 2026-05-10
**Status:** Draft, not yet sent
**Target:** Michael von Gablenz  - `mgablenz@munichre.com`
**CC:** Dr. Peter Bärnreuther (Senior Underwriter for AI Risks)  - `pbaernreuther@munichre.com`
**Objective:** 25-minute call as the *underwriter signal test* (one of the three falsifiable tests from `docs/OBSERVATORY-VISION.md`)

---

## Why Michael / why now

This email is not really a pitch. It is a *test*  - specifically the third falsifiable test from the Nobulex strategic vision document:

> **Underwriter signal test.** 25-minute conversation with an AI insurance underwriter:
> *"Given two AI vendors with identical ISO/IEC 42001 documentation, but one issues bilateral receipts and one does not  - would your premium pricing differ? By how much?"*

If Michael's answer is "yes, by more than 5%," the rating-agency thesis is real. If "no," the thesis collapses to compliance-evidence framing.

Munich Re's aiSure has been underwriting AI performance risks since 2018  - longer than any other carrier. Michael's team has set the technical-due-diligence standard for the category (Mosaic x aiSure partnership ran up to €15M per insured AI vendor). If anyone has the empirical evidence to answer the question, it is him.

## The ask

A 25-minute call. The substance of the question matters more than the meeting; if his answer comes back in a single sentence by email, that is sufficient.

---

## DRAFT EMAIL  - v1

**Subject:** A 25-minute conversation testing one underwriting hypothesis

Michael  -

I am the maintainer of Nobulex, an MIT-licensed bilateral receipt format for AI agent transactions. Last week I published the first issue of the Agent Reliability Index, a weekly public observatory of AI agent behavior change across frontier vendors. The methodology and the charter issue are at <https://nobulex.com/observatory.html>.

I am writing because there is a specific question I would value 25 minutes of your time on. The question is hypothetical and the answer determines whether the entire trajectory of Nobulex is correct or wrong:

> Given two AI vendors with identical ISO/IEC 42001 documentation, but one issues bilateral cryptographic receipts (per-transaction Ed25519 signatures, deterministic reasoning trace, hash-chained) and one does not  - would aiSure's premium pricing differ between them? By how much, directionally?

The reason this question matters: the public hypothesis behind Nobulex is that bilateral per-transaction evidence is actuarially additive to model-level governance evidence. If aiSure already prices that signal  - or would, if it were available  - the bilateral receipt thesis is empirically grounded. If aiSure would not price it, the technical work is interesting but the business thesis is wrong, and I should know that before spending another year on it.

I am not asking for a commitment, a pilot, or even a written response. A short conversation, or one sentence by email, would resolve a question I cannot resolve without contact with an underwriter who has seven years of AI-risk pricing experience.

If a 25-minute window in the next three weeks is feasible, I am free at any time you suggest.

 - Arian Gogani
Nobulex
<https://github.com/arian-gogani/nobulex>

---

## Notes on the draft

- This email is *deliberately* framed as a question, not a pitch. Underwriters get pitches every day. They rarely get a single sharp question.
- The phrase *"the answer determines whether the entire trajectory of Nobulex is correct or wrong"* is risky but honest. It signals that Michael's answer will be acted on. Most cold-emailers will not say this.
- I do not name a discount target (no "15-20%") because that biases the answer. The point is to extract Michael's *prior*, not to lead him toward a number I want.
- The escape valve  - *"or one sentence by email"*  - is what makes this asym­metric in his favor. A senior underwriter who reads 200 emails a week will reply with one sentence more often than schedule a call. One sentence is enough.
- No mention of age, of YC, of competitors. Single question, single artifact link, single ask.

## What a positive signal looks like

Any one of these is sufficient evidence that the thesis is real:

- "Yes, materially  - probably 10–20% premium impact for high-frequency agent deployments."
- "Yes, but the impact would be on retention rates and policy terms more than on first-year premium."
- "Yes, if we could verify the receipts against a third-party registry  - that's the missing piece."
- "Interesting; let's talk. We've been thinking about this internally."

## What a negative signal looks like

These would cause a thesis revision:

- "No, our pricing model is model-level. Per-transaction evidence isn't actuarially additive at our scale."
- "We already get this from CloudTrail / customer telemetry. Bilateral receipts add nothing."
- "The bottleneck isn't evidence  - it's adverse selection. No evidence format changes that."
- No reply within 21 days.

## Follow-up cadence

- Day 0: Send email
- Day 10: One follow-up if no response: "I appreciate this is unusual; happy to take one sentence by reply instead of a call"
- Day 21: If no response, log as null result and move on
