# Inicio rápido  - 30 minutos hasta tu primer covenant verificado

De cero a un covenant firmado y verificado en menos de 30 minutos.

---

## Requisitos previos

- Node.js 18+
- npm 9+

---

## Ruta más rápida: servidor MCP (5 min)

```bash
npm install kova
```

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
// Listo. El enforcement del covenant está activo.
```

---

## Ruta completa: covenant personalizado (30 min)

### Paso 1: Instalar (2 min)

```bash
npm install @nobulex/sdk
```

### Paso 2: Crear covenant (5 min)

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

### Paso 3: Verificar (2 min)

```typescript
const result = await client.verifyCovenant(covenant);
console.log('Válido:', result.valid);
```

### Paso 4: Evaluar acciones (5 min)

```typescript
const eval_ = await client.evaluateAction(covenant, 'read', '/data/file.txt');
console.log('Lectura permitida:', eval_.permitted);
```

---

## Próximos pasos

- [QUICK-START.md](../QUICK-START.md) (completo, inglés)
- [eu-ai-act-es.md](./eu-ai-act-es.md)  - Reglamento de IA
- [docs/README.md](../README.md)  - Índice de documentación
