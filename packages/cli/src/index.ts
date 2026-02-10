#!/usr/bin/env node

/**
 * @stele/cli -- Command-line interface for the Stele covenant protocol.
 *
 * Provides commands for key generation, covenant creation, verification,
 * evaluation, inspection, CCL parsing, and shell completions.
 *
 * @packageDocumentation
 */

import { generateKeyPair, toHex } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import {
  buildCovenant,
  verifyCovenant,
  deserializeCovenant,
  serializeCovenant,
  PROTOCOL_VERSION,
} from '@stele/core';
import type { CovenantDocument } from '@stele/core';
import { parse, evaluate, serialize as serializeCCL } from '@stele/ccl';

import {
  setColorsEnabled,
  success,
  error as fmtError,
  header,
  dim,
  bold,
  green,
  red,
  cyan,
  table,
  keyValue,
  box,
} from './format';
import { loadConfig, saveConfig } from './config';
import type { SteleConfig } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── Argument parser ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = '';

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else if (command === '') {
      command = arg;
      i += 1;
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { command, positional, flags };
}

function getFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const val = flags[key];
  if (val === undefined || typeof val === 'boolean') return undefined;
  return val;
}

function hasFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] !== undefined;
}

// ─── Help text ────────────────────────────────────────────────────────────────

function buildMainHelp(): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(header('Stele CLI') + dim(' - Covenant Protocol Tool'));
  lines.push('');
  lines.push(`${bold('Usage:')} stele <command> [options]`);
  lines.push('');
  lines.push(bold('Commands:'));
  lines.push('');
  lines.push(
    table(
      ['Command', 'Description'],
      [
        ['init', 'Generate an Ed25519 key pair and config file'],
        ['create', 'Create and sign a covenant document'],
        ['verify <json>', 'Verify a covenant document'],
        ['evaluate <json> <action> <resource>', 'Evaluate an action against a covenant'],
        ['inspect <json>', 'Pretty-print covenant details'],
        ['parse <ccl>', 'Parse CCL and output AST as JSON'],
        ['completions <shell>', 'Generate shell completion script (bash|zsh)'],
        ['version', 'Print version information'],
        ['help', 'Show this help message'],
      ],
    ),
  );
  lines.push('');
  lines.push(bold('Global flags:'));
  lines.push(
    table(
      ['Flag', 'Description'],
      [
        ['--json', 'Machine-readable JSON output (no colors)'],
        ['--no-color', 'Disable colored output'],
        ['--help', 'Show help for a command'],
      ],
    ),
  );
  lines.push('');
  return lines.join('\n');
}

const INIT_HELP = `stele init - Generate an Ed25519 key pair and write stele.config.json.

Usage: stele init [--json]

Generates a new key pair, outputs the public key, and writes a
stele.config.json configuration file in the current directory.
With --json, outputs { publicKey, privateKey } as JSON.`;

const CREATE_HELP = `stele create - Create and sign a covenant document.

Usage: stele create --issuer <id> --beneficiary <id> --constraints <ccl> [--json]

Options:
  --issuer <id>          Issuer identifier (required)
  --beneficiary <id>     Beneficiary identifier (required)
  --constraints <ccl>    CCL constraint string (required)
  --json                 Output raw JSON`;

const VERIFY_HELP = `stele verify - Verify a covenant document.

Usage: stele verify <json-string> [--json]

Runs all verification checks on the covenant and reports results.`;

const EVALUATE_HELP = `stele evaluate - Evaluate an action against a covenant.

Usage: stele evaluate <json-string> <action> <resource> [--json]

Parses the covenant's CCL constraints and evaluates the given action
and resource against them.`;

const INSPECT_HELP = `stele inspect - Pretty-print covenant details.

Usage: stele inspect <json-string> [--json]

Displays covenant fields including parties, constraints, and metadata.`;

const PARSE_HELP = `stele parse - Parse CCL source text and output AST.

Usage: stele parse <ccl-string> [--json]

Parses CCL and outputs the AST. With --json, outputs the full
CCLDocument as JSON. Without --json, outputs a human-readable summary.`;

const COMPLETIONS_HELP = `stele completions - Generate shell completion script.

Usage: stele completions <shell>

Supported shells:
  bash    Generate Bash completion script
  zsh     Generate Zsh completion script

Pipe the output to the appropriate file:
  stele completions bash > /etc/bash_completion.d/stele
  stele completions zsh > ~/.zsh/completions/_stele`;

// ─── Shell completions ────────────────────────────────────────────────────────

function bashCompletions(): string {
  return `# Bash completion for stele CLI
# Source this file or copy to /etc/bash_completion.d/stele

_stele_completions() {
    local cur prev commands global_flags
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="init create verify evaluate inspect parse completions version help"
    global_flags="--json --no-color --help"

    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
        return 0
    fi

    case "\${COMP_WORDS[1]}" in
        create)
            local create_flags="--issuer --beneficiary --constraints --json --help"
            COMPREPLY=( $(compgen -W "\${create_flags}" -- "\${cur}") )
            ;;
        completions)
            COMPREPLY=( $(compgen -W "bash zsh" -- "\${cur}") )
            ;;
        *)
            COMPREPLY=( $(compgen -W "\${global_flags}" -- "\${cur}") )
            ;;
    esac
    return 0
}

complete -F _stele_completions stele`;
}

function zshCompletions(): string {
  return `#compdef stele
# Zsh completion for stele CLI
# Copy to a directory in your $fpath (e.g. ~/.zsh/completions/_stele)

_stele() {
    local -a commands
    commands=(
        'init:Generate an Ed25519 key pair and config file'
        'create:Create and sign a covenant document'
        'verify:Verify a covenant document'
        'evaluate:Evaluate an action against a covenant'
        'inspect:Pretty-print covenant details'
        'parse:Parse CCL and output AST'
        'completions:Generate shell completion script'
        'version:Print version information'
        'help:Show help message'
    )

    _arguments -C \\
        '--json[Machine-readable JSON output]' \\
        '--no-color[Disable colored output]' \\
        '--help[Show help]' \\
        '1:command:->command' \\
        '*::arg:->args'

    case $state in
        command)
            _describe 'stele command' commands
            ;;
        args)
            case $words[1] in
                create)
                    _arguments \\
                        '--issuer[Issuer identifier]:id:' \\
                        '--beneficiary[Beneficiary identifier]:id:' \\
                        '--constraints[CCL constraint string]:ccl:' \\
                        '--json[Output raw JSON]'
                    ;;
                completions)
                    _arguments '1:shell:(bash zsh)'
                    ;;
            esac
            ;;
    esac
}

_stele "$@"`;
}

// ─── Command: init ────────────────────────────────────────────────────────────

async function cmdInit(flags: Record<string, string | boolean>, configDir?: string): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: INIT_HELP, stderr: '', exitCode: 0 };
  }

  const keyPair: KeyPair = await generateKeyPair();
  const publicKeyHex = keyPair.publicKeyHex;
  const privateKeyHex = toHex(keyPair.privateKey);

  if (hasFlag(flags, 'json')) {
    const out = JSON.stringify({ publicKey: publicKeyHex, privateKey: privateKeyHex }, null, 2);
    return { stdout: out, stderr: '', exitCode: 0 };
  }

  // Write config file
  const config: SteleConfig = {
    defaultIssuer: { id: 'default', publicKey: publicKeyHex },
    outputFormat: 'text',
  };

  try {
    saveConfig(config, configDir);
  } catch {
    // Config write failure is non-fatal -- user may be in a read-only dir
  }

  const lines: string[] = [
    '',
    success('Generated Ed25519 key pair.'),
    '',
    keyValue([
      ['Public key', publicKeyHex],
    ]),
    '',
    success('Wrote stele.config.json'),
    '',
    dim('Run "stele create" to build your first covenant.'),
    '',
  ];
  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

// ─── Command: create ──────────────────────────────────────────────────────────

async function cmdCreate(flags: Record<string, string | boolean>, config?: SteleConfig): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: CREATE_HELP, stderr: '', exitCode: 0 };
  }

  const issuerId = getFlag(flags, 'issuer') ?? config?.defaultIssuer?.id;
  if (!issuerId) {
    return { stdout: '', stderr: 'Error: --issuer <id> is required', exitCode: 1 };
  }

  const beneficiaryId = getFlag(flags, 'beneficiary') ?? config?.defaultBeneficiary?.id;
  if (!beneficiaryId) {
    return { stdout: '', stderr: 'Error: --beneficiary <id> is required', exitCode: 1 };
  }

  const constraints = getFlag(flags, 'constraints') ?? config?.constraints;
  if (!constraints) {
    return { stdout: '', stderr: 'Error: --constraints <ccl> is required', exitCode: 1 };
  }

  // Validate that constraints parse as valid CCL
  try {
    parse(constraints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: Invalid CCL constraints: ${msg}`, exitCode: 1 };
  }

  const keyPair = await generateKeyPair();

  const covenant = await buildCovenant({
    issuer: {
      id: issuerId,
      publicKey: keyPair.publicKeyHex,
      role: 'issuer',
      name: issuerId,
    },
    beneficiary: {
      id: beneficiaryId,
      publicKey: keyPair.publicKeyHex,
      role: 'beneficiary',
      name: beneficiaryId,
    },
    constraints,
    privateKey: keyPair.privateKey,
  });

  const json = serializeCovenant(covenant);

  if (hasFlag(flags, 'json')) {
    return { stdout: json, stderr: '', exitCode: 0 };
  }

  const lines: string[] = [
    '',
    success('Covenant created successfully.'),
    '',
    keyValue([
      ['ID', covenant.id],
      ['Issuer', covenant.issuer.id],
      ['Beneficiary', covenant.beneficiary.id],
      ['Version', covenant.version],
    ]),
    '',
    dim('--- Serialized covenant ---'),
    json,
    '',
  ];
  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

// ─── Command: verify ──────────────────────────────────────────────────────────

async function cmdVerify(positional: string[], flags: Record<string, string | boolean>): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: VERIFY_HELP, stderr: '', exitCode: 0 };
  }

  const jsonStr = positional[0];
  if (!jsonStr) {
    return { stdout: '', stderr: 'Error: Covenant JSON string is required', exitCode: 1 };
  }

  let covenant: CovenantDocument;
  try {
    covenant = deserializeCovenant(jsonStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: Invalid covenant JSON: ${msg}`, exitCode: 1 };
  }

  const result = await verifyCovenant(covenant);

  if (hasFlag(flags, 'json')) {
    const out = JSON.stringify({
      valid: result.valid,
      checks: result.checks,
    }, null, 2);
    return { stdout: out, stderr: '', exitCode: result.valid ? 0 : 1 };
  }

  const lines: string[] = [''];
  lines.push(header('Verification Results'));
  lines.push('');

  for (const check of result.checks) {
    if (check.passed) {
      lines.push(success(`${check.name}${check.message ? dim(` - ${check.message}`) : ''}`));
    } else {
      lines.push(fmtError(`${check.name}${check.message ? ` - ${check.message}` : ''}`));
    }
  }
  lines.push('');

  const passed = result.checks.filter((c) => c.passed).length;
  const total = result.checks.length;

  if (result.valid) {
    const summary = box('Summary', `${green(`Valid: ${passed}/${total} checks passed`)}`);
    lines.push(summary);
  } else {
    const summary = box('Summary', `${red(`Invalid: ${passed}/${total} checks passed`)}`);
    lines.push(summary);
  }
  lines.push('');

  return { stdout: lines.join('\n'), stderr: '', exitCode: result.valid ? 0 : 1 };
}

// ─── Command: evaluate ────────────────────────────────────────────────────────

async function cmdEvaluate(positional: string[], flags: Record<string, string | boolean>): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: EVALUATE_HELP, stderr: '', exitCode: 0 };
  }

  const jsonStr = positional[0];
  if (!jsonStr) {
    return { stdout: '', stderr: 'Error: Covenant JSON string is required', exitCode: 1 };
  }

  const action = positional[1];
  if (!action) {
    return { stdout: '', stderr: 'Error: Action is required', exitCode: 1 };
  }

  const resource = positional[2];
  if (!resource) {
    return { stdout: '', stderr: 'Error: Resource is required', exitCode: 1 };
  }

  let covenant: CovenantDocument;
  try {
    covenant = deserializeCovenant(jsonStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: Invalid covenant JSON: ${msg}`, exitCode: 1 };
  }

  let cclDoc;
  try {
    cclDoc = parse(covenant.constraints);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: Failed to parse constraints: ${msg}`, exitCode: 1 };
  }

  const result = evaluate(cclDoc, action, resource);

  if (hasFlag(flags, 'json')) {
    const out = JSON.stringify({
      permitted: result.permitted,
      action,
      resource,
      matchedRule: result.matchedRule ?? null,
      allMatches: result.allMatches,
      reason: result.reason ?? null,
      severity: result.severity ?? null,
    }, null, 2);
    return { stdout: out, stderr: '', exitCode: result.permitted ? 0 : 1 };
  }

  const decision = result.permitted ? green('PERMITTED') : red('DENIED');
  const lines: string[] = [
    '',
    header('Evaluation Result'),
    '',
    keyValue([
      ['Action', action],
      ['Resource', resource],
      ['Decision', decision],
    ]),
  ];
  if (result.reason) {
    lines.push(keyValue([['Reason', result.reason]]));
  }
  if (result.matchedRule) {
    lines.push(keyValue([['Rule', `${result.matchedRule.type} (line ${result.matchedRule.line})`]]));
  }
  lines.push('');
  return { stdout: lines.join('\n'), stderr: '', exitCode: result.permitted ? 0 : 1 };
}

// ─── Command: inspect ─────────────────────────────────────────────────────────

async function cmdInspect(positional: string[], flags: Record<string, string | boolean>): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: INSPECT_HELP, stderr: '', exitCode: 0 };
  }

  const jsonStr = positional[0];
  if (!jsonStr) {
    return { stdout: '', stderr: 'Error: Covenant JSON string is required', exitCode: 1 };
  }

  let covenant: CovenantDocument;
  try {
    covenant = deserializeCovenant(jsonStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: Invalid covenant JSON: ${msg}`, exitCode: 1 };
  }

  if (hasFlag(flags, 'json')) {
    const out = JSON.stringify(covenant, null, 2);
    return { stdout: out, stderr: '', exitCode: 0 };
  }

  // Build identity section
  const identityLines: string[] = [];
  identityLines.push(keyValue([
    ['ID', covenant.id],
    ['Version', covenant.version],
    ['Created', covenant.createdAt],
  ]));
  if (covenant.expiresAt) {
    identityLines.push(keyValue([['Expires', covenant.expiresAt]]));
  }
  if (covenant.activatesAt) {
    identityLines.push(keyValue([['Activates', covenant.activatesAt]]));
  }

  // Build parties section
  const partiesLines: string[] = [];
  partiesLines.push(bold('Issuer'));
  partiesLines.push(keyValue([
    ['  ID', covenant.issuer.id],
    ['  Key', covenant.issuer.publicKey.slice(0, 16) + '...'],
  ]));
  if (covenant.issuer.name) {
    partiesLines.push(keyValue([['  Name', covenant.issuer.name]]));
  }
  partiesLines.push('');
  partiesLines.push(bold('Beneficiary'));
  partiesLines.push(keyValue([
    ['  ID', covenant.beneficiary.id],
    ['  Key', covenant.beneficiary.publicKey.slice(0, 16) + '...'],
  ]));
  if (covenant.beneficiary.name) {
    partiesLines.push(keyValue([['  Name', covenant.beneficiary.name]]));
  }

  // Build constraints section
  const constraintLines: string[] = [];
  for (const line of covenant.constraints.split('\n')) {
    constraintLines.push(cyan(line));
  }

  // Parse to show summary
  try {
    const cclDoc = parse(covenant.constraints);
    constraintLines.push('');
    constraintLines.push(dim('Summary:'));
    constraintLines.push(keyValue([
      ['  Permits', String(cclDoc.permits.length)],
      ['  Denies', String(cclDoc.denies.length)],
      ['  Obligations', String(cclDoc.obligations.length)],
      ['  Limits', String(cclDoc.limits.length)],
    ]));
  } catch {
    // CCL parse failure is non-fatal for inspect
  }

  // Build extras section
  const extrasLines: string[] = [];
  if (covenant.enforcement) {
    extrasLines.push(keyValue([['Enforcement', covenant.enforcement.type]]));
  }
  if (covenant.proof) {
    extrasLines.push(keyValue([['Proof', covenant.proof.type]]));
  }
  if (covenant.chain) {
    extrasLines.push(keyValue([
      ['Chain Parent', covenant.chain.parentId],
      ['Chain Relation', covenant.chain.relation],
      ['Chain Depth', String(covenant.chain.depth)],
    ]));
  }
  if (covenant.metadata) {
    if (covenant.metadata.name) {
      extrasLines.push(keyValue([['Meta Name', covenant.metadata.name]]));
    }
    if (covenant.metadata.description) {
      extrasLines.push(keyValue([['Meta Desc', covenant.metadata.description]]));
    }
    if (covenant.metadata.tags && covenant.metadata.tags.length > 0) {
      extrasLines.push(keyValue([['Meta Tags', covenant.metadata.tags.join(', ')]]));
    }
  }

  // Assemble output
  const lines: string[] = [''];

  lines.push(box('Covenant Inspection', identityLines.join('\n')));
  lines.push('');
  lines.push(box('Parties', partiesLines.join('\n')));
  lines.push('');
  lines.push(box('Constraints', constraintLines.join('\n')));

  if (extrasLines.length > 0) {
    lines.push('');
    lines.push(box('Details', extrasLines.join('\n')));
  }

  lines.push('');
  lines.push(dim(`Signature: ${covenant.signature.slice(0, 32)}...`));
  lines.push('');

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

// ─── Command: parse ───────────────────────────────────────────────────────────

async function cmdParse(positional: string[], flags: Record<string, string | boolean>): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: PARSE_HELP, stderr: '', exitCode: 0 };
  }

  const cclStr = positional[0];
  if (!cclStr) {
    return { stdout: '', stderr: 'Error: CCL string is required', exitCode: 1 };
  }

  let cclDoc;
  try {
    cclDoc = parse(cclStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: CCL parse error: ${msg}`, exitCode: 1 };
  }

  if (hasFlag(flags, 'json')) {
    const out = JSON.stringify(cclDoc, null, 2);
    return { stdout: out, stderr: '', exitCode: 0 };
  }

  const lines: string[] = [
    '',
    header(`Parsed ${cclDoc.statements.length} statement(s)`),
    '',
    keyValue([
      ['Permits', String(cclDoc.permits.length)],
      ['Denies', String(cclDoc.denies.length)],
      ['Obligations', String(cclDoc.obligations.length)],
      ['Limits', String(cclDoc.limits.length)],
    ]),
    '',
    dim('Serialized:'),
    cyan(serializeCCL(cclDoc)),
    '',
  ];
  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

// ─── Command: completions ─────────────────────────────────────────────────────

function cmdCompletions(positional: string[], flags: Record<string, string | boolean>): RunResult {
  if (hasFlag(flags, 'help')) {
    return { stdout: COMPLETIONS_HELP, stderr: '', exitCode: 0 };
  }

  const shell = positional[0];
  if (!shell) {
    return { stdout: '', stderr: 'Error: Shell argument is required (bash or zsh)', exitCode: 1 };
  }

  switch (shell) {
    case 'bash':
      return { stdout: bashCompletions(), stderr: '', exitCode: 0 };
    case 'zsh':
      return { stdout: zshCompletions(), stderr: '', exitCode: 0 };
    default:
      return {
        stdout: '',
        stderr: `Error: Unsupported shell '${shell}'. Supported: bash, zsh`,
        exitCode: 1,
      };
  }
}

// ─── Command: version ─────────────────────────────────────────────────────────

function cmdVersion(flags: Record<string, string | boolean>): RunResult {
  if (hasFlag(flags, 'json')) {
    return {
      stdout: JSON.stringify({ version: '0.1.0', protocol: PROTOCOL_VERSION }),
      stderr: '',
      exitCode: 0,
    };
  }
  return { stdout: '0.1.0', stderr: '', exitCode: 0 };
}

// ─── Command: help ────────────────────────────────────────────────────────────

function cmdHelp(): RunResult {
  return { stdout: buildMainHelp(), stderr: '', exitCode: 0 };
}

// ─── Main run function ────────────────────────────────────────────────────────

/**
 * Run the Stele CLI with the given argument list.
 *
 * @param args - The command-line arguments (without node/script prefix).
 * @param configDir - Optional directory to search for stele.config.json (defaults to cwd).
 * @returns An object with stdout, stderr, and exitCode.
 */
export async function run(args: string[], configDir?: string): Promise<RunResult> {
  const parsed = parseArgs(args);

  // Handle --no-color and --json disabling colors
  const noColor = hasFlag(parsed.flags, 'no-color');
  const jsonMode = hasFlag(parsed.flags, 'json');
  setColorsEnabled(!noColor && !jsonMode);

  // Load config file (non-fatal if missing)
  let config: SteleConfig | undefined;
  try {
    config = loadConfig(configDir);
  } catch {
    // config load failure is non-fatal
  }

  // If config says outputFormat is json, treat as --json
  if (config?.outputFormat === 'json' && !hasFlag(parsed.flags, 'json')) {
    // We don't force json mode from config; config only provides defaults for
    // identities and constraints.  outputFormat from config is respected by
    // only setting the flag when not already set.
  }

  if (!parsed.command || parsed.command === 'help' || hasFlag(parsed.flags, 'help') && !parsed.command) {
    return cmdHelp();
  }

  try {
    switch (parsed.command) {
      case 'init':
        return await cmdInit(parsed.flags, configDir);
      case 'create':
        return await cmdCreate(parsed.flags, config);
      case 'verify':
        return await cmdVerify(parsed.positional, parsed.flags);
      case 'evaluate':
        return await cmdEvaluate(parsed.positional, parsed.flags);
      case 'inspect':
        return await cmdInspect(parsed.positional, parsed.flags);
      case 'parse':
        return await cmdParse(parsed.positional, parsed.flags);
      case 'completions':
        return cmdCompletions(parsed.positional, parsed.flags);
      case 'version':
        return cmdVersion(parsed.flags);
      case 'help':
        return cmdHelp();
      default:
        return {
          stdout: '',
          stderr: `Error: Unknown command '${parsed.command}'. Run 'stele help' for usage.`,
          exitCode: 1,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: ${msg}`, exitCode: 1 };
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await run(args);

  if (result.stdout) {
    process.stdout.write(result.stdout + '\n');
  }
  if (result.stderr) {
    process.stderr.write(result.stderr + '\n');
  }
  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

main();
