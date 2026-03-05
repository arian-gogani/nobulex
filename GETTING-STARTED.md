# Getting Started with Nobulex

**5 minutes to your first trusted agent.**

---

## 1. Install

```bash
npm install kova
```

## 2. Wrap Your MCP Server (3 lines)

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
// Done. Covenant enforcement is active.
```

**Presets:** `data-isolation` | `read-write` | `network` | `minimal`

## 3. Run Compliance Audit

```bash
npx kova audit ./
```

Shows EU AI Act readiness, covenant coverage, and recommended next steps.

## 4. Initialize (Optional)

```bash
npx kova init
```

Generates key pair and `nobulex.config.json` for custom covenants.

---

## What You Get

- **Hard enforcement** — Agent cannot violate tool/API constraints
- **Audit trail** — Hash-chained log of every action
- **Compliance proof** — Verifiable without revealing proprietary logic
- **EU AI Act path** — Mapped to Aug 2026 requirements

---

## Next Steps

- [Full Quick Start](./docs/QUICK-START.md) — 30 min custom covenant walkthrough
- [EU AI Act Mapping](./docs/eu-ai-act-mapping.md) — Article-by-article compliance
- [Examples](./examples/README.md) — Runnable code samples
