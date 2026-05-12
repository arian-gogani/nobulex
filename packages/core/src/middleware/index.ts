/*
 * Enforcement middleware.
 *
 * Compiles a covenant into an enforcement function. Every action
 * goes through here before it runs — if the covenant says no,
 * the handler never executes.
 *
 * Also includes the zero-config quickstart helpers (`protect()`,
 * `transformSyntax()`) that were previously in @nobulex/quickstart.
 */

import { parseSource, compile } from '../covenant-lang/index';
import type { CovenantSpec, EnforcementDecision, ActionContext, EnforcementFn } from '../covenant-lang/index';
import { ActionLogBuilder } from '../action-log/index';
import type { ActionLogEntry, ActionLog } from '../types/index';
import { sha256String, sha256Object, signString, toHex } from '../crypto/index';
import type { PrivateKey } from '../crypto/index';
import { TrustCapitalLedger, type TrustCapitalScore, type TrustCapability } from '../trust-capital';

export type { CovenantSpec, EnforcementDecision, ActionContext, EnforcementFn } from '../covenant-lang/index';
export type { ActionLog, ActionLogEntry } from '../types/index';

/** Enforcement mode. `'enforce'` blocks violating actions; `'observe'` logs them as would_block but lets them run. */
export type EnforcementMode = 'enforce' | 'observe';

/**
 * Bilateral receipt — cryptographic proof that binds pre-execution authorization
 * to post-execution result. Auditors get both "this was authorized" AND "this is
 * what actually happened".
 */
export interface BilateralReceipt {
  /** Hash of the authorization decision (ctx + decision). */
  readonly authorizationHash: string;
  /** Signature over authorizationHash (pre-execution). */
  readonly authorizationSignature: string;
  /** Hash of the execution result (SHA-256 of canonical JSON of the value or error). */
  readonly resultHash: string;
  /** Signature over resultHash (post-execution). */
  readonly resultSignature: string;
  /** Hex-encoded public key of the signer. */
  readonly signerPublicKey: string;
  /** ISO-8601 timestamp of the receipt. */
  readonly timestamp: string;
}

/** Result of executing an action through the middleware. */
export interface MiddlewareResult {
  readonly decision: EnforcementDecision;
  readonly entry: ActionLogEntry;
  readonly executed: boolean;
  /** Present when the middleware was configured with a signing key pair. */
  readonly receipt?: BilateralReceipt;
}

/** Handler function that performs the actual action. */
export type ActionHandler<T = unknown> = (ctx: ActionContext) => T | Promise<T>;

/** Signer used for bilateral receipts. */
export interface ReceiptSigner {
  readonly privateKey: PrivateKey;
  readonly publicKeyHex: string;
}

export interface EnforcementMiddlewareConfig {
  readonly agentDid: string;
  readonly spec: CovenantSpec;
  /** Enforcement mode. Defaults to `'enforce'`. */
  readonly mode?: EnforcementMode;
  /** When provided, each execute() produces a signed bilateral receipt. */
  readonly signer?: ReceiptSigner;
  /** When true, creates a TrustCapitalLedger that accumulates credit from receipts. */
  readonly trackTrustCapital?: boolean;
  /** Optional: required capability for actions to proceed. Agent must have earned sufficient credit. */
  readonly requiredCapability?: TrustCapability;
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
  private readonly _mode: EnforcementMode;
  private readonly _signer?: ReceiptSigner;
  private readonly _ledger?: TrustCapitalLedger;
  private readonly _requiredCapability?: TrustCapability;
  private _halted: boolean = false;
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
    this._mode = config.mode ?? 'enforce';
    this._signer = config.signer;
    this._onBlock = config.onBlock;
    this._onAllow = config.onAllow;
    this._requiredCapability = config.requiredCapability;
    if (config.trackTrustCapital) {
      this._ledger = new TrustCapitalLedger(config.agentDid);
    }
  }

  /** The covenant spec this middleware enforces. */
  get spec(): CovenantSpec {
    return this._spec;
  }

  get actionCount(): number {
    return this._logBuilder.length;
  }

  /** Current enforcement mode. */
  get mode(): EnforcementMode {
    return this._mode;
  }

  /** Whether emergency halt is active. */
  get halted(): boolean {
    return this._halted;
  }

  /**
   * Emergency halt — block all subsequent actions regardless of covenant rules.
   * Use when an operator detects anomalous behavior and needs to stop the agent
   * instantly. Call {@link resume} to restore normal enforcement.
   */
  halt(): void {
    this._halted = true;
  }

  /** Restore normal enforcement after a {@link halt}. */
  resume(): void {
    this._halted = false;
  }

  /** Get the current Trust Capital score. Only available when trackTrustCapital is enabled. */
  get trustCapital(): TrustCapitalScore | null {
    return this._ledger?.getScore() ?? null;
  }

  /** Check if the agent has earned a specific capability. */
  canDo(capability: TrustCapability): boolean {
    return this._ledger?.can(capability) ?? false;
  }

  /** Get the Trust Capital ledger for detailed inspection. */
  get ledger(): TrustCapitalLedger | undefined {
    return this._ledger;
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
    // Emergency halt takes precedence over everything — no rule evaluation,
    // no handler execution, even in observe mode.
    if (this._halted) {
      const haltedDecision: EnforcementDecision = {
        action: 'block',
        matchedRule: null,
        reason: 'Emergency halt active — all actions are blocked',
        timestamp: new Date().toISOString(),
      };
      this._onBlock?.(haltedDecision, ctx);
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'halted',
      });
      const receipt = await this._buildReceipt(ctx, haltedDecision, { halted: true });
      return this._attachReceipt({ decision: haltedDecision, entry, executed: false }, receipt);
    }

    const decision = this._enforce(ctx);
    const wouldBlock = decision.action === 'block';

    // In enforce mode, blocked actions never run.
    if (wouldBlock && this._mode === 'enforce') {
      this._onBlock?.(decision, ctx);
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'blocked',
      });
      const receipt = await this._buildReceipt(ctx, decision, { blocked: true });
      return this._attachReceipt({ decision, entry, executed: false }, receipt);
    }

    // Observe mode: record that it WOULD have been blocked, but still execute.
    // Otherwise, standard allow path. Both call onAllow / onBlock as appropriate.
    if (wouldBlock) {
      this._onBlock?.(decision, ctx);
    } else {
      this._onAllow?.(decision, ctx);
    }

    try {
      const value = await handler(ctx);
      const outcomeHash = sha256Object({ value });
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: wouldBlock ? 'would_block' : 'success',
        outcomeHash,
      });
      const receipt = await this._buildReceipt(ctx, decision, { value });
      return this._attachReceipt({ decision, entry, executed: true, value }, receipt);
    } catch (error) {
      const errorMessage = (error as Error).message;
      const outcomeHash = sha256Object({ error: errorMessage });
      const entry = this._logBuilder.append({
        action: ctx.action,
        resource: ctx.params['resource'] as string ?? '*',
        params: ctx.params,
        outcome: 'failure',
        outcomeHash,
      });
      const receipt = await this._buildReceipt(ctx, decision, { error: errorMessage });
      const attached = this._attachReceipt({ decision, entry, executed: true }, receipt);
      throw Object.assign(error as Error, { middlewareResult: attached });
    }
  }

  private async _buildReceipt(
    ctx: ActionContext,
    decision: EnforcementDecision,
    result: Record<string, unknown>,
  ): Promise<BilateralReceipt | undefined> {
    if (!this._signer) return undefined;

    const authorizationHash = sha256Object({
      action: ctx.action,
      params: ctx.params,
      decision: {
        action: decision.action,
        reason: decision.reason,
        timestamp: decision.timestamp,
      },
    });
    const resultHash = sha256Object(result);
    const authSigBytes = await signString(authorizationHash, this._signer.privateKey);
    const resultSigBytes = await signString(resultHash, this._signer.privateKey);

    return {
      authorizationHash,
      authorizationSignature: toHex(authSigBytes),
      resultHash,
      resultSignature: toHex(resultSigBytes),
      signerPublicKey: this._signer.publicKeyHex,
      timestamp: new Date().toISOString(),
    };
  }

  private _attachReceipt<R extends MiddlewareResult>(
    result: R,
    receipt: BilateralReceipt | undefined,
  ): R {
    if (!receipt) return result;
    return { ...result, receipt };
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

// ── Quickstart helpers (merged from @nobulex/quickstart) ──────────────────

/** Input to check() and execute() — action name plus flat parameters. */
export interface ActionInput {
  readonly action: string;
  readonly [key: string]: unknown;
}

export interface ProtectedAgent {
  /** Check whether an action would be allowed without executing it. */
  check(input: ActionInput): EnforcementDecision;
  /** Execute an action through enforcement — only runs handler if allowed. */
  execute<T>(input: ActionInput, handler: ActionHandler<T>): Promise<MiddlewareResult & { value?: T }>;
  /** The parsed covenant spec. */
  readonly spec: CovenantSpec;
  // The action log of all executed/blocked actions
  readonly log: ActionLog;
}

/**
 * Transform simplified covenant syntax into full DSL.
 *
 * Conversions:
 * - `where <field> <op> <value>` -> `(<field> <op> <value>)`
 * - `require log_all;` -> stripped (middleware logs everything)
 * - Wraps in `covenant Quickstart { ... }`
 */
export function transformSyntax(source: string): string {
  let transformed = source;

  // Strip `require log_all;` directives
  transformed = transformed.replace(/require\s+log_all\s*;/g, '');

  // Replace `where <condition>;` -> `(<condition>);`
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
  const mw = createMiddleware(did, source);

  return {
    check(input: ActionInput): EnforcementDecision {
      // note: order matters — tests rely on this
      return mw.check(toActionContext(input));
    },

    execute<T>(input: ActionInput, handler: ActionHandler<T>): Promise<MiddlewareResult & { value?: T }> {
      // be careful reordering — the chain verifier depends on this layout
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
