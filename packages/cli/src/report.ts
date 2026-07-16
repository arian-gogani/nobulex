/*
 * `nobulex report <log-file> --framework <fw>`, compliance report.
 *
 * Thin wrapper around generateComplianceReport(). Emits JSON by default
 * (auditor tooling reads this directly); pass --text for a human summary.
 */
import { generateComplianceReport } from '@nobulex/core';
import type { ComplianceFramework } from '@nobulex/core';
import type { CommandResult, FileSystem } from './types.js';
import type { ParsedArgs } from './args.js';
import { loadActionLog } from './log-loader.js';

const SUPPORTED: readonly ComplianceFramework[] = [
  'eu-ai-act-article-12',
  'colorado-ai-act',
  'soc2',
  'iso-42001',
];

export function runReport(args: ParsedArgs, fs: FileSystem): CommandResult {
  const file = args.positionals[0];
  if (!file) {
    return {
      exitCode: 2,
      stdout: '',
      stderr:
        `usage: nobulex report <log-file> --framework <name> [--text]\n` +
        `  frameworks: ${SUPPORTED.join(', ')}\n`,
    };
  }

  const framework = args.flags['framework'];
  if (typeof framework !== 'string') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `--framework <name> is required (one of: ${SUPPORTED.join(', ')})\n`,
    };
  }
  if (!SUPPORTED.includes(framework as ComplianceFramework)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `unknown framework '${framework}'. Supported: ${SUPPORTED.join(', ')}\n`,
    };
  }

  let log;
  try {
    log = loadActionLog(file, fs);
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: `error: ${(e as Error).message}\n` };
  }

  const report = generateComplianceReport(log, {
    framework: framework as ComplianceFramework,
  });

  if (args.flags['text']) {
    const lines = [
      `Framework: ${report.framework}`,
      `Agent:     ${report.agentDid}`,
      `Generated: ${report.generatedAt}`,
      `Actions:   ${report.totalActions}`,
      `Integrity: ${report.logIntegrity.valid ? 'valid' : 'INVALID'}`,
      `Coverage:  ${report.summary.coveragePercent}% (${report.summary.met} met, ${report.summary.unmet} unmet)`,
      '',
      'Requirements:',
      ...report.requirements.map(
        (r) => `  [${r.met ? 'x' : ' '}] ${r.id}: ${r.title}, ${r.rationale}`,
      ),
    ];
    return { exitCode: 0, stdout: lines.join('\n') + '\n' };
  }

  return { exitCode: 0, stdout: JSON.stringify(report, null, 2) + '\n' };
}
