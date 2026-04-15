/**
 * @nobulex/quickstart — Zero-config entry point for covenant enforcement.
 *
 * Wraps identity, covenant-lang, and middleware into a single `protect()` call.
 *
 */

import { createMiddleware } from '@nobulex/middleware';
import type { EnforcementMiddleware, MiddlewareResult, ActionHandler, EnforcementDecision } from '@nobulex/middleware';
import type { CovenantSpec } from '@nobulex/covenant-lang';
import type { ActionLog } from '@nobulex/core-types';
import { sha256String } from '@nobulex/crypto';

export type { EnforcementDecision, CovenantSpec, ActionLog, MiddlewareResult };

/** Input to check() and execute() — action name plus flat parameters. */
export interface ActionInput {
  readonly action: string;
  readonly [key: string]: unknown;
}

/** A protected agent with covenant enforcement. */
export interface ProtectedAgent {
  /** Check whether an action would be allowed without executing it. */
  check(input: ActionInput): EnforcementDecision;
  /** Execute an action through enforcement — only runs handler if allowed. */
  execute<T>(input: ActionInput, handler: ActionHandler<T>): Promise<MiddlewareResult & { value?: T }>;
  /** The parsed covenant spec. */
  readonly spec: CovenantSpec;
  /** The action log of all executed/blocked actions. */
  readonly log: ActionLog;
}

/**
 * Transform simplified covenant syntax into full DSL.
 *
 * Conversions:
 * - `where <field> <op> <value>` → `(<field> <op> <value>)`
 * - `require log_all;` → stripped (middleware logs everything)
 * - Wraps in `covenant Quickstart { ... }`
 */
export function transformSyntax(source: string): string {
  let transformed = source;

  // Strip `require log_all;` directives
  transformed = transformed.replace(/require\s+log_all\s*;/g, '');

  // Replace `where <condition>;` → `(<condition>);`
  transformed = transformed.replace(
    /\bwhere\s+(.+?)\s*;/g,
    '($1);',
  );

  transformed = transformed.trim();

  // If already wrapped in `covenant ... { }`, pass through
  if (/^\s*covenant\s+/i.test(transformed)) {
    return transformed;
  }

  return `covenant Quickstart { ${transformed} }`;
}

/** Split flat ActionInput into { action, params } for the middleware. */
function toActionContext(input: ActionInput): { action: string; params: Record<string, unknown> } {
  const { action, ...params } = input;
  return { action, params };
}

/**
 * Create a protected agent from a covenant string.
 *
 * @param covenant - Simplified covenant DSL (e.g. `"permit read; forbid transfer where amount > 500;"`)
 * @returns A {@link ProtectedAgent} with `check()` and `execute()` methods.
 *
 * @example
 * ```typescript
 * const agent = protect('permit read; forbid transfer where amount > 500; require log_all;');
 * const result = agent.check({ action: 'transfer', amount: 200 });
 * ```
 */
export function protect(covenant: string): ProtectedAgent {
  const source = transformSyntax(covenant);
  const did = `did:nobulex:qs-${sha256String(covenant).slice(0, 16)}`;
  const mw: EnforcementMiddleware = createMiddleware(did, source);

  return {
    check(input: ActionInput): EnforcementDecision {
      return mw.check(toActionContext(input));
    },

    execute<T>(input: ActionInput, handler: ActionHandler<T>): Promise<MiddlewareResult & { value?: T }> {
      return mw.execute(toActionContext(input), handler);
    },

    get spec(): CovenantSpec {
      return mw.spec;
    },

    get log(): ActionLog {
      return mw.getLog();
    },
  };
}
