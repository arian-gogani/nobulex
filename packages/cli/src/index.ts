/*
 * CLI dispatcher.
 *
 * The top-level `run()` is a pure function: hand it argv + a filesystem,
 * get back a CommandResult. No stdout writes, no process.exit, no IO
 * side-effects. That keeps every subcommand shellable in tests.
 *
 * bin.ts is the only file that talks to the real process.
 */
import type { CommandResult, FileSystem } from './types.js';
import { parseArgs } from './args.js';
import { runInit } from './init.js';
import { runVerify } from './verify.js';
import { runInspect } from './inspect.js';
import { runReport } from './report.js';
import { nodeFs } from './fs.js';

export type { CommandResult, FileSystem } from './types.js';
export { runInit, runVerify, runInspect, runReport };
export { parseArgs };
export { nodeFs, memoryFs } from './fs.js';

export const VERSION = '0.2.0';

const HELP = `Nobulex CLI, the trust layer for autonomous agents

Usage:
  nobulex <command> [args]

Commands:
  init [path]                     Scaffold a new covenant project (defaults to .)
  verify <log-file> [--json]      Verify the hash-chain integrity of a log
  inspect <log-file> [--json]     Print a human-readable timeline
  report <log-file> --framework <name> [--text]
                                   Compliance report (frameworks: eu-ai-act-article-12,
                                   colorado-ai-act, soc2, iso-42001)
  help                             Show this message
  version                          Print CLI version

Examples:
  nobulex init ./my-agent
  nobulex verify ./action-log.json
  nobulex inspect ./action-log.json
  nobulex report ./action-log.json --framework eu-ai-act-article-12
`;

export function run(argv: readonly string[], fs: FileSystem = nodeFs): CommandResult {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { exitCode: 0, stdout: HELP };
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    return { exitCode: 0, stdout: `nobulex ${VERSION}\n` };
  }

  const parsed = parseArgs(rest, { boolean: ['json', 'text', 'force'] });

  switch (command) {
    case 'init':
      return runInit(parsed, fs);
    case 'verify':
      return runVerify(parsed, fs);
    case 'inspect':
      return runInspect(parsed, fs);
    case 'report':
      return runReport(parsed, fs);
    default:
      return {
        exitCode: 2,
        stdout: '',
        stderr: `unknown command: ${command}\n\n${HELP}`,
      };
  }
}
