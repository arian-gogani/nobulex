# Verifiable Tool-Call Receipts

Credit scores for AI agents. Every tool call an agent makes produces a
signed, hash-chained receipt. The verified track record becomes a trust
score that any third party can recompute and verify, without trusting the
operator that produced it.

This example wraps a PydanticAI agent's tool calls with Nobulex receipts.
Both the success and error paths emit receipts, so the chain has no silent
gaps: a failed tool call is still evidence, recorded as a DENY receipt.

## Why receipts

An agent that can read your database, move money, or send email on your
behalf has no portable track record today. There is no way for a third
party to verify what it did, whether it stayed in scope, or whether it
followed its policy. Application logs are self-attested: you either trust
the operator or you do not.

A receipt changes that. Each action produces a content-derived identifier,
`action_ref = SHA-256(JCS({agent_id, action_type, scope, timestamp_ms}))`,
signed with Ed25519. Any third party can recompute the identifier from the
receipt fields and confirm it matches, without trusting the process that
produced it. The accruing set of verified receipts is the agent's trust
score: the credit history that lets it earn more autonomy, higher limits,
and higher-value work.

## Running it

```bash
pip install nobulex pydantic-ai
python pydantic_ai_receipts.py
```

The example runs standalone even without PydanticAI installed, simulating
three tool calls so the receipt mechanics are visible:

```
1. search(query='weather in SF')
  receipt b5e9aea38b65159b...  verdict=ALLOW
2. send_email(to='user@example.com')
  receipt 2bb2b382a3c360aa...  verdict=ALLOW
3. delete_records(scope='all')  -- blocked by policy
  receipt d59089b51960e8b3...  verdict=DENY

Every receipt is Ed25519-signed and hash-chained. Verify them:
  b5e9aea38b65159b...  signature_valid=True
  2bb2b382a3c360aa...  signature_valid=True
  d59089b51960e8b3...  signature_valid=True

Trust score (verified track record): 23.26
```

## Wiring it to a real agent

Record a receipt inside each tool, on both the success and error path:

```python
from nobulex import Agent as ReceiptAgent
from pydantic_ai import Agent as PydanticAgent
from pydantic_ai.tools import RunContext

receipts = ReceiptAgent("my-agent")
agent = PydanticAgent("openai:gpt-4o-mini")

@agent.tool
def search(ctx: RunContext, query: str) -> str:
    try:
        result = do_search(query)
        receipts.act(action_type="tool:search", scope=f"query={query}")
        return result
    except Exception:
        receipts.deny(action_type="tool:search", scope=f"query={query}")
        raise
```

After a run, inspect `receipts.receipts` for the signed chain and
`receipts.trust_score` for the accrued score. Verify any receipt with
`receipts.verify_receipt(receipt)`.

## Standards

The bilateral receipt pattern is normative implementation guidance in the
[OWASP Agentic Skills Top 10 (AST09)](https://github.com/OWASP/www-project-agentic-skills-top-10/blob/main/ast09.md).
The canonicalization is RFC 8785 (JSON Canonicalization Scheme), verified
byte-identical against the Python `rfc8785` reference implementation.

Source: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
