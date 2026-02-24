# @nobulex/middleware

Pre-execution covenant enforcement middleware. Compiles a `CovenantSpec` into an enforcement function that intercepts actions before they execute, blocking forbidden ones and logging all decisions to an `ActionLog`.

## Installation

```bash
npm install @nobulex/middleware
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/covenant-lang`, `@nobulex/action-log`

## Quick Usage

```typescript
import { createMiddleware } from '@nobulex/middleware';

const mw = createMiddleware(
  'did:nobulex:agent-1',
  `covenant Safe {
    permit read;
    forbid delete;
  }`
);

// Allowed action
const result = await mw.execute(
  { action: 'read', params: {} },
  (ctx) => fetchData(ctx),
);
console.log(result.executed);       // true
console.log(result.decision.action); // 'allow'

// Blocked action -- handler is NOT called
const blocked = await mw.execute(
  { action: 'delete', params: {} },
  (ctx) => deleteData(ctx),
);
console.log(blocked.executed);       // false
console.log(blocked.decision.action); // 'block'

// Get the full action log
const log = mw.getLog();
console.log(log.length); // 2
```

## API Reference

### Classes

#### `EnforcementMiddleware`

The main middleware class that wraps action handlers with covenant enforcement.

```typescript
import { EnforcementMiddleware } from '@nobulex/middleware';
import { parseSource } from '@nobulex/covenant-lang';

const mw = new EnforcementMiddleware({
  agentDid: 'did:nobulex:agent-1',
  spec: parseSource('covenant Safe { permit read; forbid write; }'),
  onBlock: (decision, ctx) => console.log('Blocked:', ctx.action),
  onAllow: (decision, ctx) => console.log('Allowed:', ctx.action),
});
```

**Constructor:** `new EnforcementMiddleware(config: EnforcementMiddlewareConfig)`

**Properties:**

| Property      | Type           | Description                           |
| ------------- | -------------- | ------------------------------------- |
| `spec`        | `CovenantSpec` | The covenant spec being enforced      |
| `actionCount` | `number`       | Number of actions processed so far    |

**Methods:**

##### `execute<T>(ctx: ActionContext, handler: ActionHandler<T>): Promise<MiddlewareResult & { value?: T }>`

Execute an action through the enforcement middleware.

1. Evaluates the action against the covenant spec.
2. If blocked: logs as `'blocked'`, does NOT call the handler.
3. If allowed: calls the handler, logs outcome (`'success'` or `'failure'`).

```typescript
const result = await mw.execute(
  { action: 'read', params: { resource: '/data' } },
  async (ctx) => { return 'data'; },
);
```

##### `check(ctx: ActionContext): EnforcementDecision`

Check whether an action would be allowed without executing it.

```typescript
const decision = mw.check({ action: 'delete', params: {} });
console.log(decision.action); // 'block'
```

##### `getLog(): ActionLog`

Get the full action log of all processed actions.

##### `getLogBuilder(): ActionLogBuilder`

Get the raw `ActionLogBuilder` for advanced operations.

### Functions

#### `createMiddleware(agentDid: string, source: string): EnforcementMiddleware`

Create an `EnforcementMiddleware` from DSL source text.

```typescript
const mw = createMiddleware(
  'did:nobulex:agent-1',
  `covenant MyAgent {
    permit read;
    forbid delete;
  }`
);
```

#### `compileSource(source: string): EnforcementFn`

Create a standalone enforcement function from DSL source text. No logging -- just evaluates actions.

```typescript
import { compileSource } from '@nobulex/middleware';

const enforce = compileSource('covenant X { forbid transfer (amount > 500); permit transfer; }');
const decision = enforce({ action: 'transfer', params: { amount: 600 } });
console.log(decision.action); // 'block'
```

### Interfaces

#### `MiddlewareResult`

Result of executing an action through the middleware.

| Field      | Type                  | Description                              |
| ---------- | --------------------- | ---------------------------------------- |
| `decision` | `EnforcementDecision` | The enforcement decision                 |
| `entry`    | `ActionLogEntry`      | The action log entry created             |
| `executed` | `boolean`             | Whether the handler was actually called  |

#### `EnforcementMiddlewareConfig`

Configuration for the enforcement middleware.

| Field      | Type           | Description                            |
| ---------- | -------------- | -------------------------------------- |
| `agentDid` | `string`       | The agent's DID                        |
| `spec`     | `CovenantSpec` | The covenant spec to enforce           |
| `onBlock`  | `function`     | Optional callback when action blocked  |
| `onAllow`  | `function`     | Optional callback when action allowed  |

### Type Aliases

#### `ActionHandler<T>`

```typescript
type ActionHandler<T = unknown> = (ctx: ActionContext) => T | Promise<T>;
```

### Re-exported Types

From `@nobulex/covenant-lang`:
- `CovenantSpec`
- `EnforcementDecision`
- `ActionContext`
- `EnforcementFn`

From `@nobulex/core-types`:
- `ActionLog`
- `ActionLogEntry`

## Error Handling

If the handler throws an error, the middleware:
1. Logs the action with outcome `'failure'`
2. Re-throws the error with a `middlewareResult` property attached

```typescript
try {
  await mw.execute({ action: 'write', params: {} }, () => {
    throw new Error('disk full');
  });
} catch (err) {
  console.log(err.middlewareResult.decision.action); // 'allow'
  console.log(err.middlewareResult.entry.outcome);   // 'failure'
}
```

## License

MIT
