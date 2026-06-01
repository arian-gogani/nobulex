# Nobulex — Honest Pitch Sheet
## Use this for all outreach. No inflated claims.

### One sentence
Nobulex generates tamper-proof receipts for everything your AI agent does.

### Three sentences
AI agents are starting to do real things — move money, handle data, sign contracts. There's no standardized way to verify what they actually did. Nobulex fixes that with cryptographic receipts that build into a trust score.

### What it is
- Open-source Python SDK: `pip install nobulex`
- 4 lines to generate your first receipt
- Ed25519 signatures, SHA-256 hashing, JCS canonicalization
- Trust Capital scoring (credit score for machines)
- LangChain and CrewAI integrations
- MIT licensed

### What it does (honestly)
- Generates cryptographic receipts for AI agent actions
- Receipts are tamper-proof (modify anything, signature breaks)
- Receipts build into a Trust Capital score
- Denied actions generate proof the system caught violations
- Works with any Python function via @track decorator

### Traction (honest version, June 2026)
- **Open-source SDK live:** `pip install nobulex` (PyPI verified)
- **First integration partner locked:** AgentAudit AI / RunLockAI — five-point partnership, signed specimen receipt published, integration guide drafted, joint case study in progress
- **Cross-implementation verified:** Python + JS produce byte-identical action_refs on the 4 published test vectors
- **OWASP contribution:** PR #2209 to CheatSheetSeries (AML and Sanctions Compliance for AI Agent Payments cheat sheet)
- **Standards body:** Microsoft AGT ADOPTERS.md PR merged (PR #1703, May 2026)
- **Two warm call requests** in one week from a 1517 Fund partner and a W3C Community Group chair
- **30 GitHub stars, 6 forks** (forkers include Red Sentinel — "the ultimate AI security platform" — and a Northrop Grumman senior engineer)
- **Demo runs from clean clone:** tamper detection works, signature verification works, full audit trail reproducible

### What NOT to say
- ❌ "Microsoft merged our code into AutoGen"
  ✅ "Referenced in Microsoft AutoGen ecosystem discussions"
- ❌ "10 independent teams validated the protocol"
  ✅ "Active in cross-framework standards discussions"  
- ❌ "OWASP references it"
  ✅ "Contributing to OWASP Agentic Skills Top 10 discussions"
- ❌ "Singapore IMDA acknowledged our work"
  ✅ "Submitted feedback to IMDA's agentic AI governance framework"

### For YC video
"I'm 15. Credit scores exist for people. They don't exist for machines. I built them."

### For cold outreach
"I built an open-source SDK that generates tamper-proof receipts for AI agent actions. 4 lines of Python. Would love your feedback."

### Links
- GitHub: github.com/arian-gogani/nobulex
- Site: nobulex.com
- Arena: nobulex.com/arena
- PyPI: https://pypi.org/project/nobulex/
