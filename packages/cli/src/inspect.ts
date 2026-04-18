/*
 * `nobulex inspect <log-file>` — human-readable timeline.
 *
 * Reuses the replay() primitive from @nobulex/core, then renders each event
 * one-per-line. --json emits the ReplayTimeline as-is for programmatic use.
 */
import { replay } from '@nobulex/core';
import type { CommandResult, FileSystem } from './types.js';
import type { ParsedArgs } from './args.js';
import { loadActionLog } from './log-loader.js';

export function runInspect(args: ParsedArgs, fs: FileSystem): CommandResult {
  const file = args.positionals[0];
  if (!file) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'usage: nobulex inspect <log-file> [--json]\n',
    };
  }

  let log;
  try {
    log = loadActionLog(file, fs);
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: `error: ${(e as Error).message}\n` };
  }

  const timeline = replay(log);

  if (args.flags['json']) {
    return { exitCode: 0, stdout: JSON.stringify(timeline, null, 2) + '\n' };
  }

  if (timeline.events.length === 0) {
    return { exitCode: 0, stdout: `(no events recorded for agent ${log.agentDid})\n` };
  }

  const header = [
    `agent:     ${timeline.agentDid}`,
    `started:   ${timeline.startedAt}`,
    `ended:     ${timeline.endedAt}`,
    timeline.durationMs !== null
      ? `duration:  ${formatDuration(timeline.durationMs)}`
      : '',
    `events:    ${timeline.events.length}`,
    '',
  ].filter(Boolean);

  const body = timeline.events.map((e) => e.description);

  return { exitCode: 0, stdout: header.concat(body).join('\n') + '\n' };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}
