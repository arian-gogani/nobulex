# @nobulex/claude-agent-sdk

Compliance hook for Anthropic's Claude Agent SDK. Generates tamper-evident, hash-chained audit trails for every tool call made by Claude-powered agents.

## Install

```bash
npm install @nobulex/claude-agent-sdk @nobulex/core
```

## Usage

```typescript
import { createNobulexHooks } from '@nobulex/claude-agent-sdk';
import { createDID, parseSource } from '@nobulex/core';
import { query } from '@anthropic-ai/claude-agent-sdk';

const agent = await createDID();
const spec = parseSource('covenant MyAgent { permit read; forbid delete; }');
const hooks = createNobulexHooks({ agentDid: agent.did, spec });

for await (const msg of query({ prompt: 'List files', hooks })) {
  console.log(msg);
}

// Get tamper-evident audit trail
const log = hooks.getLog();

// Verify chain integrity
const { valid } = hooks.verifyChain();
```

## License

MIT
