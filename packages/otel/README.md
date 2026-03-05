# @nobulex/otel

OpenTelemetry SpanProcessor that generates evidence items from OTel spans.

## Install

```bash
npm install @nobulex/otel
```

## Usage

```typescript
import { NobulexSpanProcessor } from "@nobulex/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new NobulexSpanProcessor(covenant));
```

## Learn More

[nobulex.com](https://nobulex.com)
