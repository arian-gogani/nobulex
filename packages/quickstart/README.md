# @nobulex/quickstart

Zero-config 3-line integration for Nobulex. Define rules, enforce at runtime, verify with tamper-proof logs.

## Install

```bash
npm install @nobulex/quickstart
```

## Usage

```javascript
const { protect } = require('@nobulex/quickstart');
const agent = protect('permit read; forbid transfer where amount > 500; require log_all;');
const result = agent.check({ action: 'transfer', amount: 200 });
```

## Learn more

[nobulex.com](https://nobulex.com)
