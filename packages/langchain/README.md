# @nobulex/langchain

LangChain integration — cryptographic audit trails for AI agents with EU AI Act compliance.

## Install

```bash
npm install @nobulex/langchain
```

## Usage

```typescript
import { NobulexCallbackHandler } from "@nobulex/langchain";

const handler = new NobulexCallbackHandler(covenant);
const chain = new LLMChain({ callbacks: [handler] });
```

## Learn More

[nobulex.com](https://nobulex.com)
