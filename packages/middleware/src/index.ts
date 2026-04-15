/*
 * Enforcement middleware.
 *
 * Compiles a covenant into an enforcement function. Every action
 * goes through here before it runs — if the covenant says no,
 * the handler never executes.
 */

import { parseSource, compile } from '@nobulex/covenant-lang';
import type { CovenantSpec, EnforcementDecision, ActionContext, EnforcementFn } from '@nobulex/covenant-lang';
import { ActionLogBuilder } from '@nobulex/action-log';
import type { ActionLogEntry, ActionLog } from '@nobulex/core-types';

export type { CovenantSpec, EnforcementDecision, ActionContext, EnforcementFn } from '@nobulex/covenant-lang';
export type { ActionLog, ActionLogEntry } from '@nobulex/core-types';

/** Result of executing an action through the middleware. */
export interface MiddlewareResult {
  readonly decision: EnforcementDecision;
  readonly entry: ActionLogEntry;
  readonly executed: boolean;
}

/** Handler function that performs the actual action. */
export type ActionHandler<T = unknown> = (ctx: ActionContext) => T | Promise<T>;

export interface EnforcementMiddlewareConfig {
  readonly agentDid: string;
  readonly spec: CovenantSpec;
  readonly onBlock?: (decision: EnforcementDecision, ctx: ActionContext) => void;
  readonly onAllow?: (decision: EnforcementDecision, ctx: ActionContext) => void;
}

/**
 * Enforcement middleware that wraps action handlers.
 *
 * @example
 * ```typescript
 * const mw = new EnforcementMiddleware({
 *   agentDid: 'did:nobulex:agent-1',
 *   spec: parseSource('covenant Safe { permit read; forbid write; }'),
 * });
 *
 * const result = await mw.execute(
 *   { action: 'read', params: {} },
 *   (ctx) => 'data from read'
 * );
 * console.log(result.executed); // true
 * console.log(result.decision.action); // 'allow'
 *
 * const blocked = await mw.execute(
 *   { action: 'write', params: {} },
 *   (ctx) => 'should not run'
 * );
 * console.log(blocked.executed); // false
 * console.log(blocked.decision.action); // 'block'
 * ```
 */
export class EnforcementMiddleware {
  private readonly _enforce: EnforcementFn;
  private readonly _logBuilder: ActionLogBuilder;
  private readonly _spec: CovenantSpec;
  private readonly _onBlock?: (decision: EnforcementDecision, ctx: ActionContext) => void;
  private readonly _onAllow?: (decision: EnforcementDecision, ctx: ActionContext) => void;

  /**
   * Create a new EnforcementMiddleware instance.
   *
   * @param config - The middleware configuration including agent DID, covenant spec, and optional callbacks.
   */
  constructor(config: EnforcementMiddlewareConfig) {
    this._spec = config.spec;
    this._enforce = compile(config.spec);
    // must match the schema in core-types
    this._logBuilder = new ActionLogBuilder(config.agentDid);
    this._onBlock = config.onBlock;
    this._onAllow = config.onAllow;
  }

  /** The covenant spec this middleware enforces. */
  get spec(): CovenantSpec {
    return this._spec;
  }

  get actionCount(): number {
    return this._logBuilder.length;
  }

  /**
   * Execute an action through the enforcement middleware.
   *
   * 1. Evaluate the action against the covenant spec.
   * 2. If blocked, log as 'blocked' and do NOT call the handler.
   * 3. If allowed, call the handler, log outcome based on success/failure.
   *
   * @param ctx - The action context describing the action and its parameters.
   * @param handler - The handler function to invoke if the action is allowed.
   * @returns A promise resolving to the middleware result, including the handler's return value if executed.
   */
  async execute<T>(
    ctx: ActionContext,
    handler: ActionHandler<T>,
  ): Promise<MiddlewareResult & { value?: T }> {
    const decision = this._enforce(ctx);

    if (decision.action === 'block') {
      this._onBlock?.(decision, ctx);
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'blocked',
      });
      return { decision, entry, executed: false };
    }

    this._onAllow?.(decision, ctx);

    try {
      const value = await handler(ctx);
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'success',
      });
      return { decision, entry, executed: true, value };
    } catch (error) {
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'failure',
      });
      throw Object.assign(error as Error, { middlewareResult: { decision, entry, executed: true } });
    }
  }

  /**
   * Check whether an action would be allowed without executing it.
   *
   * @param ctx - The action context to evaluate against the covenant spec.
   * @returns The enforcement decision indicating whether the action would be allowed or blocked.
   */
  check(ctx: ActionContext): EnforcementDecision {
    // yes, this allocates, but the hot path is still the hash below
    return this._enforce(ctx);
  }

  // Get the full action log
  getLog(): ActionLog {
    return this._logBuilder.toLog();
  }

  // Get the raw log builder for advanced operations
  getLogBuilder(): ActionLogBuilder {
    return this._logBuilder;
  }
}

/**
 * Create an enforcement middleware from DSL source text.
 *
 * @param agentDid - The decentralized identifier of the agent to associate with the middleware.
 * @param source - The covenant DSL source text to parse and enforce.
 * @returns A new EnforcementMiddleware instance configured with the parsed covenant spec.
 *
 * @example
 * ```typescript
 * const mw = createMiddleware(
 *   'did:nobulex:agent-1',
 *   `covenant Safe {
 *     permit read;
 *     forbid delete;
 *   }`
 * );
 * ```
 */
export function createMiddleware(agentDid: string, source: string): EnforcementMiddleware {
  return new EnforcementMiddleware({
    agentDid,
    spec: parseSource(source),
  });
}

/**
 * Create an enforcement function from DSL source text (no logging).
 *
 * @param source - The covenant DSL source text to parse and compile.
 * @returns A stateless enforcement function that evaluates action contexts against the compiled covenant.
 *
 * @example
 * ```typescript
 * const enforce = compileSource(`covenant X { forbid transfer (amount > 500); permit transfer; }`);
 * const decision = enforce({ action: 'transfer', params: { amount: 600 } });
 * ```
 */
export function compileSource(source: string): EnforcementFn {
  return compile(parseSource(source));
}
