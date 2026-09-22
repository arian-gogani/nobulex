---
title: What EU AI Act Article 12 actually requires from high-risk AI logging
published: false
description: Article 12 requires automatic event logging. It does not require signed or tamper-evident receipts. Here is the boundary and where cryptographic receipts can still help.
tags: ai, security, compliance, opensource
---

Correction first: an earlier version of this draft said EU AI Act Article 12 requires tamper-evident logs. That was wrong.

Article 12 says high-risk AI systems must technically allow the automatic recording of events over the lifetime of the system. The logging must support traceability, post-market monitoring, and operational monitoring. It does not require Ed25519 signatures, hash chains, independent verification, or a particular receipt format.

I also used an outdated application date. Regulation (EU) 2026/1744 moved the Chapter III high-risk obligations to December 2, 2027 for systems classified under Article 6(2) and Annex III, and August 2, 2028 for systems classified under Article 6(1) and Annex I.

Official sources:

- [Article 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12)
- [Current application dates](https://ai-act-service-desk.ec.europa.eu/en/ai-act/faq/when-does-enforcement-start)
- [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj)

## What ordinary logs provide

An application can automatically record tool calls, decisions, errors, and other events in a database or file. That can satisfy the logging capability Article 12 describes when the system and events are in scope. The Act does not turn cryptographic verification into a condition of compliance.

The legal requirement and the evidentiary problem are separate questions.

An operator-controlled log can be edited, deleted, or selectively produced. That matters when the record has to survive a dispute with a counterparty, insurer, auditor, or court that does not trust the operator. Cryptographic receipts can help with that narrower problem.

## What a signed receipt proves

A signed receipt can establish:

1. which key signed the recorded fields;
2. whether those signed fields changed later; and
3. whether a sequence of supplied records still forms the expected hash chain.

It does not prove:

1. that the described action happened in the real world;
2. that the fields were true when signed;
3. that no actions or records were omitted; or
4. that the signer was independent of the operator being assessed.

That distinction is why "tamper-evident" is more accurate than "tamper-proof," and why even tamper-evident must be stated with limits.

## A separate technical pattern

Nobulex's earlier receipt SDK records signed claims and links them with hashes. Verification can detect later edits to supplied records without requiring the original agent runtime.

```typescript
import { createDID, parseSource, EnforcementMiddleware } from '@nobulex/core';

const agent = await createDID();
const spec = parseSource('covenant MyAgent { permit read; forbid write; }');
const mw = new EnforcementMiddleware({ agentDid: agent.did, spec });
```

That can be useful when evidence needs to be checked by someone who does not control the runtime. It is not an Article 12 requirement, and the SDK alone cannot prove that a claimed external action occurred.

The receipt packages are a prior Nobulex direction. Current work focuses on independently reproducible verification in the [Nobulex registry](https://github.com/arian-gogani/nobulex-registry).

MIT licensed.

GitHub: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
