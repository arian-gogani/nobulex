# Kova API Gateway — Trust-Gated Access in 10 Minutes

Protect your API with covenant verification. No Kova = no access.

---

## What It Does

The Kova API Gateway middleware:

1. **Extracts** the covenant from the request (header, body, or query)
2. **Verifies** the covenant (signature, expiration, chain)
3. **Evaluates** the requested action against CCL constraints
4. **Blocks** or **allows** the request

---

## Express / Node.js

```bash
npm install @stele/sdk express
```

```typescript
import express from 'express';
import { SteleClient, kovaGatewayMiddleware } from '@stele/sdk';

const app = express();
const client = new SteleClient();
await client.generateKeyPair();

// Protect all routes under /api (uses default extractor: X-Kova-Covenant or Bearer)
app.use('/api', kovaGatewayMiddleware({
  client,
  // Optional: enforce minimum constraints
  // requiredConstraints: ["deny write on '/system/**' severity critical"],
  actionExtractor: (req) => req.method?.toLowerCase() ?? 'get',
  resourceExtractor: (req) => req.path ?? '/',
}));

app.get('/api/data', (req, res) => {
  res.json({ message: 'Access granted — covenant verified' });
});

app.listen(3000);
```

---

## Required Headers

The default covenant extractor checks (in order):

| Source | Format |
|--------|--------|
| `X-Kova-Covenant` | Raw JSON string or base64-encoded covenant |
| `Authorization: Bearer <token>` | Base64-encoded covenant JSON |

| Header | Description |
|--------|-------------|
| `X-Kova-Covenant` | Raw JSON string, or base64-encoded covenant |
| `Authorization: Bearer <base64>` | Base64-encoded covenant JSON (fallback) |
| `X-Kova-Action` | (Optional) Override action (default: HTTP method) |
| `X-Kova-Resource` | (Optional) Override resource (default: path) |

### Required Constraints

Pass `requiredConstraints` to enforce that the agent's covenant includes specific CCL statements:

```typescript
app.use('/api', kovaGatewayMiddleware({
  client,
  requiredConstraints: [
    "deny write on '/system/**' severity critical",
    "require audit.log on '**'",
  ],
}));
```

If any required constraint is missing from the covenant, the gateway returns 401 with `{ error: 'Covenant missing required constraints', missing: [...] }`.

---

## Trust-Gated Access (Improvement #48)

- **No covenant** → 401 Unauthorized
- **Invalid covenant** → 401 with failed check details
- **Action denied by CCL** → 403 Forbidden
- **Action permitted** → Request proceeds; `x-kova-permitted: true` header added

---

## Next Steps

- [QUICK-START.md](./QUICK-START.md) — Create your first covenant
- [eu-ai-act-mapping.md](./eu-ai-act-mapping.md) — EU AI Act compliance
- [ADOPTION-STRATEGY.md](./ADOPTION-STRATEGY.md) — Go-to-market
