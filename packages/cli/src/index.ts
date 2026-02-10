#!/usr/bin/env node

/**
 * @stele/cli -- Command-line interface for the Stele covenant protocol.
 *
 * Provides commands for key generation, covenant creation, verification,
 * evaluation, inspection, and CCL parsing.
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

const MAIN_HELP = `Stele CLI - Covenant Protocol Tool

Usage: stele <command> [options]

Commands:
  init                          Generate an Ed25519 key pair
  create                        Create and sign a covenant document
  verify <json>                 Verify a covenant document
  evaluate <json> <action> <resource>  Evaluate an action against a covenant
  inspect <json>                Pretty-print covenant details
  parse <ccl>                   Parse CCL and output AST as JSON
  version                       Print version
  help                          Show this help message

Global flags:
  --json                        Machine-readable JSON output
  --help                        Show help for a command`;

const INIT_HELP = `stele init - Generate an Ed25519 key pair and print the public key.

Usage: stele init [--json]

Generates a new key pair and outputs the public key hex string.
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

// ─── Command: init ────────────────────────────────────────────────────────────

async function cmdInit(flags: Record<string, string | boolean>): Promise<RunResult> {
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

  const lines: string[] = [
    'Generated Ed25519 key pair.',
    `Public key: ${publicKeyHex}`,
  ];
  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
}

// ─── Command: create ──────────────────────────────────────────────────────────

async function cmdCreate(flags: Record<string, string | boolean>): Promise<RunResult> {
  if (hasFlag(flags, 'help')) {
    return { stdout: CREATE_HELP, stderr: '', exitCode: 0 };
  }

  const issuerId = getFlag(flags, 'issuer');
  if (!issuerId) {
    return { stdout: '', stderr: 'Error: --issuer <id> is required', exitCode: 1 };
  }

  const beneficiaryId = getFlag(flags, 'beneficiary');
  if (!beneficiaryId) {
    return { stdout: '', stderr: 'Error: --beneficiary <id> is required', exitCode: 1 };
  }

  const constraints = getFlag(flags, 'constraints');
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
    'Covenant created successfully.',
    `ID: ${covenant.id}`,
    `Issuer: ${covenant.issuer.id}`,
    `Beneficiary: ${covenant.beneficiary.id}`,
    `Version: ${covenant.version}`,
    '',
    json,
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

  const lines: string[] = [];
  for (const check of result.checks) {
    const indicator = check.passed ? 'PASS' : 'FAIL';
    lines.push(`[${indicator}] ${check.name}: ${check.message ?? ''}`);
  }
  lines.push('');

  const passed = result.checks.filter((c) => c.passed).length;
  const total = result.checks.length;

  if (result.valid) {
    lines.push(`Valid: ${passed}/${total} checks passed`);
    return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
  } else {
    lines.push(`Invalid: ${passed}/${total} checks passed`);
    return { stdout: lines.join('\n'), stderr: '', exitCode: 1 };
  }
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

  const decision = result.permitted ? 'PERMIT' : 'DENY';
  const lines: string[] = [
    `Action:   ${action}`,
    `Resource: ${resource}`,
    `Decision: ${decision}`,
  ];
  if (result.reason) {
    lines.push(`Reason:   ${result.reason}`);
  }
  if (result.matchedRule) {
    lines.push(`Rule:     ${result.matchedRule.type} (line ${result.matchedRule.line})`);
  }
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

  const lines: string[] = [
    '=== Covenant Inspection ===',
    '',
    `ID:          ${covenant.id}`,
    `Version:     ${covenant.version}`,
    `Created:     ${covenant.createdAt}`,
    '',
    'Issuer:',
    `  ID:        ${covenant.issuer.id}`,
    `  Key:       ${covenant.issuer.publicKey.slice(0, 16)}...`,
  ];

  if (covenant.issuer.name) {
    lines.push(`  Name:      ${covenant.issuer.name}`);
  }

  lines.push('');
  lines.push('Beneficiary:');
  lines.push(`  ID:        ${covenant.beneficiary.id}`);
  lines.push(`  Key:       ${covenant.beneficiary.publicKey.slice(0, 16)}...`);
  if (covenant.beneficiary.name) {
    lines.push(`  Name:      ${covenant.beneficiary.name}`);
  }

  lines.push('');
  lines.push('Constraints:');
  for (const line of covenant.constraints.split('\n')) {
    lines.push(`  ${line}`);
  }

  // Parse to show summary
  try {
    const cclDoc = parse(covenant.constraints);
    lines.push('');
    lines.push('Constraint summary:');
    lines.push(`  Permits:     ${cclDoc.permits.length}`);
    lines.push(`  Denies:      ${cclDoc.denies.length}`);
    lines.push(`  Obligations: ${cclDoc.obligations.length}`);
    lines.push(`  Limits:      ${cclDoc.limits.length}`);
  } catch {
    // CCL parse failure is non-fatal for inspect
  }

  if (covenant.enforcement) {
    lines.push('');
    lines.push(`Enforcement: ${covenant.enforcement.type}`);
  }

  if (covenant.proof) {
    lines.push('');
    lines.push(`Proof: ${covenant.proof.type}`);
  }

  if (covenant.metadata) {
    lines.push('');
    lines.push('Metadata:');
    if (covenant.metadata.name) {
      lines.push(`  Name:  ${covenant.metadata.name}`);
    }
    if (covenant.metadata.description) {
      lines.push(`  Desc:  ${covenant.metadata.description}`);
    }
    if (covenant.metadata.tags && covenant.metadata.tags.length > 0) {
      lines.push(`  Tags:  ${covenant.metadata.tags.join(', ')}`);
    }
  }

  lines.push('');
  lines.push(`Signature: ${covenant.signature.slice(0, 32)}...`);

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
    `Parsed ${cclDoc.statements.length} statement(s):`,
    `  Permits:     ${cclDoc.permits.length}`,
    `  Denies:      ${cclDoc.denies.length}`,
    `  Obligations: ${cclDoc.obligations.length}`,
    `  Limits:      ${cclDoc.limits.length}`,
    '',
    'Serialized:',
    serializeCCL(cclDoc),
  ];
  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
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
  return { stdout: MAIN_HELP, stderr: '', exitCode: 0 };
}

// ─── Main run function ────────────────────────────────────────────────────────

/**
 * Run the Stele CLI with the given argument list.
 *
 * @param args - The command-line arguments (without node/script prefix).
 * @returns An object with stdout, stderr, and exitCode.
 */
export async function run(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);

  if (!parsed.command || parsed.command === 'help' || hasFlag(parsed.flags, 'help') && !parsed.command) {
    return cmdHelp();
  }

  try {
    switch (parsed.command) {
      case 'init':
        return await cmdInit(parsed.flags);
      case 'create':
        return await cmdCreate(parsed.flags);
      case 'verify':
        return await cmdVerify(parsed.positional, parsed.flags);
      case 'evaluate':
        return await cmdEvaluate(parsed.positional, parsed.flags);
      case 'inspect':
        return await cmdInspect(parsed.positional, parsed.flags);
      case 'parse':
        return await cmdParse(parsed.positional, parsed.flags);
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
