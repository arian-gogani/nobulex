# @nobulex/covenant-lang

Cedar-inspired DSL for behavioral specifications. Provides a complete pipeline from source text to enforcement function: **source -> tokens -> AST -> enforcement function**.

The covenant language lets you define what an AI agent is permitted and forbidden to do, with optional conditions and requirements.

## Installation

```bash
npm install @nobulex/covenant-lang
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`

## Quick Usage

```typescript
import { tokenize, parse, compile, parseSource } from '@nobulex/covenant-lang';

// Full pipeline: source -> tokens -> AST -> enforcement function
const source = `
  covenant SafeTransfer {
    forbid transfer (amount > 500);
    permit api_call;
    require counterparty.compliance_score >= 0.9;
  }
`;

const tokens = tokenize(source);
const spec = parse(tokens);
const enforce = compile(spec);

const decision = enforce({ action: 'transfer', params: { amount: 600 } });
console.log(decision.action); // 'block'

// Or use the convenience function:
const spec2 = parseSource(source);
```

## DSL Syntax

```
covenant <Name> {
  permit <action>;
  permit <action> (<field> <op> <value>);
  forbid <action>;
  forbid <action> (<field> <op> <value>);
  require <field> <op> <value>;
}
```

**Effects:** `permit`, `forbid`

**Operators:** `>`, `<`, `>=`, `<=`, `==`, `!=`

**Values:** strings (quoted), numbers, booleans

### Example

```
covenant DataGuard {
  permit read;
  permit write (size <= 1048576);
  forbid delete;
  forbid transfer (amount > 10000);
  require caller.trust_score >= 0.8;
}
```

## API Reference

### Functions

#### `tokenize(source: string): Token[]`

Lexes source text into a stream of tokens. Throws `LexerError` on invalid input.

```typescript
import { tokenize } from '@nobulex/covenant-lang';

const tokens = tokenize('covenant Foo { permit read; }');
// Returns array of Token objects
```

#### `parse(tokens: Token[]): CovenantSpec`

Parses a token stream into a `CovenantSpec` AST. Throws `ParseError` on invalid grammar.

```typescript
import { tokenize, parse } from '@nobulex/covenant-lang';

const spec = parse(tokenize('covenant Foo { permit read; forbid write; }'));
console.log(spec.name);       // 'Foo'
console.log(spec.statements); // [{effect:'permit', action:'read', ...}, ...]
```

#### `compile(spec: CovenantSpec): EnforcementFn`

Compiles a `CovenantSpec` into an enforcement function. The function evaluates an `ActionContext` and returns an `EnforcementDecision`.

```typescript
import { parseSource, compile } from '@nobulex/covenant-lang';

const enforce = compile(parseSource('covenant X { forbid delete; permit read; }'));
const decision = enforce({ action: 'delete', params: {} });
console.log(decision.action); // 'block'
```

#### `serialize(spec: CovenantSpec): string`

Serializes a `CovenantSpec` back to DSL source text.

```typescript
import { parseSource, serialize } from '@nobulex/covenant-lang';

const spec = parseSource('covenant Foo { permit read; }');
const source = serialize(spec);
// 'covenant Foo {\n  permit read;\n}'
```

#### `parseSource(source: string): CovenantSpec`

Convenience function that combines `tokenize` and `parse` in one call.

```typescript
import { parseSource } from '@nobulex/covenant-lang';

const spec = parseSource('covenant MyAgent { permit read; forbid delete; }');
```

### Classes

#### `LexerError`

Thrown when the lexer encounters invalid input.

#### `ParseError`

Thrown when the parser encounters invalid grammar.

### Types

#### `Token`

A single lexer token.

| Field    | Type        | Description                |
| -------- | ----------- | -------------------------- |
| `type`   | `TokenType` | The token classification   |
| `value`  | `string`    | The raw token text         |

#### `TokenType`

Enum of all token types: keywords (`covenant`, `permit`, `forbid`, `require`), operators, literals, punctuation, and EOF.

#### `ActionContext`

Input to an enforcement function.

| Field    | Type                      | Description            |
| -------- | ------------------------- | ---------------------- |
| `action` | `string`                  | The action name        |
| `params` | `Record<string, unknown>` | Action parameters      |

#### `EnforcementFn`

```typescript
type EnforcementFn = (ctx: ActionContext) => EnforcementDecision;
```

### Re-exported Types (from `@nobulex/core-types`)

- `CovenantSpec`
- `CovenantStatement`
- `CovenantCondition`
- `CovenantRequirement`
- `CovenantEffect`
- `ComparisonOperator`
- `EnforcementDecision`

## License

MIT
