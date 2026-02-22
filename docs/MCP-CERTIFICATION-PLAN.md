# MCP Certification Plan

Proactive certification of top 50 MCP servers. Create the market by doing the work first.

---

## Goal

- Publish "Kova Trust Report: 50 MCP Servers Analyzed"
- Badge system: "Kova Verified" with covenant hash
- Developers learn to look for the badge when choosing MCP servers

---

## Phase 1: Selection (Week 1)

1. **Identify top 50 MCP servers** — GitHub stars, npm downloads, MCP directory listings
2. **Prioritize by risk** — Data access, financial, healthcare, file system, network
3. **Create analysis template** — What it claims, what it does, covenant draft, gaps

---

## Phase 2: Analysis (Weeks 2–4)

For each server:

| Field | Description |
|-------|-------------|
| **Name** | MCP server name + repo |
| **Claims** | What the README/docs say it does |
| **Actual behavior** | Tools exposed, APIs called, data flows |
| **Covenant draft** | CCL that would accurately constrain it |
| **Gaps** | What's not covered, risks, recommendations |
| **Kova readiness** | 1–5 score: how close to Kova Verified |

---

## Phase 3: Trust Report (Week 5)

1. **Publish report** — "Kova Trust Report: 50 MCP Servers Analyzed"
2. **Format** — Markdown + JSON export for tooling
3. **Distribution** — GitHub, HN, MCP community channels

---

## Phase 4: Badge System (Week 6–8)

1. **Badge design** — "Kova Verified" SVG with covenant hash
2. **Verification endpoint** — Resolve badge → covenant → verify
3. **Apply badges** — Servers that pass analysis get badge; others get "Under Review" or "Gaps Identified"

---

## Phase 5: Feedback Loop (Ongoing)

- MCP developers see report
- Good ratings → want badge → adopt Kova
- Bad ratings → want to improve → adopt Kova
- Both paths lead to adoption

---

## Targets

| Milestone | Timeline |
|-----------|----------|
| Top 50 list finalized | Week 1 |
| 25 servers analyzed | Week 3 |
| Full report published | Week 5 |
| Badge system live | Week 8 |

---

## Relation to Adoption

- **Improvement 51:** MCP Certification Wedge
- **ADOPTION-STRATEGY.md:** MCP Certification: The Proactive Play
- **ADOPTION-READINESS.md:** Gap 2, Week 3 content — MCP Trust Report
