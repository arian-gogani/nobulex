# Nobulex - Honest Pitch Sheet
## Use this for all outreach. No inflated claims.

### One sentence
Nobulex generates signed receipts for claims about AI agent actions. A verifier can detect later changes to a receipt, but the signature does not prove the claimed action happened.

### Three sentences
AI agents are starting to do real things: move money, handle data, and sign contracts. Ordinary operator logs are weak evidence in a dispute. Nobulex records signed claims that another party can verify without using the original runtime.

### What it is
- Open-source Python SDK: `pip install nobulex`
- 4 lines to generate your first receipt
- Ed25519 signatures, SHA-256 hashing, JCS canonicalization
- credit score for machines
- LangChain and CrewAI integrations
- MIT licensed

### What it does (honestly)
- Generates cryptographic receipts for AI agent actions
- Changing a signed receipt invalidates its signature
- Receipts can feed an experimental trust score
- Denied actions record that the SDK was told a denial occurred
- Works with any Python function via @track decorator

### Traction (honest version, June 2026)
- **Open-source SDK live:** `pip install nobulex` (PyPI verified)
- **First integration partner locked:** AgentAudit AI / RunLockAI  - five-point partnership, signed specimen receipt published, integration guide drafted, joint case study in progress
- **Cross-implementation verified:** Python + JS produce byte-identical action_refs on the 4 published test vectors
- **OWASP:** Sections 8-11 of the AML and Sanctions Compliance for AI Agent Payments cheat sheet ([PR #2210](https://github.com/OWASP/CheatSheetSeries/pull/2210)) merged into master by Jim Manico with contributions from PR #2209 credited to @arian-gogani (JCS canonicalization rationale, cross-agent accountability, regulatory mapping).
- **vaara v0.50**  - Independent Aider + MCP runtime audit layer by Henri Sirkkavaara shipping Ed25519-signed receipts citing the nobulex design.
- **Standards body:** Microsoft AGT ADOPTERS.md PR merged (PR #1703, May 2026)
- **Two warm call requests** in one week from a 1517 Fund partner and a W3C Community Group chair
- **Dify Marketplace submission accepted for review**  - langgenius/dify-plugins#2500. Dify (90K+ stars). Plugin MERGED. Architecture confirmed sound and differentiated from existing tools. Plugin built at packages/dify-plugin/.
- **Microsoft contributions:** Three pull requests authored by Arian were merged into Microsoft repositories. The substantive implementation is agent-governance-toolkit#1333, which added bilateral receipt signing. These are accepted contributions, not Microsoft endorsement of Nobulex.
- **30 GitHub stars, 6 forks** (forkers include Red Sentinel  - "the ultimate AI security platform"  - and a Northrop Grumman senior engineer)
- **Demo runs from clean clone:** tamper detection works, signature verification works, full audit trail reproducible

### What NOT to say
- ❌ "Microsoft merged our code into AutoGen"
  ✅ "A pull request I authored adding bilateral receipt signing was merged into Microsoft's Agent Governance Toolkit"
- ❌ "OpenLineage accepted Nobulex into its ecosystem"
  ✅ "OpenLineage has not accepted Nobulex"
- ❌ "AAIF has Nobulex under staff review"
  ✅ Do not make this claim without written confirmation that can be shown
- ❌ "10 independent teams validated the protocol"
  ✅ "Active in cross-framework standards discussions"  
- ❌ "OWASP references it"
  ✅ "Contributing to OWASP Agentic Skills Top 10 discussions"
- ❌ "Singapore IMDA acknowledged our work"
  ✅ "Submitted feedback to IMDA's agentic AI governance framework"

### For YC video
"I'm 15. Credit scores exist for people. They don't exist for machines. I built them."

### For cold outreach
"I built an open-source SDK for signed claims about AI agent actions. A third party can verify who signed a receipt and whether it changed later. I would love your feedback."

### Links
- GitHub: github.com/arian-gogani/nobulex
- Site: nobulex.com
- Arena: nobulex.com/arena
- PyPI: https://pypi.org/project/nobulex/
