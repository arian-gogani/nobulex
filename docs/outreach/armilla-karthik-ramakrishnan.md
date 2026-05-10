# Outreach: Karthik Ramakrishnan, CEO Armilla AI

**Date drafted:** 2026-05-10
**Status:** Draft, not yet sent
**Target:** Karthik Ramakrishnan — `insurance@armilla.ai`, or LinkedIn DM
**CC:** Baiju Devani (CTO/co-founder), Piers Tuggey (Chaucer, Head of Cyber)
**Objective:** 25-minute call to explore Lloyd's / Armilla as design partner for AI E&O premium discount tied to bilateral receipt issuance

---

## Why Karthik / why Armilla / why now

- Armilla is the only Lloyd's-anointed MGA shipping affirmative AI E&O at $25M aggregate limits ([Vanguard AI, Feb 2026 launch](https://www.armilla.ai/resources/chaucer-and-armilla-launch-vanguard-ai-to-clarify-cyber-technology-and-ai-liability-in-a-single-coordinated-structure)).
- Karthik's own framing maps directly to bilateral receipts: *"clarity at the moment it matters when a claim actually occurs… avoid post-loss debates about whether an AI failure belongs in cyber, tech E&O, or nowhere at all."* That is the exact gap bilateral receipts close.
- The current Armilla underwriting evidence stack is model-level (ISO/IEC 42001 docs, third-party assurance). Bilateral receipts are per-transaction evidence — a different and complementary layer that lets pricing become actuarially sharper than competitors.
- Armilla is small enough to act fast and large enough to set a market precedent. First carrier to require Nobulex receipts as evidence-of-record creates a forcing function that scales adoption industry-wide.

## The ask

A 25-minute conversation. Specifically: if Armilla offered a 15–20% premium discount to insureds who issue Nobulex bilateral receipts during the policy period, what would the underwriting model look like for that discount, and what data would Armilla need to see in the first 90 days to formalize it?

I am not asking for a binding pilot in this conversation. I am asking whether the structural argument lands.

---

## DRAFT EMAIL — v1 (cold, no warm introduction)

**Subject:** Bilateral receipts as evidence-of-record for Vanguard AI

Karthik —

I noticed your framing on the Vanguard AI launch — that the structure exists to give policyholders "clarity at the moment it matters when a claim actually occurs." That is the exact problem I have been working on.

I am the maintainer of Nobulex, an MIT-licensed bilateral receipt format for AI agent transactions. The receipts are post-action evidence: two cryptographic signatures (principal and agent) over the full action record, hash-chained, with deterministic reasoning trace. They produce a per-transaction record that holds up in dispute — closer in shape to a UCC filing than to a model card.

Last week I published the first issue of the Agent Reliability Index, a weekly public observatory of AI agent behavior change across frontier vendors. The methodology is open. The first issue and the strategic vision are at <https://nobulex.com/observatory.html>.

The reason I am writing: I think there is a 25-minute conversation worth having about whether bilateral receipts could be a pricing input for Vanguard AI. Specifically: if Armilla offered a 15–20% premium discount to insureds who issue Nobulex receipts during the policy period, what would the underwriting model look like, and what would Armilla need to see in the first 90 days to formalize it?

I am not asking for a binding pilot here. I am asking whether the structural argument lands. If it does, I would propose Armilla as design partner on the spec for what carrier-required bilateral receipts should contain.

If this is interesting, I am free any 25-minute window in the next two weeks.

— Arian Gogani
Nobulex
<https://github.com/arian-gogani/nobulex>

---

## Notes on the draft

- Length: ~270 words. At the edge of what I think Karthik will read end-to-end.
- The Karthik quote is verbatim from the National Law Review press release. Cite back to it briefly; it shows I read the source rather than the headline.
- The discount range (15–20%) is anchored on cyber-insurance MFA discount precedent. Don't promise specifics; this is a conversation opener.
- The "I am not asking for a binding pilot" sentence is critical. It de-risks the reply.
- Closing ask is concrete: 25 minutes, two-week window. No vague "would love to chat."
- No founder age disclosed. If it comes up in the call, it comes up. Email is about the artifact, not the founder.

## Likely objections and responses

1. **"You're a 15-year-old solo founder; this is not buildable."**
   *Response:* "The substrate is MIT-licensed and already merged into Microsoft Agent Governance Toolkit (PRs 1302/1333). The reference implementation is published. The carrier-of-record relationship is what we are building. We're not asking Armilla to validate the technology; we are asking Armilla to be the carrier that shapes what bilateral receipts should contain for actuarial use."

2. **"Why would our insureds adopt this?"**
   *Response:* "Same shape as how cyber insurance forced MFA adoption in 2021–2023: the carrier-side discount becomes the customer-side requirement, which becomes the vendor-side feature. If Armilla offers 15% off for receipt issuance, customers run the math on their premium and adopt within the quarter."

3. **"We already use ISO/IEC 42001 evidence."**
   *Response:* "Right — and ISO 42001 is model-level governance, not per-transaction record. The two compose: 42001 says you have processes; bilateral receipts say what those processes actually produced on each specific consequential action. The disputes you're trying to avoid are per-transaction, not per-process."

4. **"What's the cost?"**
   *Response:* "The protocol substrate is free and open. Once a critical mass of receipts is flowing, Armilla pays for per-receipt verification at scale plus access to the rating engine (Nobulex Score), priced on a per-query basis comparable to credit bureau pull fees. The design-partner relationship is no charge during the first 12 months."

## Follow-up cadence

- Day 0: Send email
- Day 7: One short follow-up if no response — "still useful?" + same observatory link
- Day 14: If no response, move on. Do not chase further; the artifact is in the public record.
