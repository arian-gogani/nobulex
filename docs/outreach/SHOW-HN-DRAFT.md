# Show HN: Nobulex — Ed25519 signed receipts for AI agent actions

**Title:** Show HN: Nobulex – cryptographic receipts for AI agent actions (pip install nobulex)

---

## Body

When an AI agent calls a tool, moves money, or writes a file, there's
currently no neutral record that a third party can verify. The operator's
logs say what happened. You either trust the operator or you don't.

Nobulex adds a receipt layer. Every agent action gets:

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act(action_type="send_email", scope="user@example.com")

print(receipt.action_ref)   # SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))
print(receipt.verify())     # True — modify any byte and this returns False
```

The receipt is Ed25519-signed over RFC 8785 JCS-canonical JSON, hash-chained
to the previous one. An auditor verifies offline with only the public key.
No service dependency. No operator trust required.

**What's built:**
- Python SDK on PyPI (`pip install nobulex`), ~13,700 signed receipts/sec
- TypeScript SDK (`@nobulex/core`) — byte-identical action_refs cross-validated
- LangChain and CrewAI integrations
- Dify Marketplace plugin (PR #2500 open)
- EU AI Act Article 12 export
- OWASP CheatSheetSeries PR #2210 — JCS canonicalization rationale and
  regulatory mapping for AI agent payments merged into master by Jim Manico

**Why this matters now:** EU AI Act Article 12 requires tamper-evident
automatic logging for high-risk AI systems. The deadline is August 2, 2026.
"Tamper-evident" rules out SQLite and cloud logs. Ed25519 over a hash chain
is the right shape — and nobody in the agent stack ships it yet.

The receipt format is minimal on purpose: one 64-character action_ref,
one signature, one chain link. Everything else is an application layer.

Repo: github.com/arian-gogani/nobulex
Spec: action-ref-v1 (in repo)
Live demo: nobulex.com/arena (try to produce a valid forgery)

Happy to answer questions on the crypto, the chain model, or the compliance
angle.

---

## Timing notes

Post Tuesday or Wednesday morning 9-10am ET for best HN front-page window.
Avoid Monday (crowded) and Friday (low engagement).

Title variants to A/B in head:
- "Show HN: Nobulex – Ed25519 receipts for every AI agent action (pip install nobulex)"
- "Show HN: Cryptographic audit trails for AI agents – tamper-evident, no vendor dependency"
- "Show HN: Nobulex – making AI agent actions independently verifiable"

The first is most specific and most likely to get the HN crowd who cares about
the crypto/implementation details. Lead with the technical claim.
