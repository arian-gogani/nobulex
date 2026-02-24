# @nobulex/elizaos-plugin

ElizaOS plugin for covenant-governed AI agents. Provides actions, evaluators, providers, and plugin registration for integrating Nobulex covenant enforcement into ElizaOS agents.

## Installation

```bash
npm install @nobulex/elizaos-plugin
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/crypto`, `@nobulex/identity`, `@nobulex/covenant-lang`, `@nobulex/action-log`, `@nobulex/middleware`, `@nobulex/verification`

## Quick Usage

```typescript
import { createCovenantPlugin } from '@nobulex/elizaos-plugin';

const plugin = createCovenantPlugin({
  agentDid: 'did:nobulex:my-agent',
  covenantSource: `
    covenant MyAgent {
      permit read;
      permit write;
      forbid delete;
    }
  `,
  handlers: {
    read: async (params) => ({ data: 'some data' }),
    write: async (params) => ({ written: true }),
  },
});

// Register with ElizaOS
agent.registerPlugin(plugin);

// Or use the runtime directly
const { runtime } = plugin;

const result = await runtime.execute('read', { resource: '/data' });
console.log(result.success); // true

const blocked = await runtime.execute('delete', { resource: '/data' });
console.log(blocked.success); // false
console.log(blocked.error);   // 'Action "delete" blocked by covenant: ...'

// Verify compliance
const verification = runtime.verify();
console.log(verification.compliant); // true
```

## API Reference

### Plugin Factory

#### `createCovenantPlugin(config: CovenantPluginConfig): ElizaPlugin & { runtime: CovenantRuntime }`

Create a complete ElizaOS plugin with all built-in actions, evaluators, and providers. Returns both the plugin definition (for registering with ElizaOS) and the underlying `CovenantRuntime` for direct access.

The plugin includes:

**Actions:**
- `check-covenant` -- Check if an action is permitted without executing it
- `execute-action` -- Execute an action through covenant enforcement
- `verify-compliance` -- Verify the agent's compliance with its covenant
- `get-action-log` -- Get the tamper-evident action log

**Evaluators:**
- `covenant-compliance` -- Evaluate whether the agent is complying with its covenant
- `action-permission` -- Pre-evaluate whether a proposed action would be allowed

**Providers:**
- `covenant-spec` -- Provides the agent's covenant specification
- `agent-status` -- Provides current agent status including compliance and action count

### Classes

#### `CovenantRuntime`

Covenant-governed agent runtime that manages enforcement and logging.

```typescript
import { CovenantRuntime } from '@nobulex/elizaos-plugin';

const runtime = new CovenantRuntime({
  agentDid: 'did:nobulex:agent-1',
  covenantSource: 'covenant Safe { permit read; forbid delete; }',
  logBlocked: true,
  handlers: {
    read: async (params) => fetchData(params),
  },
});
```

**Properties:**

| Property      | Type                         | Description                    |
| ------------- | ---------------------------- | ------------------------------ |
| `agentDid`    | `string`                     | The agent's DID                |
| `spec`        | `CovenantSpec`               | Parsed covenant specification  |
| `history`     | `readonly ElizaActionResult[]` | All action results           |
| `actionCount` | `number`                     | Total actions processed        |

**Methods:**

##### `check(action: string, params?: Record<string, unknown>): EnforcementDecision`

Check whether an action is permitted without executing it.

```typescript
const decision = runtime.check('delete');
console.log(decision.action); // 'block'
```

##### `execute(action: string, params?: Record<string, unknown>): Promise<ElizaActionResult>`

Execute an action through covenant enforcement. If a handler is registered for the action, it will be called. Blocked actions return `{ success: false, error: '...' }`.

```typescript
const result = await runtime.execute('read', { resource: '/data' });
console.log(result.success); // true
console.log(result.data);    // handler's return value
```

##### `getLog(): ActionLog`

Get the action log with all recorded actions.

##### `verify(): VerificationResult`

Verify compliance of the action log against the covenant.

### Action Factory Functions

Each function takes a `CovenantRuntime` and returns an `ElizaAction`:

#### `createCheckAction(runtime: CovenantRuntime): ElizaAction`

Creates the `check-covenant` action. Requires an `action` parameter.

#### `createExecuteAction(runtime: CovenantRuntime): ElizaAction`

Creates the `execute-action` action. Requires an `action` parameter.

#### `createVerifyAction(runtime: CovenantRuntime): ElizaAction`

Creates the `verify-compliance` action. No parameters required.

#### `createLogAction(runtime: CovenantRuntime): ElizaAction`

Creates the `get-action-log` action. Returns the log and its integrity status.

### Evaluator Factory Functions

#### `createComplianceEvaluator(runtime: CovenantRuntime): ElizaEvaluator`

Creates the `covenant-compliance` evaluator. Returns a score based on the ratio of compliant actions to total actions.

#### `createPermissionEvaluator(runtime: CovenantRuntime): ElizaEvaluator`

Creates the `action-permission` evaluator. Pre-evaluates whether a proposed action would be allowed (score 1.0 for allowed, 0.0 for blocked).

### Provider Factory Functions

#### `createSpecProvider(runtime: CovenantRuntime): ElizaProvider`

Creates the `covenant-spec` provider. Returns the covenant specification.

#### `createStatusProvider(runtime: CovenantRuntime): ElizaProvider`

Creates the `agent-status` provider. Returns agent DID, covenant name, action count, compliance status, and violation count.

### Interfaces

#### `CovenantPluginConfig`

| Field            | Type                    | Default | Description                      |
| ---------------- | ----------------------- | ------- | -------------------------------- |
| `agentDid`       | `string`                | --      | Agent DID identifier             |
| `covenantSource` | `string`                | --      | Covenant DSL source text         |
| `logBlocked`     | `boolean`               | `true`  | Whether to log blocked actions   |
| `handlers`       | `Record<string, fn>`    | `{}`    | Custom action handlers           |

#### `ElizaPlugin`

| Field        | Type                       | Description                |
| ------------ | -------------------------- | -------------------------- |
| `name`       | `string`                   | Plugin name                |
| `version`    | `string`                   | Plugin version             |
| `description`| `string`                   | Plugin description         |
| `actions`    | `readonly ElizaAction[]`   | Registered actions         |
| `evaluators` | `readonly ElizaEvaluator[]`| Registered evaluators      |
| `providers`  | `readonly ElizaProvider[]` | Registered providers       |

#### `ElizaAction`

| Field       | Type       | Description                          |
| ----------- | ---------- | ------------------------------------ |
| `name`      | `string`   | Action name                          |
| `description` | `string` | Human-readable description           |
| `examples`  | `readonly string[]` | Example prompts                |
| `handler`   | `function` | Action handler                       |
| `validate`  | `function` | Optional parameter validator         |

#### `ElizaActionResult`

| Field     | Type      | Description                    |
| --------- | --------- | ------------------------------ |
| `success` | `boolean` | Whether the action succeeded   |
| `data`    | `unknown` | Return data (if successful)    |
| `error`   | `string`  | Error message (if failed)      |

#### `ElizaEvaluator`

| Field       | Type       | Description            |
| ----------- | ---------- | ---------------------- |
| `name`      | `string`   | Evaluator name         |
| `description` | `string` | Description            |
| `handler`   | `function` | Evaluation function    |

#### `EvaluatorContext`

| Field     | Type                         | Description              |
| --------- | ---------------------------- | ------------------------ |
| `agentDid`| `string`                     | Agent's DID              |
| `action`  | `string`                     | Action being evaluated   |
| `params`  | `Record<string, unknown>`    | Action parameters        |
| `history` | `readonly ElizaActionResult[]`| Previous action results |

#### `EvaluatorResult`

| Field    | Type      | Description                 |
| -------- | --------- | --------------------------- |
| `passed` | `boolean` | Whether evaluation passed   |
| `score`  | `number`  | Score from 0.0 to 1.0      |
| `reason` | `string`  | Explanation                 |

#### `ElizaProvider`

| Field       | Type       | Description            |
| ----------- | ---------- | ---------------------- |
| `name`      | `string`   | Provider name          |
| `description` | `string` | Description            |
| `get`       | `function` | Data retrieval function|

## License

MIT
