/*
 * `nobulex verify <log-file>`, offline verification.
 *
 * Runs the hash-chain integrity check against the log file on disk. No network
 * access, no keys needed. Exits 0 when the chain verifies, 1 when it doesn't, 
 * script-friendly so CI can gate merges on it.
 *
 * --json emits a machine-readable result; default is a short human summary.
 */
import { verifyIntegrity } from '@nobulex/core';
import type { CommandResult, FileSystem } from './types.js';
import type { ParsedArgs } from './args.js';
import { loadActionLog } from './log-loader.js';

export function runVerify(args: ParsedArgs, fs: FileSystem): CommandResult {
  const file = args.positionals[0];
  if (!file) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'usage: nobulex verify <log-file> [--json]\n',
    };
  }

  let log;
  try {
    log = loadActionLog(file, fs);
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: `error: ${(e as Error).message}\n` };
  }

  const result = verifyIntegrity(log);

  if (args.flags['json']) {
    const payload = {
      file,
      valid: result.valid,
      errors: result.errors,
      entries: log.entries.length,
      agentDid: log.agentDid,
      rootHash: log.rootHash,
      headHash: log.headHash,
    };
    return {
      exitCode: result.valid ? 0 : 1,
      stdout: JSON.stringify(payload, null, 2) + '\n',
    };
  }

  if (result.valid) {
    const summary = [
      `✓ ${file}`,
      `  agent:      ${log.agentDid}`,
      `  entries:    ${log.entries.length}`,
      `  root hash:  ${log.rootHash ?? '(empty)'}`,
      `  head hash:  ${log.headHash ?? '(empty)'}`,
      `  status:     integrity verified`,
    ];
    return { exitCode: 0, stdout: summary.join('\n') + '\n' };
  }

  const lines = [
    `✗ ${file}`,
    `  agent:   ${log.agentDid}`,
    `  errors:  ${result.errors.length}`,
    ...result.errors.map((e) => `    - ${e}`),
  ];
  return { exitCode: 1, stdout: '', stderr: lines.join('\n') + '\n' };
}
