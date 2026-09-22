# Nobulex  - Agent Receipt Layer for Dify

Cryptographic receipts for every Dify agent tool call.

## What it does

Every time your Dify workflow node calls a tool, Nobulex generates an
**Ed25519-signed, JCS-canonical receipt** that is hash-chained to the
previous one. The chain is tamper-evident: change any byte and
verification fails at exactly that point. An auditor can verify the
complete history offline, with no dependency on your infrastructure,
using only your agent's public key.

## Tools

| Tool | What it does |
|------|-------------|
| `sign_receipt` | Sign a cryptographic receipt for one tool call |
| `verify_receipt` | Verify a receipt's signature and chain integrity |
| `export_article12` | Export signed records and technical context for an Article 12 review |
| `get_trust_score` | Get this agent's current trust score score (0-100) |

## Quick start

1. Install the plugin in your Dify workspace.
2. Set the **Agent ID** credential (optional  - defaults to `dify-agent`).
3. Add `sign_receipt` as a node in your workflow after each tool call you
   want audited.
4. Pass `action_type` (what the agent did) and `scope` (what it touched).
5. At end of session, call `export_article12` to get the signed records
   and integrity evidence for review.

## Example: evidence collection for an Article 12 review

```
Tool Call Node (search_web)
  → sign_receipt(action_type="search_web", scope=query)
  → [next step in workflow]

Tool Call Node (send_email)
  → sign_receipt(action_type="send_email", scope=recipient)

End of session:
  → export_article12()  → store to immutable storage
```

The exported package contains signed receipts, a chain head hash, and
technical context about Article 12 logging capabilities. A reviewer can
check the exported chain independently. The export does not by itself
establish Article 12 compliance.

## Why this is different from standard audit logs

| | Standard logs | Nobulex |
|--|--------------|---------|
| Tamper-evident | ❌ (mutable) | ✅ (signature fails) |
| Independent verification | ❌ (trust operator) | ✅ (public key only) |
| Chain integrity | ❌ | ✅ (hash chain) |
| Technical evidence for Article 12 review | application logs | signed record chain |

## Links

- SDK: `pip install nobulex`
- GitHub: [github.com/arian-gogani/nobulex](https://github.com/arian-gogani/nobulex)
- OWASP reference: [PR #2210  - AML and Sanctions Compliance for AI Agent Payments](https://github.com/OWASP/CheatSheetSeries/pull/2210)
- Live demo: [nobulex.com/arena](https://nobulex.com/arena)

## trust score

`get_trust_score` returns a trust score score (0-100) based on verified
receipt history. This is the portable, accumulating agent reputation that
works across platforms  - the aspect Dify's team found most interesting and
that doesn't overlap with existing Marketplace tools.

Higher scores unlock more agent autonomy in trust score-aware workflows.
