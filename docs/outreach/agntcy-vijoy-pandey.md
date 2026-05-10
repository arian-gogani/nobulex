# Outreach: Vijoy Pandey, GM/SVP Outshift by Cisco (AGNTCY)

**Date drafted:** 2026-05-10
**Status:** Draft, not yet sent
**Target:** Vijoy Pandey — LinkedIn DM preferred; Cisco email via `vijpande@cisco.com`
**Objective:** Position Nobulex bilateral receipts as a complementary, neutral evidence-of-record layer that the AGNTCY ecosystem can adopt — not as competition with the identity/discovery work AGNTCY is already doing

---

## Why Vijoy / why AGNTCY

- Vijoy has been the clearest public voice on what neutral, multi-vendor agent infrastructure should look like. His framing — *"Building the foundational infrastructure for the Internet of Agents requires community ownership, not vendor control"* — is the exact framing under which Nobulex was built.
- AGNTCY now sits under the Linux Foundation with ≥75 supporting companies. The identity, discovery, and observability layers are being defined there. The *evidence-of-record* layer is not.
- Nobulex is not competing with AGNTCY's identity work. Bilateral receipts are post-action evidence; AGNTCY's W3C VC/DID work is pre-action identity. Same stack, different floor.
- I am submitting Nobulex as an AAIF project proposal (Linux Foundation). Vijoy's support — even informal — for AGNTCY-compatible composition of bilateral receipts would materially accelerate the proposal review.

## The ask

A 30-minute conversation about whether bilateral receipts (Ed25519 over JCS, hash-chained, post-action) should compose with AGNTCY identity/discovery as the canonical evidence layer for the Internet of Agents — and what shape that composition would take.

If yes: I propose a joint design document outlining the integration points. AGNTCY-issued DIDs become the principal/agent identity inside Nobulex receipts; Nobulex receipts become the standard evidence-of-record artifact emitted by AGNTCY-compatible agents.

If no: I would value 10 minutes of his time on why bilateral receipts as a separate, complementary layer is the wrong frame.

---

## DRAFT EMAIL — v1

**Subject:** Composition: AGNTCY identity + Nobulex bilateral receipts as evidence-of-record

Vijoy —

Your framing on neutral agent infrastructure has been the cleanest articulation of what the Internet of Agents needs: community ownership, not vendor control. I have been building toward that same shape from the evidence-of-record side, and I think there is a conversation worth having.

I maintain Nobulex, an MIT-licensed bilateral receipt format for AI agent transactions. Last week I published the first issue of the Agent Reliability Index, the public observatory layer of the methodology, at <https://nobulex.com/observatory.html>.

Nobulex sits at the post-action layer. AGNTCY's identity and discovery work sits at the pre-action layer. The two compose:

- AGNTCY-issued DIDs identify the principal and the agent.
- Nobulex receipts capture what those identified parties signed off on, post-execution.
- The two artifacts together produce the cryptographic non-repudiation record that AAIF, EU AI Act Article 12, and AI insurance carriers are converging toward.

I am submitting Nobulex as an AAIF project proposal. The proposal would be materially strengthened by demonstrating clean composition with AGNTCY — and I think the demonstration is straightforward because the two formats were independently designed around the same primitives (DIDs, Ed25519, hash chaining).

Two specific asks:

1. A 30-minute call to map the integration points (principal DID issuance → receipt envelope; counterparty DID resolution → receipt verification). I would write up the resulting design as a public draft.

2. If the integration is sound, your informal support for an AGNTCY-compatible Nobulex composition in the AAIF proposal review. Not endorsement — just the signal that the composition has been technically reviewed by someone in the AGNTCY camp.

I am free at any 30-minute window you suggest.

— Arian Gogani
Nobulex
<https://github.com/arian-gogani/nobulex>

---

## Notes on the draft

- This is a *standards* email, not a *sales* email. Different vocabulary. Different ask. Different success criterion.
- The phrase *"the two artifacts together produce the cryptographic non-repudiation record"* is the technical claim. Vijoy will evaluate it on technical merits, not on business framing.
- The two asks at the end are intentionally asymmetric — one cheap (the call), one slightly more committed (AAIF support). The cheap one carries the conversation; the AAIF one is a soft probe.
- Length: ~330 words. Longer than the buyer-pitch emails because the technical claim needs to be made.
- No mention of buyers, carriers, or the rating-agency thesis. Standards work has to read as standards-first. The commercial layer is irrelevant to Vijoy's evaluation.

## Adjacent contacts to consider after Vijoy

- **Jeff Doyle** (AGNTCY engineering lead at Cisco): more technical, lower in the org, faster reply
- **David Nalley** (Governing Board Chair, AAIF / Apache Software Foundation): governance not technical, but his sign-off on the AAIF proposal is what matters
- **Travis Kellerman** (also active in AGNTCY governance discussion threads on GitHub)

## Follow-up cadence

- Day 0: Send LinkedIn DM (or email if no LinkedIn reply in 5 days)
- Day 14: Follow-up if no response — share the draft AAIF proposal as an additional artifact
- Day 30: If still no response, surface the same proposal in the AGNTCY GitHub discussions; let it find Vijoy organically
