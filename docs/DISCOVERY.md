# Federated Covenant Discovery

**Hole 8 fix:** Cross-platform discovery without a central registry.

---

## Principle

- **Trust the Ed25519 signature, not the resolver.**
- Multiple independent resolvers (like DNS).
- No single point of control.
- `.well-known` style endpoints for covenant discovery.

---

## Convention: `.well-known/stele` (Kova)

Agents or operators exposing covenants over HTTP SHOULD serve:

```
GET /.well-known/stele
```

*Note: The path remains `/.well-known/stele` for backward compatibility. Kova is the public-facing brand; the protocol endpoint is unchanged.*

**Response:** JSON object with covenant discovery metadata.

```json
{
  "stele": "0.1.0",
  "agentId": "<content-address or agent identity>",
  "covenants": [
    {
      "id": "<content-address>",
      "url": "https://example.com/covenants/abc123.json",
      "status": "active"
    }
  ],
  "resolver": "https://example.com/stele/resolve"
}
```

**Verification:** The covenant document at `url` MUST be verified using the standard 11 checks. The resolver URL is informational; trust comes from the signature on the covenant itself.

---

## Resolution Flow

1. Client discovers agent (e.g., via MCP, API, or manual config).
2. Client fetches `/.well-known/stele` from the agent's base URL.
3. Client fetches covenant document(s) from the `url` field(s).
4. Client verifies each covenant using `@nobulex/verifier`.
5. Trust is established by the Ed25519 signature, not by the server that served the document.

---

## Multiple Resolvers

Different parties can run resolvers that index covenants. A client might:

- Prefer the agent's own `/.well-known/stele`
- Fall back to a third-party resolver
- Verify the covenant regardless of source

The covenant's content-address (SHA-256 of canonical form) is the source of truth. Any resolver serving the same content produces the same ID.

---

## Implementation Status

- **Convention:** Documented (this file).
- **Server middleware:** `createWellKnownHandler` in `@nobulex/sdk` — use with Express: `app.get('/.well-known/stele', createWellKnownHandler({ agentId, covenants }))`.
- **Client resolution:** SteleClient uses `MemoryChainResolver`; HTTP resolver is an extension point.
- **Federated resolvers:** Ecosystem layer; not in core protocol.
