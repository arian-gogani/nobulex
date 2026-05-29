# Outreach target: Matthew Snider (BitFinance)

## Why him
- Writes BitFinance on Substack: https://bitfinance.substack.com
- Background: "$250M+ in Digital Asset Fund Operations," MBA. Finance/digital-asset operator.
- Posts actively (multiple times per week). Recent post (2 days ago):
  **"Your Software Is About to Start Paying Its Own Bills."**
- In that post he asks, verbatim, the exact question Nobulex answers:
  *"For external auditors, the question is who signs the audit trail when a
  software agent initiates a transaction."*
- Reaches a finance/compliance/fund-ops audience that the current ~55 X
  followers do NOT reach. That audience cares about audit trails and has budget.

## Why this beats another GitHub comment
- He raised the problem himself, publicly, this week. Replying is on-topic and
  welcome, not spam.
- Human-scale audience: a thoughtful reply from a 15-year-old who actually built
  the thing stands out, where it would vanish in a 100k-follower feed.
- Substack authors read and reply to their comments.

## How to reach him (pick one, in Arian's own voice)
1. Comment on the "Paying Its Own Bills" post (best: responds to his exact question).
2. Substack Note / DM.
3. LinkedIn (he's "Matthew Snider, MBA").

## Draft reply to his post (Arian's voice — edit freely, do NOT send as-is if it doesn't sound like you)

> This is the exact question I've been building on. "Who signs the audit trail"
> is the whole problem.
>
> My take: the agent signs each action itself, before it runs, with its own key.
> Every action becomes a receipt — what it did, when, the parameters — signed
> Ed25519 over canonical JSON. Change one byte and verification fails. An auditor
> doesn't have to trust the operator's logs; they recompute the hash and check
> the signature.
>
> I'm 15 and built this as an open-source SDK (nobulex). It's not theoretical —
> there's a second independent implementation that produces byte-identical
> receipts, and a live $7,400 challenge where the top level is an agent that
> cryptographically can't break its own rules: nobulex.com/arena
>
> Would genuinely value your read on whether this maps to what fund auditors
> actually need.

## Notes
- Lead with HIS point, not your product. He asked the question; you answer it.
- The "I'm 15 + here's a working thing + here's a way to verify it" combination
  is the hook. Don't bury it, don't oversell it.
- Link the arena (your highest-engagement asset), not just the repo.
- If he replies or shares, that's reach into a finance audience you can't get
  from X today. If he doesn't, you've lost five minutes and left a smart comment
  on a relevant post where others will see it.

## Other leads from the same search (lower priority, still real)
- "AI Governance Today" (Substack) — EU AI Act high-risk scope, governance audience.
- r/ArtificialIntelligence thread on EU AI Act + AI agent liability (active, on-topic).
