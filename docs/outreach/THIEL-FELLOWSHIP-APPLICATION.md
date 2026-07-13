# Thiel Fellowship Application Drafts

## IMPORTANT  - read before applying

Applying while in school is allowed. But IF SELECTED, you must leave school
to accept. This is not optional. Talk to your parents before applying  - this
decision is bigger than the Danielle call.

Amount: $250,000 over two years. No equity taken. Rolling application, no
fixed deadline. Apply at thielfellowship.org/apply.

---

## Core: What are you working on?

Credit scores for machines. Nobulex is an open-source receipt layer for AI
agents. Every action an agent takes gets an Ed25519-signed, JCS-canonical
receipt, hash-chained to the previous one. Change one byte and verification
fails. The verified track record becomes a trust score that determines what
the agent is allowed to do. Autonomy earned, not granted.

The technical primitive: action_ref = SHA-256(JCS({agent_id, action_type,
scope, timestamp_ms})). One 64-character hex string identifies any agent
action, independently and deterministically.

The SDK is free and open source (MIT). The paid product is the hosted
verification API: managed keys, compliance reports, the audit infrastructure
enterprises can't self-host. Credit-bureau economics: everyone has to check
the score, we hold the record.

The action_ref formula is normative implementation guidance in OWASP
Agentic Skills Top 10 AST09 (3 PRs merged by project lead Ken Huang).
Cited as third independent issuer in the x402 payment conformance spec
(14/14 verdicts). IETF conformance: 4/4 vectors pass. Six framework
integrations shipped. ~13,700 signed receipts/sec (Ed25519).

---

## Contrarian question: What important truth do very few people agree with?

Most people building "AI safety" infrastructure are working on the wrong
layer. They're trying to constrain what AI agents can do. The real problem
is that nobody can prove what agents already did.

Right now, when an AI agent executes a task  - moves money, writes code,
sends a message, reads a database  - there's no neutral record of it
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
AI accountability, not AI alignment, is the tractable problem  - and that
it can be solved with a 50-year-old cryptographic primitive that nobody
building AI infrastructure today is using.

---

## Past achievements

I'm 16. I taught myself to code at [age]. Before Nobulex:
[Arian: add real prior projects here, art, Translucence, etc.]

Nobulex milestones (all verifiable):
- Built and shipped a working cryptographic SDK from scratch, solo, at 16.
  pip install nobulex is live on PyPI with real benchmarks:
  ~13,683 signed receipts/sec at p50, ~73 microseconds end-to-end.
- Got the action_ref formula merged as normative implementation guidance in
  OWASP Agentic Skills Top 10 AST09, reviewed and merged by project lead
  Ken Huang. Three PRs merged total (#35, #38, #46).
- Got four sections merged into the OWASP CheatSheetSeries on AML compliance
  for AI agent payments, approved by Jim Manico, credited to me.
- Cited as third independent issuer in the x402 payment conformance spec
  (14/14 verdicts passed, alongside agent-guard and Vaara).
- Filed IETF conformance implementation (draft-farley-acta-signed-receipts,
  4/4 vectors pass). If merged: OWASP + x402 + IETF triple standards.
- Built a hosted verification API with 6 endpoints, 3 pricing tiers, rate
  limiting, and compliance report generation. Credit-bureau economics:
  the SDK is free, the verification layer is the product.
- Shipped working integration examples for 6 frameworks: LangChain, CrewAI,
  PydanticAI, Google ADK, Haystack, LlamaIndex. All tested end-to-end.
- Landed a design partnership with AgentAudit AI. The signed specimen receipt
  verifies end-to-end in 10 lines of Python.
- vaara v0.50 independently shipped EU AI Act Article 12 audit trails citing
  the nobulex signed-receipt design. Third-party adoption, no coordination.
- agentculture independently implemented a Culture-native provenance system
  modeled on my work, explicitly keeping the pattern but not the dependency.
  That's the strongest standards-adoption signal.
- 1517 Fund partner Danielle Strachman said I have "qualities we very much
  look for." Added to the 1517 community. Applying to 1517 camp.
- 2911 tests across TypeScript and Python, all green. Zero em dashes in
  the entire codebase (that's a style rule, not a joke).

---

## Vision: What do you want to build in the next decade?

The agent economy is going to be large  - trillions of dollars in
transactions, medical decisions, legal analysis, infrastructure management,
all executed by software that nobody directly supervises. The question of
how you know what those agents actually did, and whether you can prove it to
a third party, is not optional. It's the same question that spawned
double-entry accounting, that spawned audit requirements, that spawned the
SEC. Every time humans have handed consequential decisions to a system they
don't directly observe, they've eventually built accountability
infrastructure. We're at the beginning of that cycle for AI agents.

Nobulex's long-term goal is to be the neutral receipt layer  - the thing
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

- Danielle Strachman (1517 Fund)  - if the call goes well before applying
- Piotr / AgentAudit AI  - integration partner, can speak to technical rigor
- Jim Manico (OWASP)  - merged your contributions into CheatSheetSeries

---

## Notes before submitting

1. Talk to your parents. Accepting Thiel means leaving school. This is the
   conversation that needs to happen before you hit submit, same as the
   Danielle call.
2. You do not need to drop out to APPLY. You need to decide before
   ACCEPTING.
3. Thiel's "contrarian" question is their real filter. The answer above is
   the one that's most honestly yours  - don't soften it.
4. Apply at: thielfellowship.org/apply
