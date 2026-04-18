/**
 * @nobulex/claude-agent-sdk
 *
 * Compliance hooks for Anthropic's Claude Agent SDK. Every tool call made by
 * a Claude-powered agent becomes a hash-chained, tamper-evident entry in a
 * Nobulex action log, evaluated against a covenant spec.
 *
 * Flow:
 *   - PreToolUse  → covenant check. In 'enforce' mode, covenant violations
 *     block the tool call. In 'observe' mode, they log as `would_block` but
 *     are allowed to run. Emergency halt blocks unconditionally.
 *   - PostToolUse → once the tool has run, the pending call is finalised
 *     into the log with an outcomeHash that binds the entry to the actual
 *     post-execution result (or error).
 *
 * Usage:
 *   import { createNobulexHooks } from '@nobulex/claude-agent-sdk';
 *   import { createDID, parseSource } from '@nobulex/core';
 *
 *   const agent = await createDID();
 *   const spec = parseSource('covenant MyAgent { permit read; forbid delete; }');
 *   const hooks = createNobulexHooks({ agentDid: agent.did, spec });
 *
 *   for await (const msg of query({ prompt: '...', hooks })) { ... }
 */

import {
  compile,
  ActionLogBuilder,
  verifyIntegrity,
  computeOutcomeHash,
  computeFailureHash,
} from '@nobulex/core';
import type {
  ActionContext,
  ActionLog,
  ActionLogEntry,
  CovenantSpec,
  EnforcementDecision,
} from '@nobulex/core';

// Re-export what callers typically need so `import from '@nobulex/claude-agent-sdk'`
// is enough to set up a hook-based agent.
export { createDID, parseSource } from '@nobulex/core';
export type { ActionLog, ActionLogEntry, CovenantSpec } from '@nobulex/core';

// ── Hook event types (mirrors what Claude Agent SDK passes to hooks) ───────

/**
 * Return value for Claude Agent SDK PreToolUse hooks.
 * - `undefined` allows the call through
 * - `{ blocked: reason }` stops the tool from executing and surfaces `reason`
 */
export interface HookResult {
  readonly blocked?: string;
  readonly decision?: 'allow' | 'deny';
}

export interface ToolUseEvent {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly sessionId?: string;
}

export interface ToolResultEvent {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly result: unknown;
  readonly error?: string;
  readonly sessionId?: string;
}

export interface SessionEvent {
  readonly sessionId: string;
  readonly timestamp?: string;
}

// ── Configuration ──────────────────────────────────────────────────────────

export type EnforcementMode = 'enforce' | 'observe';

export interface NobulexHooksConfig {
  /** DID of the agent whose actions this log records. */
  readonly agentDid: string;
  /** Parsed covenant specification — use `parseSource` from `@nobulex/core`. */
  readonly spec: CovenantSpec;
  /**
   * Enforcement mode. `'enforce'` (default) blocks covenant violations;
   * `'observe'` logs them as `would_block` but lets them run — useful for
   * validating a new covenant in production before flipping to enforce.
   */
  readonly mode?: EnforcementMode;
  /** Fires when a tool call is refused (covenant violation or halt). */
  readonly onBlocked?: (toolName: string, reason: string) => void;
  /** Fires once per finalised log entry (post-execution). */
  readonly onAction?: (entry: ActionLogEntry) => void;
}

// ── Public surface ─────────────────────────────────────────────────────────

export interface NobulexHooks {
  // Claude Agent SDK hook functions.
  readonly PreToolUse: (event: ToolUseEvent) => HookResult | undefined;
  readonly PostToolUse: (event: ToolResultEvent) => void;
  readonly SessionStart: (event: SessionEvent) => void;
  readonly SessionEnd: (event: SessionEvent) => void;

  // Nobulex control surface.
  /** Emergency halt — block every subsequent tool call. */
  readonly halt: () => void;
  /** Restore normal enforcement after a {@link halt}. */
  readonly resume: () => void;
  readonly halted: () => boolean;
  /** The current hash-chained action log. */
  readonly getLog: () => ActionLog;
  /** Verify the full hash chain. `valid` is true iff no tampering. */
  readonly verifyChain: () => { valid: boolean; errors: readonly string[] };
}

// ── Factory ────────────────────────────────────────────────────────────────

interface PendingCall {
  readonly action: string;
  readonly resource: string;
  readonly params: Record<string, unknown>;
  readonly decisionOutcome: 'success' | 'would_block';
  readonly timestamp: string;
}

/**
 * Build a set of Claude Agent SDK hooks that gate tool calls by a covenant
 * and append a hash-chained audit log. The returned object is passed straight
 * to `query({ prompt, hooks })`.
 */
export function createNobulexHooks(config: NobulexHooksConfig): NobulexHooks {
  const mode: EnforcementMode = config.mode ?? 'enforce';
  const enforce = compile(config.spec);
  const builder = new ActionLogBuilder(config.agentDid);

  // A single pending slot fits the typical Claude Agent SDK flow (tools run
  // sequentially within a turn). A more complex runtime could key this by
  // sessionId + toolName; a single slot keeps the hash chain sequential.
  let pending: PendingCall | null = null;
  let halted = false;

  function PreToolUse(event: ToolUseEvent): HookResult | undefined {
    const action = event.toolName;
    const params = event.toolInput ?? {};
    const resource = extractResource(params);
    const timestamp = new Date().toISOString();

    if (halted) {
      const entry = builder.append({
        action, resource, params,
        outcome: 'halted',
        timestamp,
      });
      const reason = 'Emergency halt active — all actions suspended';
      config.onBlocked?.(action, reason);
      config.onAction?.(entry);
      return { blocked: `Nobulex: ${reason}` };
    }

    const ctx: ActionContext = { action, params };
    const decision: EnforcementDecision = enforce(ctx);
    const wouldBlock = decision.action === 'block';

    if (wouldBlock && mode === 'enforce') {
      // Blocked calls never reach PostToolUse, so the entry is final here.
      const entry = builder.append({
        action, resource, params,
        outcome: 'blocked',
        timestamp,
      });
      const reason = decision.reason || 'blocked by covenant';
      config.onBlocked?.(action, reason);
      config.onAction?.(entry);
      return { blocked: `Nobulex: ${reason}` };
    }

    // Allowed (or observe-mode "would_block") — defer logging until we know
    // the outcome so the final entry binds to the actual post-execution result.
    pending = {
      action, resource, params,
      decisionOutcome: wouldBlock ? 'would_block' : 'success',
      timestamp,
    };
    return undefined;
  }

  function PostToolUse(event: ToolResultEvent): void {
    if (!pending) return;
    const current = pending;
    pending = null;

    const hadError = typeof event.error === 'string' && event.error.length > 0;
    const outcome = hadError ? 'failure' : current.decisionOutcome;
    const outcomeHash = hadError
      ? computeFailureHash(event.error!)
      : computeOutcomeHash(event.result);

    const entry = builder.append({
      action: current.action,
      resource: current.resource,
      params: current.params,
      outcome,
      outcomeHash,
      timestamp: current.timestamp,
    });
    config.onAction?.(entry);
  }

  function SessionStart(_event: SessionEvent): void {
    // Intentionally no-op: sessions are visible through log timestamps.
    // Hook is provided for Claude Agent SDK API completeness.
  }

  function SessionEnd(_event: SessionEvent): void {
    // Flush any dangling pending call (tool started but SDK never fired
    // PostToolUse — e.g. session aborted). Record it as a failure so the
    // chain stays complete.
    if (pending) {
      const current = pending;
      pending = null;
      builder.append({
        action: current.action,
        resource: current.resource,
        params: current.params,
        outcome: 'failure',
        outcomeHash: computeFailureHash('session ended before tool completed'),
        timestamp: current.timestamp,
      });
    }
  }

  function halt(): void {
    halted = true;
  }

  function resume(): void {
    halted = false;
  }

  function getLog(): ActionLog {
    return builder.toLog();
  }

  function verifyChain(): { valid: boolean; errors: readonly string[] } {
    const result = verifyIntegrity(builder.toLog());
    return { valid: result.valid, errors: result.errors };
  }

  return {
    PreToolUse,
    PostToolUse,
    SessionStart,
    SessionEnd,
    halt,
    resume,
    halted: () => halted,
    getLog,
    verifyChain,
  };
}

/**
 * Claude Agent SDK tool inputs are free-form. If the input carries a
 * conventional `resource` / `path` / `url` field, surface it as the log
 * entry's resource; otherwise wildcard. Keeps audit output readable without
 * forcing a schema on tool authors.
 */
function extractResource(params: Record<string, unknown>): string {
  for (const key of ['resource', 'path', 'url', 'file', 'target']) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '*';
}
