/**
 * Stele adapter for LangChain.
 *
 * Provides a callback handler that logs agent actions to the Stele
 * audit trail, and tool/chain wrappers that enforce covenant constraints
 * before execution.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { SteleClient, SteleCallbackHandler, withSteleTool } from '@stele/sdk';
 *
 * const handler = new SteleCallbackHandler({ client, covenant });
 * const protectedTool = withSteleTool(myTool, { client, covenant });
 * ```
 */

import type { SteleClient } from '../index.js';
import type { CovenantDocument } from '@stele/core';
import type { EvaluationResult } from '../types.js';
import { SteleAccessDeniedError } from './vercel-ai.js';

// Re-export the shared error so consumers can import from either adapter
export { SteleAccessDeniedError } from './vercel-ai.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal tool shape compatible with LangChain's BaseTool.
 *
 * Supports the three method patterns found in the LangChain ecosystem:
 * - `call(input)` -- the public API in LangChain JS
 * - `invoke(input)` -- the LCEL (LangChain Expression Language) API
 * - `_call(input)` -- the internal/protected implementation method
 */
export interface LangChainToolLike {
  /** The tool name, used for default action/resource derivation. */
  name: string;
  /** Optional description of what the tool does. */
  description?: string;
  /** LangChain public call method. */
  call?: (input: unknown) => Promise<unknown>;
  /** LCEL invoke method. */
  invoke?: (input: unknown) => Promise<unknown>;
  /** Internal implementation method. */
  _call?: (input: unknown) => Promise<unknown>;
  /** Allow additional properties. */
  [key: string]: unknown;
}

/**
 * Options for wrapping LangChain tools with Stele enforcement.
 */
export interface SteleLangChainOptions {
  /** The SteleClient instance for covenant evaluation. */
  client: SteleClient;
  /** The covenant document whose constraints are enforced. */
  covenant: CovenantDocument;
  /**
   * Custom function to derive the CCL action string from a tool and its input.
   * Defaults to `tool.name`.
   */
  actionFromTool?: (tool: LangChainToolLike, input: unknown) => string;
  /**
   * Custom function to derive the CCL resource string from a tool and its input.
   * Defaults to `'/' + tool.name`.
   */
  resourceFromTool?: (tool: LangChainToolLike, input: unknown) => string;
  /**
   * Custom handler invoked when a tool call is denied. If provided,
   * its return value is returned instead of throwing. If not provided,
   * a `SteleAccessDeniedError` is thrown.
   */
  onDenied?: (tool: LangChainToolLike, result: EvaluationResult) => unknown;
}

// ─── Callback handler event ──────────────────────────────────────────────────

/** A recorded event from the SteleCallbackHandler audit trail. */
export interface CallbackEvent {
  /** The event type (e.g. 'tool:start', 'chain:end', 'tool:error'). */
  type: string;
  /** Payload data associated with the event. */
  data: Record<string, unknown>;
  /** ISO 8601 timestamp of when the event was recorded. */
  timestamp: string;
}

// ─── SteleCallbackHandler ────────────────────────────────────────────────────

/**
 * A LangChain-compatible callback handler that records agent actions
 * to a Stele audit trail.
 *
 * This handler does not enforce constraints; it only observes and
 * logs. Use it alongside `withSteleTool` for enforcement + auditing.
 *
 * @example
 * ```typescript
 * const handler = new SteleCallbackHandler({ client, covenant });
 * await handler.handleToolStart({ name: 'search' }, 'query');
 * console.log(handler.events); // [{ type: 'tool:start', ... }]
 * ```
 */
export class SteleCallbackHandler {
  /** The SteleClient used for event emission. */
  readonly client: SteleClient;
  /** The covenant document being audited. */
  readonly covenant: CovenantDocument;
  /** Ordered list of recorded events. */
  readonly events: CallbackEvent[] = [];

  constructor(options: { client: SteleClient; covenant: CovenantDocument }) {
    this.client = options.client;
    this.covenant = options.covenant;
  }

  /**
   * Record a tool invocation start event.
   *
   * @param tool  - The tool being invoked.
   * @param input - The input passed to the tool.
   */
  async handleToolStart(tool: { name: string }, input: unknown): Promise<void> {
    this.events.push({
      type: 'tool:start',
      data: { tool: tool.name, input },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a tool invocation completion event.
   *
   * @param output - The output produced by the tool.
   */
  async handleToolEnd(output: unknown): Promise<void> {
    this.events.push({
      type: 'tool:end',
      data: { output },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a tool invocation error event.
   *
   * @param error - The error that occurred.
   */
  async handleToolError(error: Error): Promise<void> {
    this.events.push({
      type: 'tool:error',
      data: { error: error.message },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a chain execution start event.
   *
   * @param chain  - The chain being executed.
   * @param inputs - The inputs passed to the chain.
   */
  async handleChainStart(chain: { name?: string }, inputs: unknown): Promise<void> {
    this.events.push({
      type: 'chain:start',
      data: { chain: chain.name, inputs },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a chain execution completion event.
   *
   * @param outputs - The outputs produced by the chain.
   */
  async handleChainEnd(outputs: unknown): Promise<void> {
    this.events.push({
      type: 'chain:end',
      data: { outputs },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a chain execution error event.
   *
   * @param error - The error that occurred.
   */
  async handleChainError(error: Error): Promise<void> {
    this.events.push({
      type: 'chain:error',
      data: { error: error.message },
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── withSteleTool ───────────────────────────────────────────────────────────

/**
 * Wrap a LangChain-style tool with Stele covenant enforcement.
 *
 * Wraps all three call patterns (`call`, `invoke`, `_call`) when present.
 * Before delegation, evaluates the action/resource against the covenant.
 * If denied, throws a `SteleAccessDeniedError` (or invokes `onDenied`).
 *
 * @param tool    - The LangChain tool to wrap.
 * @param options - Enforcement options including client and covenant.
 * @returns A new tool with guarded call methods.
 *
 * @example
 * ```typescript
 * const protectedTool = withSteleTool(searchTool, { client, covenant });
 * await protectedTool.invoke('my query'); // throws if denied
 * ```
 */
export function withSteleTool<T extends LangChainToolLike>(
  tool: T,
  options: SteleLangChainOptions,
): T {
  const { client, covenant, actionFromTool, resourceFromTool, onDenied } = options;
  const wrapped = { ...tool } as T;

  const guard = async (
    input: unknown,
    originalFn: (input: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    const action = actionFromTool ? actionFromTool(tool, input) : tool.name;
    const resource = resourceFromTool ? resourceFromTool(tool, input) : '/' + tool.name;

    const result = await client.evaluateAction(covenant, action, resource);

    if (!result.permitted) {
      if (onDenied) {
        return onDenied(tool, result);
      }
      throw new SteleAccessDeniedError(
        `Action '${action}' on resource '${resource}' denied by covenant`,
        result,
      );
    }

    return originalFn.call(tool, input);
  };

  if (tool.call) {
    const originalCall = tool.call;
    (wrapped as LangChainToolLike).call = (input: unknown) =>
      guard(input, originalCall);
  }

  if (tool.invoke) {
    const originalInvoke = tool.invoke;
    (wrapped as LangChainToolLike).invoke = (input: unknown) =>
      guard(input, originalInvoke);
  }

  if (tool._call) {
    const original_call = tool._call;
    (wrapped as LangChainToolLike)._call = (input: unknown) =>
      guard(input, original_call);
  }

  return wrapped;
}

// ─── createChainGuard ────────────────────────────────────────────────────────

/**
 * Create a reusable guard for LangChain chain runs.
 *
 * Returns an async function that evaluates the chain name as both
 * the action and resource before delegating to the provided function.
 *
 * @param options - Enforcement options.
 * @returns An async function `(chainName, input, fn) => Promise<unknown>`
 *          that enforces the covenant before executing the chain function.
 *
 * @example
 * ```typescript
 * const guard = createChainGuard({ client, covenant });
 * const result = await guard('read', 'my input', async () => {
 *   return runChain();
 * });
 * ```
 */
export function createChainGuard(
  options: SteleLangChainOptions,
): (chainName: string, input: unknown, fn: () => Promise<unknown>) => Promise<unknown> {
  const { client, covenant, onDenied } = options;

  return async (
    chainName: string,
    input: unknown,
    fn: () => Promise<unknown>,
  ): Promise<unknown> => {
    const action = chainName;
    const resource = '/' + chainName;

    const result = await client.evaluateAction(covenant, action, resource);

    if (!result.permitted) {
      if (onDenied) {
        return onDenied({ name: chainName } as LangChainToolLike, result);
      }
      throw new SteleAccessDeniedError(
        `Chain '${chainName}' on resource '${resource}' denied by covenant`,
        result,
      );
    }

    return fn();
  };
}
