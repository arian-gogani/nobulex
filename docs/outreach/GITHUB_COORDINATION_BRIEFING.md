# GitHub Coordination Briefing  - May 11, 2026

## URGENT TASKS - DEADLINE MAY 18

### ✅ COMPLETED
- **Posted response to A2A #1829 thread** confirming v0.3.3 participation and technical alignment

### ❌ STILL NEEDED
- **Find and respond to spending_authorization PR** (v0.3.2 field-shapes)
  - Couldn't locate via GitHub search
  - Might be in private repo, might not exist yet, might need to be created by Arian
  - **Deadline: May 18, 2026**

---

## CONTEXT: What's Happening

Multiple standards bodies and technical contributors are coordinating around Nobulex primitives across three major specs:
- **A2A protocol** (agent-to-agent) v1.5 cycle
- **CTEF** (Covenant Transparency Extension Format, Nobulex's spec) v0.3.2 → v0.3.3
- **APS** (Agent Protocol Standard, Tymofii's conformance suite)

Three independent implementations converging:
- @nobulex/crypto (Arian's)
- envoys-rfc9421 (jschoemaker)
- Hippo (lawcontinue/hippo-auth - NEW)

---

## TIMELINE

**TOMORROW (Tue May 12, 8am ET):**
- State of Agent Security 2026 publishes
- References CTEF v0.3.1 frozen state
- Arian is in the litepaper

**MAY 19-22 (THIS WEEK):**
- CTEF v0.3.2 lands with informative references to A2A #1829 + #1496
- spending_authorization PR response DUE

**MID-JUNE:**
- CTEF v0.3.3 cycle
- Envelope-shape diff
- Unified error taxonomy
- Cross-extension fixture matrix

---

## KEY PEOPLE

**Kenne (kenneives):**
- CTEF maintainer
- Coordinating v0.3.3 working doc
- Asked Arian to confirm participation

**Tymofii (aeoess):**
- APS conformance suite maintainer
- Cross-validation fixture work
- Integration with OpenLineage (Linux Foundation)

**jschoemaker:**
- A2A protocol maintainer
- envoys-rfc9421 implementation

**lawcontinue:**
- New contributor
- Built Hippo reference implementation on top of this stack

**thebenignhacker:**
- #1496 extension work (identity/delegation)

---

## WHAT ARIAN COMMITTED TO

1. **v0.3.3 shared working doc participation**  - confirmed
2. **Respond to spending_authorization PR by May 18**  - NOT YET DONE
3. **Fixture cross-validation coordination** with aeoess
4. **Technical alignment** on:
   - Forbidding floats in canonical hash scope (JCS + numeric profile)
   - Semantic equivalence staying at tool-version layer
   - Layer-attribution on error codes (wire/identity/authority/continuity)
   - RFC 9421 tag parameter for signing purpose disambiguation

---

## TECHNICAL DETAILS FROM EMAIL THREAD

**Four-layer stack being coordinated:**
1. L1: Identity (#1496 §1)
2. L2: Transport/wire signatures (RFC 9421)
3. L3: Authority/policy (#1496 §5)
4. L4: Continuity/delegation (APS rotation-attestation)

**Seven acceptance criteria for receipts:**
1. Authorization (session_id, agent_id, authorization_context)
2. Model/prompt/tool versions
3. Retrieved sources
4. Policy check
5. Human approval
6. Normalized tool args (canonicalization issue)
7. Chain anchor (previous_hash, chain_id)

**Key canonicalization decision:**
- Forbid floats in canonical hash scope
- Serialize numerics as strings or rationals before hash
- Avoids IEEE-754 portability issues
- JCS (RFC 8785) handles the rest

---

## WHERE TO LOOK FOR SPENDING_AUTHORIZATION PR

**Already searched (0 results):**
- Public GitHub PRs with author:kenneives
- Public issues with "spending_authorization"
- GitHub notifications

**Try these:**
1. Check private repos Arian has access to:
   - aeoess/aps-conformance-suite
   - agentgraph-co/* repositories
   - Any CTEF-related private repos

2. Check Gmail for direct PR links:
   - Search "spending_authorization"
   - Look for GitHub notification emails

3. Ask in A2A #1829 thread:
   - "Could you link me to the spending_authorization PR? I'd like to respond by May 18 as committed."

4. Check if this is something Arian needs to CREATE:
   - The phrase "v0.3.2 field-shapes PR" might mean Arian needs to propose the field shapes
   - Not reviewing an existing PR, but creating the proposal

---

## REPOSITORIES TO CHECK

**Public:**
- a2aproject/A2A (main coordination thread #1829)
- aeoess/aps-conformance-suite (fixture cross-validation)
- aeoess/agent-governance-vocabulary (unified error enum)

**Potentially Private:**
- agentgraph-co/ctef (if separate from Nobulex repo)
- Any private forks or working branches

**Arian's repos:**
- ariangogani/nobulex (main protocol repo)
- Check for open issues/PRs mentioning spending_authorization

---

## RESPONSE TEXT (ALREADY POSTED TO A2A #1829)

The following was successfully posted:

```
@jschoemaker @aeoess @kenneives  - v0.3.3 coordination confirmed. Count me in for the shared working doc (markdown at aeoess/aps-conformance-suite works).

On the three artifacts: envelope-shape diff, unified error enum, cross-extension fixture matrix  - all aligned. The layer-attribution on error codes is the right call (wire/identity/authority/continuity routing).

On canonicalization: forbidding floats in canonical hash scope is clean. JCS + numeric profile collapses to deterministic verification without the IEEE-754 portability rabbit hole. Semantic equivalence (select vs SELECT) staying at tool-version layer is correct  - chain layer should verify bytes, not intent.

On @lawcontinue's tag parameter insight: RFC 9421's tag for disambiguating signing purpose (task vs heartbeat vs delegation) from the same keyid without a registry is genuinely useful for the four-layer composition. Worth folding into the v0.3.3 envelope-shape diff: each claim_type can carry a different tag value, reducing the need for additional discrimination logic in the gateway.

On spending_authorization claim subtype (v0.3.2 field-shapes PR): will respond by May 18.

Watching for State of Agent Security 2026 tomorrow 8am ET. Cross-validation fixtures land at aeoess/aps-conformance-suite this week.

 - Arian
```

---

## STRATEGIC CONTEXT

This coordination is REAL external validation:
- Multiple independent implementations (not just Arian evangelizing)
- Standards-body convergence (A2A, CTEF, APS)
- Linux Foundation involvement (AAIF Issue #20, OpenLineage)
- Publication tomorrow locks CTEF v0.3.1 as referenced state
- **Company grade moved from 6.3 → 6.5** due to this ecosystem traction

What it doesn't change:
- Still zero revenue
- Still solo team
- Still no insurance carrier signal

**Primary external action remains: Send Armilla email (karthik@armilla.ai)**
That's the revenue/carrier unlock, not the GitHub coordination.

---

## IMMEDIATE NEXT STEPS FOR NEW CONVERSATION

1. **Navigate to Arian's Gmail** and search for "spending_authorization" to find PR link
2. **If no email:** Check private repos (aeoess/aps-conformance-suite, agentgraph-co/*)
3. **If still not found:** Post in A2A #1829 asking for link
4. **Once found:** Review field-shapes proposal and post technical response
5. **Deadline:** Must be done by May 18 (7 days from now)

---

## REFERENCE LINKS

- A2A #1829: https://github.com/a2aproject/A2A/issues/1829
- Arian's GitHub: https://github.com/ariangogani
- Nobulex repo: https://github.com/ariangogani/nobulex (if public) or check private location

---

## CHROME BROWSER CONTEXT

Two browsers connected:
- Browser 1 (deviceId: 47dae012-a172-43b1-a9b6-a14d45e3d775)
- term (deviceId: 02223fb5-a3ed-4b90-8bd3-00fc116608db)

Both on macOS, both local.

---

**Status:** A2A coordination posted ✓ | spending_authorization PR still pending ❌
**Deadline:** May 18, 2026
**Priority:** Find and respond to spending_authorization PR before all other GitHub tasks
