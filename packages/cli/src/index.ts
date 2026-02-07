#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  generateKeyPair,
  keyPairFromPrivateKeyHex,
  toHex,
  timestamp,
} from '@stele/crypto';

import type { KeyPair } from '@stele/crypto';

import { parse, evaluate, serialize } from '@stele/ccl';

import {
  buildCovenant,
  verifyCovenant,
  resignCovenant,
  deserializeCovenant,
  serializeCovenant,
  computeId,
  canonicalForm,
  PROTOCOL_VERSION,
} from '@stele/core';

import type { CovenantDocument } from '@stele/core';

import {
  createIdentity,
  evolveIdentity,
  verifyIdentity,
  serializeIdentity,
  deserializeIdentity,
} from '@stele/identity';

import type { AgentIdentity } from '@stele/identity';

// ─── Minimal argument parser ──────────────────────────────────────────────────

interface ParsedArgs {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path, rest is user args
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = '';
  let subcommand: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      // If next arg exists and doesn't start with --, treat it as the value
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
    } else if (subcommand === undefined && !arg.startsWith('-')) {
      // Could be a subcommand or positional arg
      // For 'identity create', 'identity evolve' treat second word as subcommand
      if (command === 'identity' && (arg === 'create' || arg === 'evolve')) {
        subcommand = arg;
        i += 1;
      } else {
        positional.push(arg);
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { command, subcommand, positional, flags };
}

function getFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const val = flags[key];
  if (val === undefined || typeof val === 'boolean') return undefined;
  return val;
}

function requireFlag(flags: Record<string, string | boolean>, key: string, description: string): string {
  const val = getFlag(flags, key);
  if (!val) {
    fatal(`Missing required option: --${key} <${description}>`);
  }
  return val;
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function info(msg: string): void {
  process.stdout.write(msg + '\n');
}

function success(msg: string): void {
  process.stdout.write(`[OK] ${msg}\n`);
}

function fatal(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function printHeader(title: string): void {
  info('');
  info(`=== ${title} ===`);
  info('');
}

// ─── File I/O helpers ─────────────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T> {
  const resolved = path.resolve(filePath);
  try {
    const content = await fs.readFile(resolved, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Failed to read file '${resolved}': ${msg}`);
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const resolved = path.resolve(filePath);
  const content = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(resolved, content, 'utf-8');
}

async function loadCovenant(filePath: string): Promise<CovenantDocument> {
  const content = await fs.readFile(path.resolve(filePath), 'utf-8');
  try {
    return deserializeCovenant(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Failed to parse covenant from '${filePath}': ${msg}`);
  }
}

async function loadKeyPair(keyFile: string): Promise<KeyPair> {
  const keyData = await readJsonFile<{ privateKeyHex: string }>(keyFile);
  if (!keyData.privateKeyHex) {
    fatal(`Key file '${keyFile}' does not contain a privateKeyHex field`);
  }
  try {
    return await keyPairFromPrivateKeyHex(keyData.privateKeyHex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Failed to load key from '${keyFile}': ${msg}`);
  }
}

// ─── Default CCL constraints (standard:minimal preset) ────────────────────────

const MINIMAL_CONSTRAINTS = `permit ** on '**'
deny data.delete on '/system/**'
require audit.log on '**'`;

// ─── Command: init ────────────────────────────────────────────────────────────

async function cmdInit(parsed: ParsedArgs): Promise<void> {
  const id = getFlag(parsed.flags, 'id') ?? 'default';
  const outFile = getFlag(parsed.flags, 'out') ?? 'covenant.json';
  const keyFileName = `${id}.key.json`;

  printHeader('Initializing Stele Covenant');

  // Generate keypair
  info('Generating Ed25519 keypair...');
  const keyPair = await generateKeyPair();
  const privateKeyHex = toHex(keyPair.privateKey);

  // Save private key
  await writeJsonFile(keyFileName, {
    id,
    privateKeyHex,
    publicKeyHex: keyPair.publicKeyHex,
    createdAt: timestamp(),
  });
  success(`Private key saved to ${keyFileName}`);

  // Build skeleton covenant
  info('Building covenant with standard:minimal constraints...');

  const covenant = await buildCovenant({
    issuer: {
      id,
      publicKey: keyPair.publicKeyHex,
      role: 'issuer',
      name: id,
    },
    beneficiary: {
      id: `${id}-beneficiary`,
      publicKey: keyPair.publicKeyHex,
      role: 'beneficiary',
      name: `${id} beneficiary`,
    },
    constraints: MINIMAL_CONSTRAINTS,
    privateKey: keyPair.privateKey,
    enforcement: {
      type: 'monitor',
      config: { mode: 'enforce' },
      description: 'Runtime constraint monitor',
    },
    proof: {
      type: 'audit_log',
      config: { format: 'merkle_chain' },
      description: 'Tamper-evident audit log with Merkle proofs',
    },
    metadata: {
      name: `${id} covenant`,
      description: 'Auto-generated covenant via stele init',
      tags: ['auto-generated'],
    },
  });

  // Save covenant
  await writeJsonFile(outFile, JSON.parse(serializeCovenant(covenant)));
  success(`Covenant saved to ${outFile}`);

  info('');
  info(`  Covenant ID: ${covenant.id}`);
  info(`  Issuer:      ${covenant.issuer.id}`);
  info(`  Public Key:  ${keyPair.publicKeyHex.slice(0, 16)}...`);
  info(`  Version:     ${covenant.version}`);
  info('');
  info(`Next steps:`);
  info(`  stele verify ${outFile}     - Verify the covenant`);
  info(`  stele inspect ${outFile}    - Inspect covenant details`);
  info(`  stele sign ${outFile} --key ${keyFileName}  - Re-sign after edits`);
}

// ─── Command: sign ────────────────────────────────────────────────────────────

async function cmdSign(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positional[0];
  if (!file) {
    fatal('Usage: stele sign <file> --key <keyfile>');
  }

  const keyFile = requireFlag(parsed.flags, 'key', 'keyfile');

  printHeader('Signing Covenant');

  // Load key and covenant
  const keyPair = await loadKeyPair(keyFile);
  info(`Loaded key from ${keyFile}`);

  const covenant = await loadCovenant(file);
  info(`Loaded covenant from ${file}`);
  info(`  Current ID: ${covenant.id}`);

  // Re-sign
  info('Re-signing covenant...');
  const resigned = await resignCovenant(covenant, keyPair.privateKey);

  // Save back
  await writeJsonFile(file, JSON.parse(serializeCovenant(resigned)));
  success(`Covenant re-signed and saved to ${file}`);

  info('');
  info(`  New ID:      ${resigned.id}`);
  info(`  Signature:   ${resigned.signature.slice(0, 32)}...`);
  info(`  Nonce:       ${resigned.nonce.slice(0, 16)}...`);
}

// ─── Command: verify ──────────────────────────────────────────────────────────

async function cmdVerify(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positional[0];
  if (!file) {
    fatal('Usage: stele verify <file>');
  }

  printHeader('Verifying Covenant');

  const covenant = await loadCovenant(file);
  info(`Loaded covenant from ${file}`);
  info(`  ID: ${covenant.id}`);
  info('');

  const result = await verifyCovenant(covenant);

  // Print each check
  const maxNameLen = Math.max(...result.checks.map((c) => c.name.length));

  for (const check of result.checks) {
    const indicator = check.passed ? 'PASS' : 'FAIL';
    const paddedName = check.name.padEnd(maxNameLen);
    const msg = check.message ?? '';
    info(`  [${indicator}] ${paddedName}  ${msg}`);
  }

  info('');

  const passed = result.checks.filter((c) => c.passed).length;
  const total = result.checks.length;

  if (result.valid) {
    success(`Covenant is valid (${passed}/${total} checks passed)`);
  } else {
    const failed = result.checks.filter((c) => !c.passed);
    info(`INVALID: Covenant verification failed (${passed}/${total} checks passed)`);
    info('');
    info('Failed checks:');
    for (const check of failed) {
      info(`  - ${check.name}: ${check.message ?? 'no details'}`);
    }
    process.exit(1);
  }
}

// ─── Command: evaluate ────────────────────────────────────────────────────────

async function cmdEvaluate(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positional[0];
  if (!file) {
    fatal('Usage: stele evaluate <file> --action <action> --resource <resource>');
  }

  const action = requireFlag(parsed.flags, 'action', 'action');
  const resource = requireFlag(parsed.flags, 'resource', 'resource');

  printHeader('Evaluating Action');

  const covenant = await loadCovenant(file);
  info(`Loaded covenant from ${file}`);

  // Parse the CCL constraints
  const cclDoc = parse(covenant.constraints);
  info(`Parsed ${cclDoc.statements.length} constraint statement(s)`);
  info('');

  // Evaluate
  const result = evaluate(cclDoc, action, resource);

  const decision = result.permitted ? 'PERMIT' : 'DENY';
  info(`  Action:    ${action}`);
  info(`  Resource:  ${resource}`);
  info(`  Decision:  ${decision}`);
  info('');

  if (result.reason) {
    info(`  Reason:    ${result.reason}`);
  }

  if (result.severity) {
    info(`  Severity:  ${result.severity}`);
  }

  if (result.matchedRule) {
    info('');
    info('  Matched rule:');
    const rule = result.matchedRule;
    info(`    Type:     ${rule.type}`);
    if ('action' in rule) {
      info(`    Action:   ${rule.action}`);
    }
    if ('resource' in rule) {
      info(`    Resource: ${(rule as { resource: string }).resource}`);
    }
    info(`    Severity: ${rule.severity}`);
    info(`    Line:     ${rule.line}`);
  }

  if (result.allMatches.length > 1) {
    info('');
    info(`  All matching rules (${result.allMatches.length}):`);
    for (const match of result.allMatches) {
      const rType = match.type.toUpperCase();
      if ('resource' in match) {
        info(`    - [${rType}] ${match.action} on ${(match as { resource: string }).resource}`);
      } else {
        info(`    - [${rType}] ${match.action}`);
      }
    }
  }

  if (!result.permitted) {
    process.exit(1);
  }
}

// ─── Command: inspect ─────────────────────────────────────────────────────────

async function cmdInspect(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positional[0];
  if (!file) {
    fatal('Usage: stele inspect <file>');
  }

  printHeader('Covenant Inspection');

  const covenant = await loadCovenant(file);

  info(`  ID:           ${covenant.id}`);
  info(`  Version:      ${covenant.version}`);
  info(`  Created:      ${covenant.createdAt}`);
  info('');

  // Issuer
  info('  Issuer:');
  info(`    ID:         ${covenant.issuer.id}`);
  info(`    Public Key: ${covenant.issuer.publicKey.slice(0, 32)}...`);
  if (covenant.issuer.name) {
    info(`    Name:       ${covenant.issuer.name}`);
  }
  info('');

  // Beneficiary
  info('  Beneficiary:');
  info(`    ID:         ${covenant.beneficiary.id}`);
  info(`    Public Key: ${covenant.beneficiary.publicKey.slice(0, 32)}...`);
  if (covenant.beneficiary.name) {
    info(`    Name:       ${covenant.beneficiary.name}`);
  }
  info('');

  // Enforcement
  if (covenant.enforcement) {
    info(`  Enforcement:  ${covenant.enforcement.type}`);
    if (covenant.enforcement.description) {
      info(`    Desc:       ${covenant.enforcement.description}`);
    }
  } else {
    info('  Enforcement:  (none)');
  }

  // Proof
  if (covenant.proof) {
    info(`  Proof:        ${covenant.proof.type}`);
    if (covenant.proof.description) {
      info(`    Desc:       ${covenant.proof.description}`);
    }
  } else {
    info('  Proof:        (none)');
  }
  info('');

  // Constraints
  info('  Constraints:');
  const constraintLines = covenant.constraints.split('\n');
  for (const line of constraintLines) {
    info(`    ${line}`);
  }
  info('');

  // Parse to show summary
  try {
    const cclDoc = parse(covenant.constraints);
    info(`  Constraint summary:`);
    info(`    Permits:      ${cclDoc.permits.length}`);
    info(`    Denies:       ${cclDoc.denies.length}`);
    info(`    Obligations:  ${cclDoc.obligations.length}`);
    info(`    Limits:       ${cclDoc.limits.length}`);
    info('');
  } catch {
    info('  (Could not parse constraints for summary)');
    info('');
  }

  // Obligations
  if (covenant.obligations && covenant.obligations.length > 0) {
    info('  Obligations:');
    for (const obl of covenant.obligations) {
      info(`    - ${obl.id}: ${obl.description}`);
      if (obl.deadline) {
        info(`      Deadline: ${obl.deadline}`);
      }
    }
    info('');
  }

  // Chain
  if (covenant.chain) {
    info('  Chain:');
    info(`    Parent ID:  ${covenant.chain.parentId}`);
    info(`    Relation:   ${covenant.chain.relation}`);
    info(`    Depth:      ${covenant.chain.depth}`);
    info('');
  }

  // Expiry / Activation
  if (covenant.expiresAt) {
    info(`  Expires:      ${covenant.expiresAt}`);
  }
  if (covenant.activatesAt) {
    info(`  Activates:    ${covenant.activatesAt}`);
  }

  // Metadata
  if (covenant.metadata) {
    info('  Metadata:');
    if (covenant.metadata.name) {
      info(`    Name:       ${covenant.metadata.name}`);
    }
    if (covenant.metadata.description) {
      info(`    Desc:       ${covenant.metadata.description}`);
    }
    if (covenant.metadata.tags && covenant.metadata.tags.length > 0) {
      info(`    Tags:       ${covenant.metadata.tags.join(', ')}`);
    }
    if (covenant.metadata.version) {
      info(`    Version:    ${covenant.metadata.version}`);
    }
  }

  // Countersignatures
  if (covenant.countersignatures && covenant.countersignatures.length > 0) {
    info('');
    info(`  Countersignatures: ${covenant.countersignatures.length}`);
    for (const cs of covenant.countersignatures) {
      info(`    - Role: ${cs.signerRole}, Key: ${cs.signerPublicKey.slice(0, 16)}..., Time: ${cs.timestamp}`);
    }
  }

  // Signature
  info('');
  info(`  Signature:    ${covenant.signature.slice(0, 32)}...`);
  info(`  Nonce:        ${covenant.nonce.slice(0, 16)}...`);
}

// ─── Command: identity create ─────────────────────────────────────────────────

async function cmdIdentityCreate(parsed: ParsedArgs): Promise<void> {
  const keyFile = requireFlag(parsed.flags, 'operator-key', 'keyfile');
  const modelStr = requireFlag(parsed.flags, 'model', 'provider:modelId');

  printHeader('Creating Agent Identity');

  // Parse model string
  const colonIdx = modelStr.indexOf(':');
  if (colonIdx === -1) {
    fatal('Model must be in format provider:modelId (e.g. anthropic:claude-3)');
  }
  const provider = modelStr.slice(0, colonIdx);
  const modelId = modelStr.slice(colonIdx + 1);

  // Load operator key
  const keyPair = await loadKeyPair(keyFile);
  info(`Loaded operator key from ${keyFile}`);

  // Create identity
  info('Creating agent identity...');
  const identity = await createIdentity({
    operatorKeyPair: keyPair,
    model: {
      provider,
      modelId,
      attestationType: 'self_reported',
    },
    capabilities: ['text.generate', 'text.analyze'],
    deployment: {
      runtime: 'process',
    },
  });

  // Save to identity.json
  const outFile = getFlag(parsed.flags, 'out') ?? 'identity.json';
  await writeJsonFile(outFile, JSON.parse(serializeIdentity(identity)));
  success(`Identity saved to ${outFile}`);

  info('');
  info(`  Identity ID:    ${identity.id}`);
  info(`  Operator Key:   ${identity.operatorPublicKey.slice(0, 16)}...`);
  info(`  Model:          ${identity.model.provider}:${identity.model.modelId}`);
  info(`  Version:        ${identity.version}`);
  info(`  Capabilities:   ${identity.capabilities.join(', ')}`);
  info(`  Runtime:        ${identity.deployment.runtime}`);
}

// ─── Command: identity evolve ─────────────────────────────────────────────────

async function cmdIdentityEvolve(parsed: ParsedArgs): Promise<void> {
  const file = parsed.positional[0];
  if (!file) {
    fatal('Usage: stele identity evolve <file> --change <changeType> --model <provider:modelId>');
  }

  const changeType = requireFlag(parsed.flags, 'change', 'changeType');
  const validChangeTypes = ['model_update', 'capability_change', 'operator_transfer', 'fork', 'merge'];
  if (!validChangeTypes.includes(changeType)) {
    fatal(`Invalid change type: ${changeType}. Must be one of: ${validChangeTypes.join(', ')}`);
  }

  printHeader('Evolving Agent Identity');

  // Load identity
  const content = await fs.readFile(path.resolve(file), 'utf-8');
  let identity: AgentIdentity;
  try {
    identity = deserializeIdentity(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`Failed to parse identity from '${file}': ${msg}`);
  }
  info(`Loaded identity from ${file}`);
  info(`  Current version: ${identity.version}`);

  // Load operator key -- try --operator-key or --key
  const keyFile = getFlag(parsed.flags, 'operator-key') ?? getFlag(parsed.flags, 'key');
  if (!keyFile) {
    fatal('Missing required option: --operator-key <keyfile> (or --key <keyfile>)');
  }
  const keyPair = await loadKeyPair(keyFile);
  info(`Loaded operator key from ${keyFile}`);

  // Build updates based on change type
  const updates: Record<string, unknown> = {};
  let description = `Identity ${changeType}`;

  if (changeType === 'model_update') {
    const modelStr = getFlag(parsed.flags, 'model');
    if (!modelStr) {
      fatal('--model <provider:modelId> is required for model_update');
    }
    const colonIdx = modelStr.indexOf(':');
    if (colonIdx === -1) {
      fatal('Model must be in format provider:modelId');
    }
    updates.model = {
      provider: modelStr.slice(0, colonIdx),
      modelId: modelStr.slice(colonIdx + 1),
      attestationType: 'self_reported',
    };
    description = `Model updated to ${modelStr}`;
  }

  if (changeType === 'capability_change') {
    const capStr = getFlag(parsed.flags, 'capabilities');
    if (capStr) {
      updates.capabilities = capStr.split(',').map((c) => c.trim());
    }
    description = 'Capabilities updated';
  }

  // Evolve
  info('Evolving identity...');
  const evolved = await evolveIdentity(identity, {
    operatorKeyPair: keyPair,
    changeType: changeType as 'model_update' | 'capability_change' | 'operator_transfer' | 'fork' | 'merge',
    description,
    updates,
  });

  // Save back
  await writeJsonFile(file, JSON.parse(serializeIdentity(evolved)));
  success(`Identity evolved and saved to ${file}`);

  info('');
  info(`  New ID:       ${evolved.id}`);
  info(`  New Version:  ${evolved.version}`);
  info(`  Change:       ${changeType}`);
  info(`  Lineage:      ${evolved.lineage.length} entries`);

  // Verify the evolved identity
  const verifyResult = await verifyIdentity(evolved);
  if (verifyResult.valid) {
    success('Evolved identity passes all verification checks');
  } else {
    info('WARNING: Evolved identity has verification issues:');
    for (const check of verifyResult.checks.filter((c) => !c.passed)) {
      info(`  - ${check.name}: ${check.message}`);
    }
  }
}

// ─── Command: help ────────────────────────────────────────────────────────────

function cmdHelp(): void {
  info('');
  info('Stele CLI - Covenant SDK Developer Tool');
  info('');
  info('Usage: stele <command> [options]');
  info('');
  info('Commands:');
  info('');
  info('  init                          Initialize a new covenant');
  info('    --id <id>                     Identifier for the covenant (default: "default")');
  info('    --out <file>                  Output file (default: covenant.json)');
  info('');
  info('  sign <file>                   Sign or re-sign a covenant');
  info('    --key <keyfile>               Private key file (required)');
  info('');
  info('  verify <file>                 Verify a covenant');
  info('');
  info('  evaluate <file>               Evaluate an action against constraints');
  info('    --action <action>             Action to evaluate (required)');
  info('    --resource <resource>         Resource to evaluate (required)');
  info('');
  info('  inspect <file>                Pretty-print covenant details');
  info('');
  info('  identity create               Create a new agent identity');
  info('    --operator-key <keyfile>      Operator key file (required)');
  info('    --model <provider:modelId>    Model specification (required)');
  info('    --out <file>                  Output file (default: identity.json)');
  info('');
  info('  identity evolve <file>        Evolve an existing identity');
  info('    --operator-key <keyfile>      Operator key file (required)');
  info('    --change <type>               Change type: model_update, capability_change,');
  info('                                  operator_transfer, fork, merge');
  info('    --model <provider:modelId>    New model (for model_update)');
  info('    --capabilities <list>         Comma-separated capabilities (for capability_change)');
  info('');
  info('  help                          Show this help message');
  info('  version                       Show version information');
  info('');
}

// ─── Command: version ─────────────────────────────────────────────────────────

function cmdVersion(): void {
  info(`stele-cli v0.1.0`);
  info(`protocol: ${PROTOCOL_VERSION}`);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (!parsed.command || parsed.command === 'help' || parsed.flags['help'] !== undefined) {
    cmdHelp();
    return;
  }

  if (parsed.command === 'version' || parsed.flags['version'] !== undefined) {
    cmdVersion();
    return;
  }

  try {
    switch (parsed.command) {
      case 'init':
        await cmdInit(parsed);
        break;

      case 'sign':
        await cmdSign(parsed);
        break;

      case 'verify':
        await cmdVerify(parsed);
        break;

      case 'evaluate':
        await cmdEvaluate(parsed);
        break;

      case 'inspect':
        await cmdInspect(parsed);
        break;

      case 'identity':
        if (parsed.subcommand === 'create') {
          await cmdIdentityCreate(parsed);
        } else if (parsed.subcommand === 'evolve') {
          await cmdIdentityEvolve(parsed);
        } else {
          fatal(`Unknown identity subcommand: '${parsed.subcommand ?? '(none)'}'. Use 'identity create' or 'identity evolve'.`);
        }
        break;

      default:
        fatal(`Unknown command: '${parsed.command}'. Run 'stele help' for usage.`);
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      fatal(`File not found: ${(err as NodeJS.ErrnoException).path ?? err.message}`);
    }
    if (err instanceof Error) {
      fatal(err.message);
    }
    fatal(String(err));
  }
}

main();


