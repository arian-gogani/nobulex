# TechCrunch Startup Battlefield 2026 — Application Text

DEADLINE: June 8, 2026
Apply at: https://techcrunch.com/startup-battlefield/
Two short videos required (product demo + founder story — record these!)

---

## Company Name
Nobulex

## One-Line Description
Cryptographic receipts for AI agent actions — tamper-evident, independently verifiable, EU AI Act Article 12 compliant.

## What does your company do?

Every AI agent acting in the world — calling tools, moving money, reading files, sending messages — leaves no neutral proof of what it actually did. The operator's logs say what happened. A regulator, auditor, or counterparty either trusts those logs or doesn't.

Nobulex is the receipt layer. Every agent action gets an Ed25519-signed, JCS-canonical receipt, hash-chained to the previous one. Change any byte and verification fails at exactly that point. An auditor verifies the complete history offline with only the agent's public key — no vendor dependency, no operator trust required.

The format is minimal on purpose: action_ref = SHA-256(JCS({agent_id, action_type, scope, timestamp_ms})). One 64-character hex string identifies any agent action, recomputably and independently.

pip install nobulex. The SDK ships with LangChain and CrewAI integrations, EU AI Act Article 12 export, and cross-validated test vectors (Python and TypeScript byte-identical). Benchmarks: ~13,700 signed receipts per second at p50.

EU AI Act Article 12 requires tamper-evident automatic logging for high-risk AI systems. Enforcement is August 2, 2026. "Tamper-evident" rules out SQL logs and cloud observability. Ed25519 over a hash chain is the right shape and nobody building agent infrastructure ships it yet.

## Stage

Pre-seed. Solo founder. Published SDK, live production adoption, no external funding.

## Target customers

Enterprise teams deploying AI agents in regulated industries: finance, healthcare, legal, government. Also: AI agent framework maintainers (LangChain, CrewAI, Dify) who want compliance as a feature.

## Traction

All verifiable:

- pip install nobulex is live on PyPI.
- AgentAudit AI (integration partner): five-point partnership active. Signed specimen receipt verifies end-to-end in 10 lines of Python.
- vaara v0.50: independent third-party adoption. Henri Sirkkavaara shipped EU AI Act Article 12 audit trails citing the nobulex signed-receipt design, no coordination.
- OWASP CheatSheetSeries PR #2210: merged into master by Jim Manico on June 2, 2026. Sections 8-11 credited to @arian-gogani.
- Dify Marketplace: PR #2500 open (60,000+ star platform). Community Operations confirmed architecture is sound and Trust Capital is genuinely differentiated.
- Microsoft AI Agents for Beginners: PR #571 open, adding nobulex to Lesson 18 as the only Python production receipt library.

## Competitors

Nobody builds this specific thing yet.

Adjacent territory:

Observability platforms (Langfuse, LangSmith) capture logs for debugging. Logs are mutable. An auditor trusts the platform. Not designed for compliance or independent verification.

On-chain attestation approaches require gas, specific L1/L2 infrastructure, and vendor lock-in.

Nobulex is different: Ed25519 + JCS + hash chain is cryptographically sound and operationally simple. Verifiable offline, with only the public key. Works across frameworks. Portable.

The closest design philosophy is code-signing and TLS certificate chains, not observability tools.

## Founding story

I'm Arian Gogani. I'm 15, self-taught, and I built Nobulex solo starting in February 2026.

The insight: every AI agent platform assumes you'll trust the operator's account of what happened. That's the same assumption that made financial fraud easy before double-entry accounting.

I had a problem that was clearly real and clearly unsolved, a clear implementation path, and enough self-discipline to ship it properly. The SDK is real. The partnerships are real. The OWASP merge is real. Everything is verifiable.

The EU AI Act Article 12 deadline is August 2. Enterprise teams that need this are not yet building it themselves. The window between "standard exists" and "standard is widely adopted" is the window to become the standard.

---

## VIDEO NOTES (record these before June 8)

Video 1 — Product demo (2 min max):
1. pip install nobulex (10 sec)
2. 10 lines of Python generating a signed receipt
3. Modify one byte, show verify() returning False
4. EU AI Act Article 12 export
Just a screen recording. No flashy graphics.

Video 2 — Founder story (1 min max):
1. Who you are (15, self-taught, solo)
2. What problem (agents leave no neutral proof)
3. Why now (EU AI Act, August 2)
4. What you've shipped (PyPI, OWASP, vaara, AgentAudit)
Just talk to the camera. The age and the speed are the story.
