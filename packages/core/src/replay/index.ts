/*
 * Replay — reconstruct a chronological, human-readable timeline from
 * an action log. Built for incident investigations and auditor walkthroughs
 * where "what did the agent do, in what order, and what happened?" is
 * the first question asked.
 */

import type { ActionLog, ActionLogEntry } from '../types/index';

export interface ReplayEvent {
  readonly index: number;
  readonly timestamp: string;
  readonly action: string;
  readonly resource: string;
  readonly outcome: ActionLogEntry['outcome'];
  /** Human-readable one-line description of what occurred. */
  readonly description: string;
  readonly params: Record<string, unknown>;
}

export interface ReplayTimeline {
  readonly agentDid: string;
  readonly events: readonly ReplayEvent[];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
}

/**
 * Reconstruct a chronological timeline of an action log with human-readable
 * descriptions of each event.
 */
export function replay(log: ActionLog): ReplayTimeline {
  const events: ReplayEvent[] = log.entries.map((entry) => ({
    index: entry.index,
    timestamp: entry.timestamp,
    action: entry.action,
    resource: entry.resource,
    outcome: entry.outcome,
    description: describeEntry(entry),
    params: entry.params,
  }));

  const startedAt = events.length > 0 ? events[0]!.timestamp : null;
  const endedAt = events.length > 0 ? events[events.length - 1]!.timestamp : null;
  let durationMs: number | null = null;
  if (startedAt && endedAt) {
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      durationMs = end - start;
    }
  }

  return {
    agentDid: log.agentDid,
    events,
    startedAt,
    endedAt,
    durationMs,
  };
}

function describeEntry(entry: ActionLogEntry): string {
  const subject = entry.resource && entry.resource !== '*'
    ? `'${entry.action}' on '${entry.resource}'`
    : `'${entry.action}'`;

  switch (entry.outcome) {
    case 'success':
      return `#${entry.index} ${entry.timestamp} — ${subject} succeeded`;
    case 'failure':
      return `#${entry.index} ${entry.timestamp} — ${subject} was attempted and failed`;
    case 'blocked':
      return `#${entry.index} ${entry.timestamp} — ${subject} was blocked by covenant enforcement`;
    case 'would_block':
      return `#${entry.index} ${entry.timestamp} — ${subject} would have been blocked (observe mode) but executed`;
    case 'halted':
      return `#${entry.index} ${entry.timestamp} — ${subject} rejected by emergency halt`;
  }
}
