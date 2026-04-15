/**
 * @nobulex/elizaos-plugin — ElizaOS plugin for covenant-governed AI agents.
 *
 * Provides actions, evaluators, providers, and plugin registration
 * for integrating Nobulex covenant enforcement into ElizaOS agents.
 *
 * @packageDocumentation
 */

import { parseSource, compile } from '@nobulex/covenant-lang';
import type { CovenantSpec, EnforcementFn, EnforcementDecision } from '@nobulex/covenant-lang';
import { ActionLogBuilder, verifyIntegrity } from '@nobulex/action-log';
import type { ActionLog, ActionLogEntry } from '@nobulex/action-log';
import { verify } from '@nobulex/verification';
import type { VerificationResult } from '@nobulex/verification';
import { sha256String, generateId, timestamp } from '@nobulex/crypto';

// ─── ElizaOS Plugin Types ────────────────────────────────────────────────────

/** ElizaOS action definition. */
export interface ElizaAction {
  readonly name: string;
  readonly description: string;
  readonly examples: readonly string[];
  readonly handler: (params: Record<string, unknown>) => Promise<ElizaActionResult>;
  readonly validate?: (params: Record<string, unknown>) => boolean;
}

/** Result of executing an ElizaOS action. */
export interface ElizaActionResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

/** ElizaOS evaluator definition. */
export interface ElizaEvaluator {
  readonly name: string;
  readonly description: string;
  readonly handler: (context: EvaluatorContext) => Promise<EvaluatorResult>;
}

/** Context passed to evaluators. */
export interface EvaluatorContext {
  readonly agentDid: string;
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly history: readonly ElizaActionResult[];
}

/** Result of running an evaluator. */
export interface EvaluatorResult {
  readonly passed: boolean;
  readonly score: number;
  readonly reason: string;
}

/** ElizaOS provider definition. */
export interface ElizaProvider {
  readonly name: string;
  readonly description: string;
  readonly get: () => Promise<unknown>;
}

/** Complete ElizaOS plugin definition. */
export interface ElizaPlugin {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly actions: readonly ElizaAction[];
  readonly evaluators: readonly ElizaEvaluator[];
  readonly providers: readonly ElizaProvider[];
}

// ---

/** Configuration for the covenant plugin. */
export interface CovenantPluginConfig {
  /** Agent DID identifier. */
  readonly agentDid: string;
  /** Covenant DSL source. */
  readonly covenantSource: string;
  /** Whether to log blocked actions. */
  readonly logBlocked?: boolean;
  /** Custom action handlers. */
  readonly handlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
}

/**
 * Covenant-governed agent runtime that manages enforcement and logging.
 * Wraps a compiled covenant specification and provides action execution,
 * enforcement checking, tamper-evident logging, and compliance verification.
 */
export class CovenantRuntime {
  readonly agentDid: string;
  readonly spec: CovenantSpec;
  private readonly _enforce: EnforcementFn;
  private readonly _logBuilder: ActionLogBuilder;
  private readonly _logBlocked: boolean;
  private readonly _handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  private _actionHistory: ElizaActionResult[] = [];

  /**
   * Create a new covenant runtime from the given plugin configuration.
   *
   * @param config - The covenant plugin configuration containing the agent DID, covenant source, and optional settings.
   */
  constructor(config: CovenantPluginConfig) {
    this.agentDid = config.agentDid;
    this.spec = parseSource(config.covenantSource);
    this._enforce = compile(this.spec);
    this._logBuilder = new ActionLogBuilder(config.agentDid);
    this._logBlocked = config.logBlocked ?? true;
    this._handlers = config.handlers ?? {};
  }

  /**
   * Check whether an action is permitted by the covenant without executing it.
   *
   * @param action - The name of the action to check.
   * @param params - Optional parameters for the action.
   * @returns The enforcement decision indicating whether the action is allowed or blocked.
   */
  check(action: string, params: Record<string, unknown> = {}): EnforcementDecision {
    return this._enforce({ action, params });
  }

  /**
   * Execute an action through covenant enforcement.
   * The action is first checked against the covenant; if blocked, a failure result is returned.
   * If allowed, the registered handler (if any) is invoked. All outcomes are logged.
   *
   * @param action - The name of the action to execute.
   * @param params - Optional parameters for the action.
   * @returns A promise that resolves to the {@link ElizaActionResult} with success/failure status.
   */
  async execute(
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<ElizaActionResult> {
    const decision = this._enforce({ action, params });

    if (decision.action === 'block') {
      const result: ElizaActionResult = {
        success: false,
        error: `Action "${action}" blocked by covenant: ${decision.reason}`,
      };
      this._actionHistory.push(result);
      if (this._logBlocked) {
        this._logBuilder.append({
          action,
          resource: action,
          params,
          outcome: 'blocked',
        });
      }
      return result;
    }

    // Execute the handler if registered
    const handler = this._handlers[action];
    let data: unknown;
    try {
      data = handler ? await handler(params) : undefined;
    } catch (err) {
      const result: ElizaActionResult = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this._actionHistory.push(result);
      this._logBuilder.append({
        action,
        resource: action,
        params,
        outcome: 'failure',
      });
      return result;
    }

    const result: ElizaActionResult = { success: true, data };
    this._actionHistory.push(result);
    this._logBuilder.append({
      action,
      resource: action,
      params,
      outcome: 'success',
    });
    return result;
  }

  /**
   * Get the tamper-evident action log containing all recorded actions.
   *
   * @returns The current {@link ActionLog}.
   */
  getLog(): ActionLog {
    return this._logBuilder.toLog();
  }

  /**
   * Verify the agent's compliance with its covenant by analyzing the action log.
   *
   * @returns The {@link VerificationResult} indicating compliance status and any violations.
   */
  verify(): VerificationResult {
    return verify(this.spec, this.getLog());
  }

  /** Get action history. */
  get history(): readonly ElizaActionResult[] {
    return this._actionHistory;
  }

  /** Number of actions processed. */
  get actionCount(): number {
    return this._actionHistory.length;
  }
}

// ---

/**
 * Create the "check-covenant" action.
 * Allows the agent to check if an action is permitted before executing it.
 *
 * @param runtime - The covenant runtime to check actions against.
 * @returns An {@link ElizaAction} that checks action permissions without executing them.
 */
export function createCheckAction(runtime: CovenantRuntime): ElizaAction {
  return {
    name: 'check-covenant',
    description: 'Check if an action is permitted by the covenant without executing it',
    examples: [
      'Is "read" permitted?',
      'Can I execute "transfer" with amount 500?',
    ],
    handler: async (params) => {
      const action = params.action as string;
      if (!action) {
        return { success: false, error: 'Missing "action" parameter' };
      }
      const decision = runtime.check(action, params);
      return { success: true, data: decision };
    },
    validate: (params) => typeof params.action === 'string',
  };
}

/**
 * Create the "execute-action" action.
 * Executes an action through covenant enforcement.
 *
 * @param runtime - The covenant runtime to execute actions through.
 * @returns An {@link ElizaAction} that enforces covenant rules before executing the action.
 */
export function createExecuteAction(runtime: CovenantRuntime): ElizaAction {
  return {
    name: 'execute-action',
    description: 'Execute an action through covenant enforcement',
    examples: [
      'Execute "read" action',
      'Run "transfer" with amount 100',
    ],
    handler: async (params) => {
      const action = params.action as string;
      if (!action) {
        return { success: false, error: 'Missing "action" parameter' };
      }
      return runtime.execute(action, params);
    },
    validate: (params) => typeof params.action === 'string',
  };
}

/**
 * Create the "verify-compliance" action.
 * Allows the agent to verify its own compliance with its covenant.
 *
 * @param runtime - The covenant runtime to verify compliance for.
 * @returns An {@link ElizaAction} that returns the current compliance verification result.
 */
export function createVerifyAction(runtime: CovenantRuntime): ElizaAction {
  return {
    name: 'verify-compliance',
    description: 'Verify the agent\'s compliance with its covenant',
    examples: [
      'Am I compliant?',
      'Check my covenant compliance',
    ],
    handler: async () => {
      const result = runtime.verify();
      return { success: true, data: result };
    },
  };
}

/**
 * Create the "get-action-log" action.
 * Retrieves the tamper-evident action log along with its integrity verification.
 *
 * @param runtime - The covenant runtime whose action log to retrieve.
 * @returns An {@link ElizaAction} that returns the action log and its integrity status.
 */
export function createLogAction(runtime: CovenantRuntime): ElizaAction {
  return {
    name: 'get-action-log',
    description: 'Get the tamper-evident action log',
    examples: [
      'Show my action log',
      'Get the audit trail',
    ],
    handler: async () => {
      const log = runtime.getLog();
      const integrity = verifyIntegrity(log);
      return { success: true, data: { log, integrity } };
    },
  };
}


/**
 * Create the "covenant-compliance" evaluator.
 * Evaluates whether the agent is complying with its covenant and returns a compliance score.
 *
 * @param runtime - The covenant runtime to evaluate compliance for.
 * @returns An {@link ElizaEvaluator} that scores the agent's covenant compliance from 0.0 to 1.0.
 */
export function createComplianceEvaluator(runtime: CovenantRuntime): ElizaEvaluator {
  return {
    name: 'covenant-compliance',
    description: 'Evaluate whether the agent is complying with its covenant',
    handler: async (context) => {
      const result = runtime.verify();
      const totalActions = runtime.actionCount;
      const score = totalActions > 0
        ? (totalActions - result.violations.length) / totalActions
        : 1.0;
      return {
        passed: result.compliant,
        score,
        reason: result.compliant
          ? 'Agent is compliant with covenant'
          : `${result.violations.length} violations found`,
      };
    },
  };
}

/**
 * Create the "action-permission" evaluator.
 * Pre-evaluates whether a proposed action would be allowed by the covenant.
 *
 * @param runtime - The covenant runtime to check permissions against.
 * @returns An {@link ElizaEvaluator} that scores 1.0 for allowed actions and 0.0 for blocked actions.
 */
export function createPermissionEvaluator(runtime: CovenantRuntime): ElizaEvaluator {
  return {
    name: 'action-permission',
    description: 'Evaluate whether a proposed action is permitted by the covenant',
    handler: async (context) => {
      const decision = runtime.check(context.action, context.params);
      return {
        passed: decision.action === 'allow',
        score: decision.action === 'allow' ? 1.0 : 0.0,
        reason: decision.reason,
      };
    },
  };
}

// ---

/**
 * Create the "covenant-spec" provider.
 * Exposes the agent's covenant specification to other ElizaOS components.
 *
 * @param runtime - The covenant runtime whose specification to provide.
 * @returns An {@link ElizaProvider} that returns the covenant specification.
 */
export function createSpecProvider(runtime: CovenantRuntime): ElizaProvider {
  return {
    name: 'covenant-spec',
    description: 'Provides the agent\'s covenant specification',
    get: async () => runtime.spec,
  };
}

/**
 * Create the "agent-status" provider.
 * Provides current agent status including DID, covenant name, action count, and compliance state.
 *
 * @param runtime - The covenant runtime whose status to provide.
 * @returns An {@link ElizaProvider} that returns the agent's current status summary.
 */
export function createStatusProvider(runtime: CovenantRuntime): ElizaProvider {
  return {
    name: 'agent-status',
    description: 'Provides current agent status including compliance and action count',
    get: async () => {
      const result = runtime.verify();
      return {
        agentDid: runtime.agentDid,
        covenantName: runtime.spec.name,
        actionCount: runtime.actionCount,
        compliant: result.compliant,
        violationCount: result.violations.length,
      };
    },
  };
}

// ---

/**
 * Create a complete ElizaOS plugin for covenant-governed agents.
 *
 * @example
 * ```typescript
 * const plugin = createCovenantPlugin({
 *   agentDid: 'did:nobulex:my-agent',
 *   covenantSource: `
 *     covenant MyAgent {
 *       permit read;
 *       permit write;
 *       forbid delete;
 *     }
 *   `,
 * });
 *
 * // Register with ElizaOS
 * agent.registerPlugin(plugin);
 * ```
 *
 * @param config - The covenant plugin configuration containing agent DID, covenant source, and optional settings.
 * @returns An {@link ElizaPlugin} with all built-in actions, evaluators, and providers, plus the underlying {@link CovenantRuntime}.
 */
export function createCovenantPlugin(config: CovenantPluginConfig): ElizaPlugin & { runtime: CovenantRuntime } {
  const runtime = new CovenantRuntime(config);

  return {
    name: '@nobulex/elizaos-plugin',
    version: '0.1.0',
    description: 'Covenant enforcement plugin for ElizaOS agents',
    actions: [
      createCheckAction(runtime),
      createExecuteAction(runtime),
      createVerifyAction(runtime),
      createLogAction(runtime),
    ],
    evaluators: [
      createComplianceEvaluator(runtime),
      createPermissionEvaluator(runtime),
    ],
    providers: [
      createSpecProvider(runtime),
      createStatusProvider(runtime),
    ],
    runtime,
  };
}
