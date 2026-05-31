# Red Sentinel - integration partner outreach

## Who they are (verified from their GitHub)
- "The ultimate AI Security platform" (redsentinel.xyz)
- Their repos: agentdojo (attack/defense eval), petri (alignment auditing),
  PurpleLlama (LLM security), nanobot, sentinel-model-training
- They forked nobulex on May 23. They are building a security platform and
  evaluating the receipt layer as a component.

## Why they're a great lead
- Same profile as AgentAudit (your first integration partner)
- They need exactly what nobulex provides: tamper-evident proof of agent actions
- Their alignment-auditing angle (petri) maps directly to behavioral receipts

## How to reach them
- They have a site (redsentinel.xyz) with likely a contact
- Or open a GitHub issue on their public repos
- Or X/LinkedIn

## Draft message (Arian's voice - edit before sending)

> saw you forked nobulex alongside agentdojo and petri. looks like you're
> building the full agent-security stack: attack/defense eval + alignment
> auditing.
>
> nobulex fills the evidence gap: after petri audits behavior, the receipt
> layer makes that audit tamper-evident and independently verifiable. every
> agent action gets an Ed25519 signed receipt, hash-chained. an auditor
> verifies without trusting the operator.
>
> a second team rebuilt the format independently and got byte-identical
> results, so it works as a shared standard across tools, not just one impl.
>
> would an integration make sense for Red Sentinel? happy to send a specimen
> receipt payload that maps to your audit output.
>
> pip install nobulex / github.com/arian-gogani/nobulex

## Why this works
- Specific to what they actually build (named their repos)
- Positions nobulex as complementary, not competitive
- "shared standard" framing = they adopt rather than rebuild
- Engineer-to-engineer, no hard sell
