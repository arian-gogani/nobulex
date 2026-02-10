/**
 * Comprehensive E2E tests for the Stele CLI.
 *
 * Tests the CLI programmatically via the `run()` function from `@stele/cli`,
 * covering all available commands: init, create, verify, evaluate, inspect,
 * parse, completions, doctor, diff, version, and help.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run } from '@stele/cli';
import { buildCovenant, serializeCovenant } from '@stele/core';
import { generateKeyPair } from '@stele/crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create and return a fresh temporary directory for test isolation. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stele-cli-test-'));
}

/** Remove a temporary directory and all its contents. */
function cleanTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a valid, signed covenant JSON string for use in tests.
 * Accepts optional custom constraints (defaults to a simple permit-all rule).
 */
async function makeCovenantJson(
  constraints = "permit read on '**'",
): Promise<string> {
  const kp = await generateKeyPair();
  const doc = await buildCovenant({
    issuer: {
      id: 'test-issuer',
      publicKey: kp.publicKeyHex,
      role: 'issuer',
      name: 'Test Issuer',
    },
    beneficiary: {
      id: 'test-beneficiary',
      publicKey: kp.publicKeyHex,
      role: 'beneficiary',
      name: 'Test Beneficiary',
    },
    constraints,
    privateKey: kp.privateKey,
  });
  return serializeCovenant(doc);
}

/**
 * Strip ANSI escape codes from a string so assertions
 * can match plain text regardless of color settings.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ===========================================================================
// 1. CLI help and version
// ===========================================================================

describe('CLI help and version', () => {
  it('run(["help"]) returns exitCode 0 and stdout lists all commands', async () => {
    const r = await run(['help']);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Stele CLI');
    expect(plain).toContain('Commands');
    expect(plain).toContain('init');
    expect(plain).toContain('create');
    expect(plain).toContain('verify');
    expect(plain).toContain('evaluate');
    expect(plain).toContain('inspect');
    expect(plain).toContain('parse');
    expect(plain).toContain('completions');
    expect(plain).toContain('doctor');
    expect(plain).toContain('diff');
    expect(plain).toContain('version');
  });

  it('run(["version"]) returns exitCode 0 and stdout contains a version string', async () => {
    const r = await run(['version']);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    // The version should look like semver (e.g. "0.1.0")
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('run(["--help"]) works the same as run(["help"])', async () => {
    const r = await run(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Stele CLI');
    expect(plain).toContain('Commands');
  });

  it('run(["help", "create"]) shows create subcommand help', async () => {
    const r = await run(['create', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('stele create');
    expect(r.stdout).toContain('--issuer');
    expect(r.stdout).toContain('--beneficiary');
    expect(r.stdout).toContain('--constraints');
  });

  it('unknown command returns non-zero exitCode', async () => {
    const r = await run(['nonexistent-command']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('Unknown command');
    expect(r.stderr).toContain('nonexistent-command');
  });
});

// ===========================================================================
// 2. CLI init
// ===========================================================================

describe('CLI init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('run(["init"], tmpDir) creates a config file in the temp directory', async () => {
    const r = await run(['init'], tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const configPath = path.join(tmpDir, 'stele.config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.defaultIssuer).toBeDefined();
    expect(config.defaultIssuer.publicKey).toHaveLength(64);
    expect(config.outputFormat).toBe('text');
  });

  it('running init twice overwrites gracefully without error', async () => {
    const r1 = await run(['init'], tmpDir);
    expect(r1.exitCode).toBe(0);
    const config1 = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'stele.config.json'), 'utf-8'),
    );

    const r2 = await run(['init'], tmpDir);
    expect(r2.exitCode).toBe(0);
    const config2 = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'stele.config.json'), 'utf-8'),
    );

    // The second init generates a new key pair, so public keys differ
    expect(config1.defaultIssuer.publicKey).not.toBe(
      config2.defaultIssuer.publicKey,
    );
  });

  it('the generated config file contains a valid public key hex string', async () => {
    await run(['init'], tmpDir);
    const configPath = path.join(tmpDir, 'stele.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // 64 hex chars = 32 bytes = Ed25519 public key
    expect(config.defaultIssuer.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('init --json outputs key pair as JSON without writing to disk errors', async () => {
    const r = await run(['init', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.publicKey).toBe('string');
    expect(typeof parsed.privateKey).toBe('string');
    expect(parsed.publicKey).toHaveLength(64);
    expect(parsed.privateKey).toHaveLength(64);
  });

  it('init --help shows usage information', async () => {
    const r = await run(['init', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele init');
    expect(r.stdout).toContain('Generate');
  });
});

// ===========================================================================
// 3. CLI create + verify flow
// ===========================================================================

describe('CLI create + verify flow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('init, then create a covenant, then verify it succeeds', async () => {
    // Step 1: Init to get a config
    const initResult = await run(['init'], tmpDir);
    expect(initResult.exitCode).toBe(0);

    // Step 2: Create a covenant
    const createResult = await run(
      [
        'create',
        '--issuer', 'alice',
        '--beneficiary', 'bob',
        '--constraints', "permit read on '**'",
        '--json',
      ],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);
    const covenantJson = createResult.stdout;
    const parsed = JSON.parse(covenantJson);
    expect(parsed.issuer.id).toBe('alice');
    expect(parsed.beneficiary.id).toBe('bob');

    // Step 3: Verify the covenant
    const verifyResult = await run(['verify', covenantJson, '--json']);
    expect(verifyResult.exitCode).toBe(0);
    const verification = JSON.parse(verifyResult.stdout);
    expect(verification.valid).toBe(true);
  });

  it('create with custom multi-statement constraints', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '/data/**'\ndeny write on '/system/**'",
      '--json',
    ]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.constraints).toContain('permit read');
    expect(parsed.constraints).toContain('deny write');
  });

  it('create outputs formatted text without --json', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(stripAnsi(r.stdout)).toContain('Covenant created successfully.');
    expect(stripAnsi(r.stdout)).toContain('alice');
    expect(stripAnsi(r.stdout)).toContain('bob');
  });

  it('verify a valid covenant file returns all checks passing', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json, '--json']);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    for (const check of result.checks) {
      expect(check.passed).toBe(true);
    }
  });

  it('verify a tampered covenant fails verification', async () => {
    const json = await makeCovenantJson();
    const obj = JSON.parse(json);
    // Tamper with constraints to invalidate the signature
    obj.constraints = "deny write on '**'";
    const tampered = JSON.stringify(obj);

    const r = await run(['verify', tampered, '--json']);
    expect(r.exitCode).toBe(1);
    const result = JSON.parse(r.stdout);
    expect(result.valid).toBe(false);

    // At minimum, the id_match and signature_valid checks should fail
    const failedNames = result.checks
      .filter((c: { passed: boolean }) => !c.passed)
      .map((c: { name: string }) => c.name);
    expect(failedNames).toContain('id_match');
    expect(failedNames).toContain('signature_valid');
  });

  it('create without --issuer fails with error message', async () => {
    const r = await run([
      'create',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--issuer');
  });

  it('create without --beneficiary fails with error message', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--beneficiary');
  });

  it('create without --constraints fails with error message', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--constraints');
  });

  it('create with invalid CCL constraints fails', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', '!!!this is not valid CCL!!!',
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid CCL');
  });

  it('verify without a JSON argument fails', async () => {
    const r = await run(['verify']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Covenant JSON string is required');
  });
});

// ===========================================================================
// 4. CLI evaluate
// ===========================================================================

describe('CLI evaluate', () => {
  it('evaluate a permitted action returns exitCode 0 and PERMITTED', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data/file.txt', '--json']);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.permitted).toBe(true);
    expect(result.action).toBe('read');
    expect(result.resource).toBe('/data/file.txt');
  });

  it('evaluate a denied action returns exitCode 1 and DENIED', async () => {
    const json = await makeCovenantJson("deny write on '/system/**'");
    const r = await run([
      'evaluate', json, 'write', '/system/config', '--json',
    ]);
    expect(r.exitCode).toBe(1);
    const result = JSON.parse(r.stdout);
    expect(result.permitted).toBe(false);
    expect(result.action).toBe('write');
    expect(result.resource).toBe('/system/config');
  });

  it('evaluate with formatted text output contains decision keywords', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data']);
    expect(r.exitCode).toBe(0);
    expect(stripAnsi(r.stdout)).toContain('PERMITTED');
    expect(stripAnsi(r.stdout)).toContain('read');
    expect(stripAnsi(r.stdout)).toContain('/data');
  });

  it('evaluate with missing covenant JSON shows error', async () => {
    const r = await run(['evaluate']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Covenant JSON string is required');
  });

  it('evaluate with missing action shows error', async () => {
    const json = await makeCovenantJson();
    const r = await run(['evaluate', json]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Action is required');
  });
});

// ===========================================================================
// 5. CLI inspect + parse
// ===========================================================================

describe('CLI inspect + parse', () => {
  it('inspect a covenant file shows its fields', async () => {
    const json = await makeCovenantJson(
      "permit read on '**'\ndeny write on '/system/**'",
    );
    const r = await run(['inspect', json, '--json']);
    expect(r.exitCode).toBe(0);
    const inspected = JSON.parse(r.stdout);
    expect(inspected.id).toBeDefined();
    expect(inspected.issuer).toBeDefined();
    expect(inspected.issuer.id).toBe('test-issuer');
    expect(inspected.beneficiary).toBeDefined();
    expect(inspected.beneficiary.id).toBe('test-beneficiary');
    expect(inspected.constraints).toContain('permit read');
    expect(inspected.constraints).toContain('deny write');
  });

  it('inspect with formatted text output contains covenant details', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['inspect', json]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Covenant Inspection');
    expect(plain).toContain('test-issuer');
    expect(plain).toContain('test-beneficiary');
    expect(plain).toContain('Parties');
    expect(plain).toContain('Constraints');
    expect(plain).toContain('Signature:');
  });

  it('parse a valid CCL string shows the AST', async () => {
    const r = await run([
      'parse',
      "permit read on '**'\ndeny write on '/system/**'",
      '--json',
    ]);
    expect(r.exitCode).toBe(0);
    const ast = JSON.parse(r.stdout);
    expect(ast.statements).toBeDefined();
    expect(ast.statements.length).toBe(2);
    expect(ast.permits.length).toBe(1);
    expect(ast.denies.length).toBe(1);
  });

  it('parse with formatted text output shows statement summary', async () => {
    const r = await run(['parse', "permit read on '**'"]);
    expect(r.exitCode).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Parsed 1 statement(s)');
    expect(plain).toContain('Permits');
    expect(plain).toContain('Serialized:');
  });

  it('parse invalid CCL shows error and non-zero exit', async () => {
    const r = await run(['parse', '!!!not valid CCL!!!']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('CCL parse error');
  });
});

// ===========================================================================
// 6. CLI doctor
// ===========================================================================

describe('CLI doctor', () => {
  it('doctor runs health checks and returns exitCode 0 when healthy', async () => {
    const r = await run(['doctor', '--json']);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('doctor output includes expected check categories', async () => {
    const r = await run(['doctor', '--json']);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout);
    const checkNames = result.checks.map(
      (c: { name: string }) => c.name,
    );
    expect(checkNames).toContain('Node.js version');
    expect(checkNames).toContain('Package imports');
    expect(checkNames).toContain('Crypto');
    expect(checkNames).toContain('Core');
    expect(checkNames).toContain('CCL');
  });

  it('doctor formatted output contains summary', async () => {
    const r = await run(['doctor']);
    expect(r.exitCode).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Stele Doctor');
    expect(plain).toContain('Summary');
    expect(plain).toContain('passed');
  });
});

// ===========================================================================
// 7. CLI error handling
// ===========================================================================

describe('CLI error handling', () => {
  it('missing required args for verify shows a clear error', async () => {
    const r = await run(['verify']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('required');
  });

  it('invalid JSON string for verify shows parse error', async () => {
    const r = await run(['verify', 'not-valid-json']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid covenant JSON');
  });

  it('malformed JSON input for evaluate shows error', async () => {
    const r = await run(['evaluate', '{bad json}', 'read', '/data']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid covenant JSON');
  });

  it('empty args shows help (exitCode 0)', async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(0);
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Stele CLI');
    expect(plain).toContain('Commands');
  });

  it('evaluate with missing resource argument shows error', async () => {
    const json = await makeCovenantJson();
    const r = await run(['evaluate', json, 'read']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Resource is required');
  });
});

// ===========================================================================
// 8. Additional integration: round-trip create -> verify -> evaluate -> inspect
// ===========================================================================

describe('full round-trip workflow', () => {
  it('creates, verifies, evaluates, and inspects a covenant end-to-end', async () => {
    // 1. Create a covenant with both permit and deny rules
    const createResult = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints',
      "permit read on '**'\ndeny data.delete on '/system/**'",
      '--json',
    ]);
    expect(createResult.exitCode).toBe(0);
    const covenantJson = createResult.stdout;

    // 2. Verify the created covenant
    const verifyResult = await run(['verify', covenantJson, '--json']);
    expect(verifyResult.exitCode).toBe(0);
    const verification = JSON.parse(verifyResult.stdout);
    expect(verification.valid).toBe(true);

    // 3. Evaluate a permitted action
    const evalPermit = await run([
      'evaluate', covenantJson, 'read', '/data/file.txt', '--json',
    ]);
    expect(evalPermit.exitCode).toBe(0);
    expect(JSON.parse(evalPermit.stdout).permitted).toBe(true);

    // 4. Evaluate a denied action
    const evalDeny = await run([
      'evaluate', covenantJson, 'data.delete', '/system/config', '--json',
    ]);
    expect(evalDeny.exitCode).toBe(1);
    expect(JSON.parse(evalDeny.stdout).permitted).toBe(false);

    // 5. Inspect the covenant
    const inspectResult = await run(['inspect', covenantJson, '--json']);
    expect(inspectResult.exitCode).toBe(0);
    const inspected = JSON.parse(inspectResult.stdout);
    expect(inspected.issuer.id).toBe('alice');
    expect(inspected.beneficiary.id).toBe('bob');
    expect(inspected.constraints).toContain('permit read');
    expect(inspected.constraints).toContain('deny data.delete');
  });
});

// ===========================================================================
// 9. CLI diff
// ===========================================================================

describe('CLI diff', () => {
  it('shows differences between two covenants', async () => {
    const json1 = await makeCovenantJson("permit read on '**'");
    const json2 = await makeCovenantJson("permit write on '**'");
    const r = await run(['diff', json1, json2, '--json']);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.identical).toBe(false);
    expect(result.changes.constraints).toBeDefined();
  });

  it('diff without two arguments returns error', async () => {
    const r = await run(['diff']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Two covenant JSON strings are required');
  });

  it('diff with invalid first JSON returns error', async () => {
    const validJson = await makeCovenantJson();
    const r = await run(['diff', 'not-json', validJson]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid first covenant JSON');
  });
});

// ===========================================================================
// 10. CLI completions
// ===========================================================================

describe('CLI completions', () => {
  it('generates bash completions', async () => {
    const r = await run(['completions', 'bash']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('_stele_completions');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('create');
  });

  it('fails for unsupported shell', async () => {
    const r = await run(['completions', 'powershell']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Unsupported shell');
  });
});

// ===========================================================================
// 11. --json flag produces clean JSON across all commands
// ===========================================================================

describe('--json flag produces clean output', () => {
  it('version --json returns parseable JSON with protocol version', async () => {
    const r = await run(['version', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBeDefined();
    expect(parsed.protocol).toBeDefined();
  });

  it('doctor --json returns parseable JSON with checks array', async () => {
    const r = await run(['doctor', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.checks)).toBe(true);
    for (const check of parsed.checks) {
      expect(typeof check.name).toBe('string');
      expect(['ok', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.message).toBe('string');
    }
  });
});
