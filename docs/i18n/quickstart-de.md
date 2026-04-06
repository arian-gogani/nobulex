# Quick Start — 30 Minuten zum ersten verifizierten Covenant

Von null zu einem signierten, verifizierten Covenant in unter 30 Minuten.

---

## Voraussetzungen

- Node.js 18+
- npm 9+

---

## Schnellster Weg: MCP-Server (5 Min)

```bash
npm install kova
```

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
// Fertig. Covenant-Enforcement ist aktiv.
```

---

## Vollständiger Pfad: Eigenes Covenant (30 Min)

### Schritt 1: Installieren (2 Min)

```bash
npm install @nobulex/sdk
```

### Schritt 2: Covenant erstellen (5 Min)

```typescript
import { NobulexClient } from '@nobulex/sdk';

const client = new NobulexClient();
await client.generateKeyPair();

const covenant = await client.createCovenant({
  issuer: { id: 'operator-1', publicKey: client.keyPair!.publicKeyHex, role: 'issuer' },
  beneficiary: { id: 'user-1', publicKey: '0'.repeat(64), role: 'beneficiary' },
  constraints: `
    permit read on '/data/**'
    deny write on '/system/**'
    limit api.call 100 per 3600 seconds
  `,
});
```

### Schritt 3: Verifizieren (2 Min)

```typescript
const result = await client.verifyCovenant(covenant);
console.log('Gültig:', result.valid);
```

### Schritt 4: Aktionen bewerten (5 Min)

```typescript
const eval_ = await client.evaluateAction(covenant, 'read', '/data/file.txt');
console.log('Lesen erlaubt:', eval_.permitted);
```

---

## Nächste Schritte

- [QUICK-START.md](../QUICK-START.md) (vollständig, Englisch)
- [eu-ai-act-de.md](./eu-ai-act-de.md) — EU KI-Verordnung
- [docs/README.md](../README.md) — Dokumentationsindex
