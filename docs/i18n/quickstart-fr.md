# Démarrage rapide  - 30 minutes jusqu'à votre premier covenant vérifié

De zéro à un covenant signé et vérifié en moins de 30 minutes.

---

## Prérequis

- Node.js 18+
- npm 9+

---

## Chemin le plus rapide : serveur MCP (5 min)

```bash
npm install kova
```

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
// Terminé. L'enforcement du covenant est actif.
```

---

## Chemin complet : covenant personnalisé (30 min)

### Étape 1 : Installer (2 min)

```bash
npm install @nobulex/sdk
```

### Étape 2 : Créer un covenant (5 min)

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

### Étape 3 : Vérifier (2 min)

```typescript
const result = await client.verifyCovenant(covenant);
console.log('Valide:', result.valid);
```

### Étape 4 : Évaluer les actions (5 min)

```typescript
const eval_ = await client.evaluateAction(covenant, 'read', '/data/file.txt');
console.log('Lecture autorisée:', eval_.permitted);
```

---

## Prochaines étapes

- [QUICK-START.md](../QUICK-START.md) (complet, anglais)
- [eu-ai-act-fr.md](./eu-ai-act-fr.md)  - Règlement IA
- [docs/README.md](../README.md)  - Index de la documentation
