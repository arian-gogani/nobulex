---
title: EU AI Act Article 12 requires tamper-evident logs in 107 days. here's how to build them.
published: false
description: The EU AI Act high-risk deadline hits December 2, 2027. Article 12 requires automatic event logging that can't be silently altered. Here's what that actually means technically and how to implement it.
tags: ai, security, compliance, opensource
---

the EU AI Act high-risk provisions take effect December 2, 2027. if you're deploying AI agents in regulated environments, Article 12 is the one that matters most.

it requires "automatic recording of events" for high-risk AI systems. sounds simple. it's not.

## the problem with normal logs

your agent calls a tool, makes a decision, accesses data. you log it to a database or a file. standard practice.

but here's the question a regulator will ask: **how do you prove those logs weren't modified after the fact?**

application logs live on infrastructure someone controls. they can be edited, deleted, or replaced without anyone noticing. Article 12 doesn't explicitly say "tamper-proof" — but if your logs can be silently altered and you can't prove otherwise, their evidentiary value is zero.

a log whose integrity can be challenged is not evidence. it's a liability.

## what tamper-evident actually means

tamper-evident ≠ tamper-proof. you can't prevent someone from modifying a log. but you can make any modification **detectable**.

the mechanism: hash chaining.

each log entry includes a SHA-256 hash computed from its content plus the previous entry's hash. change one entry and every hash after it becomes invalid. a third party can take your log, recompute every hash from the first entry, and mathematically verify nothing was tampered with.

same principle behind blockchains, without the overhead.

```
entry 1: { action: "read", hash: "a3f2..." }
entry 2: { action: "transfer", prev_hash: "a3f2...", hash: "b7e1..." }
entry 3: { action: "read", prev_hash: "b7e1...", hash: "c9d4..." }
```

modify entry 2? the hash changes. entry 3's `prev_hash` no longer matches. the chain is broken. detectable instantly.

## what you need for Article 12

based on the regulation and how enforcement is shaping up, here's the minimum:

1. **every agent action logged automatically** — not just errors. every tool call, every decision, every data access.

2. **hash-chained entries** — each entry cryptographically linked to the previous one. SHA-256 minimum.

3. **signed by the agent's identity** — Ed25519 signatures bind each entry to a verifiable agent identity (W3C DIDs work well here).

4. **independently verifiable** — a third party (auditor, regulator, counterparty) can verify the entire chain without access to your infrastructure.

5. **retained for 6 months minimum** — Articles 19 and 26 set the floor. financial services may need longer.

## implementation

i built an open-source tool that does this. three lines to add to any agent:

```typescript
import { createDID, parseSource, EnforcementMiddleware } from '@nobulex/core';

const agent = await createDID();
const spec = parseSource('covenant MyAgent { permit read; forbid write; }');
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });
```

every action that passes through the middleware gets:
- evaluated against behavioral rules before execution
- logged in a SHA-256 hash chain
- signed with the agent's Ed25519 key

forbidden actions are blocked before they execute. allowed actions are recorded with full context.

verification is one function call:

```typescript
import { verify } from '@nobulex/core';
const result = verify(spec, mw.getLog());
// result.compliant === true
// result.violations === []
```

any third party can run the same verification and get the same result. deterministic. no trust required.

## the regulatory timeline

- **June 30, 2026** — Colorado AI Act takes effect. accountability requirements for AI making consequential decisions.
- **December 2, 2027** — EU AI Act high-risk provisions. tamper-evident logging required. penalties up to €15M or 3% of global revenue.
- **November 2026** — NAIC AI evaluation tool rolls out nationwide for insurance.

if you're starting now, that's 107 days for the EU deadline. 74 days for Colorado.

## what this is not

this is not model safety. not prompt filtering. not guardrails. those are important but they solve different problems.

this is **behavioral accountability** — proving that an agent's actions conformed to its stated rules, with cryptographic evidence that holds up in an audit.

microsoft shipped their Agent Governance Toolkit for runtime enforcement. AWS launched Agent Registry for agent discovery. but neither generates tamper-evident proof that a third party can independently verify. that's the gap.

---

MIT licensed. 2,736 tests passing. registered issuer in the Open Agent Trust Registry.

`npm install @nobulex/sdk`

github: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)

if you're dealing with EU AI Act compliance for AI agents, happy to answer questions.
