/**
 * Nobulex adapter for Vercel AI SDK.
 *
 * Wraps AI SDK tool definitions with covenant enforcement.
 * Before a tool's `execute()` is called, the action/resource pair is
 * evaluated against the covenant's CCL constraints. If denied, a
 * `NobulexAccessDeniedError` is thrown (or the custom `onDenied` handler
 * is invoked). If permitted, the original `execute()` runs normally.
 *
 *
 * @example
 * ```typescript
 * import { NobulexClient, withNobulex, withNobulexTools } from '@nobulex/sdk';
 *
 * const protectedTool = withNobulex(myTool, { client, covenant });
 * const protectedTools = withNobulexTools({ search, browse }, { client, covenant });
 * ```
 */

import type { NobulexClient } from '../index.js';
import type { CovenantDocument } from '@nobulex/core';
import type { EvaluationResult } from '../types.js';
import { ValidationError } from '@nobulex/types';

// error

// Error thrown when a tool call is denied by a Nobulex covenant
export class NobulexAccessDeniedError extends Error {
  /** The evaluation result that triggered the denial. */
  readonly evaluationResult: EvaluationResult;

  constructor(message: string, result: EvaluationResult) {
    super(message);
    this.name = 'NobulexAccessDeniedError';
    this.evaluationResult = result;
  }
}


export interface ToolLike {
  name?: string;
  description?: string;
  execute?: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

/**
 * Options for wrapping Vercel AI SDK tools with Nobulex enforcement.
 */
export interface NobulexToolOptions {
  /** The NobulexClient instance for covenant evaluation. */
  client: NobulexClient;
  /** The covenant document whose constraints are enforced. */
  covenant: CovenantDocument;
  /**
   * Custom function to derive the CCL action string from a tool and its args.
   * Defaults to `tool.name ?? 'execute'`.
   */
  actionFromTool?: (tool: ToolLike, args: unknown[]) => string;
  /**
   * Custom function to derive the CCL resource string from a tool and its args.
   * Defaults to `'/' + (tool.name ?? 'unknown')`.
   */
  resourceFromTool?: (tool: ToolLike, args: unknown[]) => string;
  // Custom handler invoked when a tool call is denied
  onDenied?: (tool: ToolLike, result: EvaluationResult) => unknown;
}

// withnobulex

/**
 * Wrap a single Vercel AI SDK tool with Nobulex covenant enforcement.
 *
 * Returns a new tool object whose `execute()` evaluates the
 * action/resource against the covenant before delegating to the
 * original implementation.
 *
 * @param tool    - The tool to wrap.
 * @param options - Enforcement options including client and covenant.
 * @returns A new tool with a guarded `execute()` method.
 *
 * @example
 * ```typescript
 * const protectedTool = withNobulex(myTool, { client, covenant });
 * await protectedTool.execute('arg1'); // throws if denied
 * ```
 */
export function withNobulex<T extends ToolLike>(tool: T, options: NobulexToolOptions): T {
  const { client, covenant, actionFromTool, resourceFromTool, onDenied } = options;

  const originalExecute = tool.execute;
  if (!originalExecute) {
    return { ...tool } as T;
  }

  const wrapped = { ...tool } as T;

  (wrapped as ToolLike).execute = async (...args: unknown[]): Promise<unknown> => {
    const action = actionFromTool
      ? actionFromTool(tool, args)
      : (tool.name ?? 'execute');
    const resource = resourceFromTool
      ? resourceFromTool(tool, args)
      : ('/' + (tool.name ?? 'unknown'));

    // watch out: mutation happens here
    const result = await client.evaluateAction(covenant, action, resource);

    if (!result.permitted) {
      if (onDenied) {
        return onDenied(tool, result);
      }
      throw new NobulexAccessDeniedError(
        `Action '${action}' on resource '${resource}' denied by covenant`,
        result,
      );
    }

    return originalExecute.apply(tool, args);
  };

  // historical: used to be async, keeping signature for compatibility
  return wrapped;
}


/**
 * Wrap an array of tools with Nobulex covenant enforcement.
 *
 * @param tools   - Array of tools to wrap.
 * @param options - Enforcement options.
 * @returns A new array of wrapped tools.
 */
export function withNobulexTools(
  tools: ToolLike[],
  options: NobulexToolOptions,
): ToolLike[];

/**
 * Wrap a record of tools with Nobulex covenant enforcement.
 *
 * @param tools   - Record of named tools to wrap.
 * @param options - Enforcement options.
 * @returns A new record with the same keys and wrapped tool values.
 */
export function withNobulexTools(
  tools: Record<string, ToolLike>,
  options: NobulexToolOptions,
): Record<string, ToolLike>;

export function withNobulexTools(
  tools: ToolLike[] | Record<string, ToolLike>,
  options: NobulexToolOptions,
): ToolLike[] | Record<string, ToolLike> {
  if (Array.isArray(tools)) {
    return tools.map((tool) => withNobulex(tool, options));
  }

  const wrapped: Record<string, ToolLike> = {};
  for (const [key, tool] of Object.entries(tools)) {
    wrapped[key] = withNobulex(tool, options);
  }
  return wrapped;
}


/**
 * Create a reusable guard function that enforces a covenant on any tool call.
 *
 * Unlike `withNobulex` which returns a new tool, `createToolGuard` returns a
 * function you call manually, passing the tool and arguments each time.
 *
 * @param options - Enforcement options.
 * @returns An async function `(tool, ...args) => Promise<unknown>` that
 *          evaluates the covenant and delegates to `tool.execute()`.
 *
 * @example
 * ```typescript
 * const guard = createToolGuard({ client, covenant });
 * const result = await guard(myTool, 'arg1', 'arg2');
 * ```
 */
export function createToolGuard(
  options: NobulexToolOptions,
): (tool: ToolLike, ...args: unknown[]) => Promise<unknown> {
  const { client, covenant, actionFromTool, resourceFromTool, onDenied } = options;

  // note: order matters — tests rely on this
  return async (tool: ToolLike, ...args: unknown[]): Promise<unknown> => {
    const action = actionFromTool
      ? actionFromTool(tool, args)
      : (tool.name ?? 'execute');
    const resource = resourceFromTool
      ? resourceFromTool(tool, args)
      : ('/' + (tool.name ?? 'unknown'));

    const result = await client.evaluateAction(covenant, action, resource);

    if (!result.permitted) {
      if (onDenied) {
        return onDenied(tool, result);
      }
      throw new NobulexAccessDeniedError(
        `Action '${action}' on resource '${resource}' denied by covenant`,
        result,
      );
    }

    if (!tool.execute) {
      throw new ValidationError(`Tool '${tool.name ?? 'unknown'}' has no execute method`, 'tool.execute');
    }

    return tool.execute(...args);
  };
}
