# Thiel Fellowship Application Drafts

## IMPORTANT — read before applying

Applying while in school is allowed. But IF SELECTED, you must leave school
to accept. This is not optional. Talk to your parents before applying — this
decision is bigger than the Danielle call.

Amount: $250,000 over two years. No equity taken. Rolling application, no
fixed deadline. Apply at thielfellowship.org/apply.

---

## Core: What are you working on?

Nobulex is an open-source cryptographic receipt layer for AI agents. Every
action an agent takes — calling a tool, moving money, reading a file — gets
an Ed25519-signed, JCS-canonical receipt, hash-chained to the previous one.
Change one byte and verification fails. An auditor, regulator, or customer
can verify what an agent actually did without trusting the operator.

The technical primitive is simple: action_ref = SHA-256(JCS({agent_id,
action_type, scope, timestamp_ms})). One 64-character hex string identifies
any agent action, independently and deterministically.

The product is live. pip install nobulex. Cross-validated against four
published test vectors — Python and JavaScript implementations produce
byte-identical action_refs. AgentAudit AI is the first integration partner
with a five-point partnership locked. vaara v0.50 by Henri Sirkkavaara ships
EU AI Act Article 12 audit trails citing the nobulex signed-receipt design.
OWASP CheatSheetSeries merged my JCS canonicalization rationale and
regulatory mapping (Sections 8-11, approved by Jim Manico).

---

## Contrarian question: What important truth do very few people agree with?

Most people building "AI safety" infrastructure are working on the wrong
layer. They're trying to constrain what AI agents can do. The real problem
is that nobody can prove what agents already did.

Right now, when an AI agent executes a task — moves money, writes code,
sends a message, reads a database — there's no neutral record of it
that exists outside the operator's own logs. An enterprise deploying agents
can tell you what their agents did, but only because you trust their logs.
An auditor, a regulator, a counterparty has to take the operator's word for
it. That's the same architecture we used for financial records before
double-entry bookkeeping, and before double-entry accounting we got fraud.

The industry is repeating this mistake at scale. Every "AI governance"
platform, every "responsible AI" framework, every "alignment" approach
assumes you already know what the agent did and you're deciding whether
that was okay. But you don't know what the agent did. You have a string
from a log file that the operator controls.

The accountability primitive that prevents this is simple, old, and
completely undeployed in the AI stack: a signed, hash-chained receipt for
every action, generated before execution and verifiable by anyone with
the public key. This is what Nobulex builds. The contrarian claim is that
AI accountability, not AI alignment, is the tractable problem — and that
it can be solved with a 50-year-old cryptographic primitive that nobody
building AI infrastructure today is using.

---

## Past achievements

I'm 15. I taught myself to code at [age]. Before Nobulex:
[Arian: add real prior projects here — even small ones count]

Nobulex milestones (all verifiable):
- Built and shipped a working cryptographic SDK from scratch, solo, as a
  15-year-old. pip install nobulex is live on PyPI with real benchmarks:
  ~13,683 signed receipts/sec at p50, ~73 microseconds end-to-end.
- Cross-validated against the published bilateral receipt test vectors.
  Python and TypeScript implementations produce byte-identical action_refs.
  Four implementations, four passes, fully public fixtures.
- Landed a five-point integration partnership with AgentAudit AI before
  having a single paying customer. The signed specimen receipt
  (fixtures/agentaudit-specimen-v1.json) verifies end-to-end in 10 lines
  of Python. Nobody asked me to deliver it three days early. I did it.
- Got four of my contributions (JCS canonicalization rationale, cross-agent
  accountability, sanctions-list freshness, regulatory mapping) merged into
  the OWASP CheatSheetSeries on AML compliance for AI agent payments,
  approved by Jim Manico, credited to me.
- vaara v0.50 independently shipped EU AI Act Article 12 audit trails citing
  the nobulex signed-receipt design. Third-party adoption, no coordination.
- Posted a 160-line RFC to builderz-labs/mission-control after the
  maintainer asked for a concrete identity and signed-attestation design.
  The answer was delivered the same day.

---

## Vision: What do you want to build in the next decade?

The agent economy is going to be large — trillions of dollars in
transactions, medical decisions, legal analysis, infrastructure management,
all executed by software that nobody directly supervises. The question of
how you know what those agents actually did, and whether you can prove it to
a third party, is not optional. It's the same question that spawned
double-entry accounting, that spawned audit requirements, that spawned the
SEC. Every time humans have handed consequential decisions to a system they
don't directly observe, they've eventually built accountability
infrastructure. We're at the beginning of that cycle for AI agents.

Nobulex's long-term goal is to be the neutral receipt layer — the thing
that makes agent behavior provable the way SWIFT makes transactions
provable. Not a product you pay for access to. A standard that runs under
everything else, the way TCP/IP runs under the internet. The business is
what you build on top: hosted verification services, compliance reporting
mapped to specific regulations, enterprise audit packages.

In five years I want Nobulex receipts to be the default format for agent
action evidence. In ten years I want regulators to be able to say "prove
what your agent did" and for every operator to have an answer that any
auditor can verify, without trusting the operator.

The path there is open-source first, standard second, business third. The
precedent is Linux, not SaaS. Adoption before monetization.

---

## Recommenders to consider

- Danielle Strachman (1517 Fund) — if the call goes well before applying
- Piotr / AgentAudit AI — integration partner, can speak to technical rigor
- Jim Manico (OWASP) — merged your contributions into CheatSheetSeries

---

## Notes before submitting

1. Talk to your parents. Accepting Thiel means leaving school. This is the
   conversation that needs to happen before you hit submit, same as the
   Danielle call.
2. You do not need to drop out to APPLY. You need to decide before
   ACCEPTING.
3. Thiel's "contrarian" question is their real filter. The answer above is
   the one that's most honestly yours — don't soften it.
4. Apply at: thielfellowship.org/apply
