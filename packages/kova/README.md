# Nobulex

**The trust layer for the agent economy.**

Nobulex is an open cryptographic protocol (MIT license) that enables AI agents to declare behavioral commitments, prove compliance, and build verifiable reputation across platforms. Single package, one import, 30-minute integration.

## Install

```bash
npm install kova
```

## Quick Start

```typescript
import { withKova } from 'kova';

const server = await withKova(yourMCPServer, 'data-isolation');
```

Three lines of code. Your MCP server is now wrapped with covenant enforcement.

## Presets

| Preset | Description |
|--------|-------------|
| `data-isolation` | Read-only data access, no writes, no network |
| `read-write` | Read/write to data and output, no network |
| `network` | Full network access with PII protection |
| `minimal` | Deny all; audit only |

## Advanced: 3 Primitives

For custom integrations, Nobulex re-exports the protocol primitives:

- **Identity Binding**: `createIdentity`, `evolveIdentity`
- **Covenant Declaration**: `buildCovenant`, `verifyCovenant`
- **Compliance Proof**: `generateComplianceProof`, `Monitor`

```typescript
import { createIdentity, buildCovenant, generateComplianceProof } from 'kova';
```

## License

MIT
