import { describe, it, expect } from 'vitest';
import { run } from './index';
import { buildCovenant, serializeCovenant, PROTOCOL_VERSION } from '@stele/core';
import { generateKeyPair } from '@stele/crypto';

// ---------------------------------------------------------------------------
// Helper: create a valid signed covenant JSON string for test use
// ---------------------------------------------------------------------------

async function makeCovenantJson(constraints = "permit read on '**'"): Promise<string> {
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

// ===========================================================================
// help / --help
// ===========================================================================

describe('stele help', () => {
  it('shows help with no arguments', async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Stele CLI');
    expect(r.stdout).toContain('Commands:');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('verify');
    expect(r.stdout).toContain('evaluate');
    expect(r.stdout).toContain('inspect');
    expect(r.stdout).toContain('parse');
    expect(r.stdout).toContain('version');
    expect(r.stdout).toContain('help');
    expect(r.stderr).toBe('');
  });

  it('shows help with "help" command', async () => {
    const r = await run(['help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Stele CLI');
    expect(r.stderr).toBe('');
  });

  it('shows help with --help on a subcommand', async () => {
    const r = await run(['init', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele init');
    expect(r.stderr).toBe('');
  });
});

// ===========================================================================
// version
// ===========================================================================

describe('stele version', () => {
  it('prints 0.1.0', async () => {
    const r = await run(['version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('0.1.0');
    expect(r.stderr).toBe('');
  });

  it('prints JSON with --json', async () => {
    const r = await run(['version', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.protocol).toBe(PROTOCOL_VERSION);
    expect(r.stderr).toBe('');
  });
});

// ===========================================================================
// init
// ===========================================================================

describe('stele init', () => {
  it('generates a key pair and prints public key', async () => {
    const r = await run(['init']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Generated Ed25519 key pair.');
    expect(r.stdout).toContain('Public key:');
    expect(r.stderr).toBe('');
    // Public key should be 64 hex chars
    const match = r.stdout.match(/Public key: ([0-9a-f]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(64);
  });

  it('outputs JSON with --json flag', async () => {
    const r = await run(['init', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.publicKey).toBe('string');
    expect(typeof parsed.privateKey).toBe('string');
    expect(parsed.publicKey).toHaveLength(64);
    expect(parsed.privateKey).toHaveLength(64);
    expect(r.stderr).toBe('');
  });

  it('shows help with --help', async () => {
    const r = await run(['init', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele init');
    expect(r.stdout).toContain('Generate');
  });
});

// ===========================================================================
// create
// ===========================================================================

describe('stele create', () => {
  it('creates a covenant and outputs JSON', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Covenant created successfully.');
    expect(r.stdout).toContain('alice');
    expect(r.stdout).toContain('bob');
    expect(r.stderr).toBe('');
  });

  it('outputs raw JSON with --json', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
      '--json',
    ]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.issuer.id).toBe('alice');
    expect(parsed.beneficiary.id).toBe('bob');
    expect(parsed.constraints).toBe("permit read on '**'");
    expect(typeof parsed.id).toBe('string');
    expect(typeof parsed.signature).toBe('string');
    expect(r.stderr).toBe('');
  });

  it('fails without --issuer', async () => {
    const r = await run([
      'create',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--issuer');
  });

  it('fails without --beneficiary', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--beneficiary');
  });

  it('fails without --constraints', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--constraints');
  });

  it('fails with invalid CCL constraints', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', '!!!invalid ccl!!!',
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid CCL');
  });

  it('shows help with --help', async () => {
    const r = await run(['create', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele create');
    expect(r.stdout).toContain('--issuer');
  });
});

// ===========================================================================
// verify
// ===========================================================================

describe('stele verify', () => {
  it('verifies a valid covenant', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('PASS');
    expect(r.stdout).toContain('Valid:');
    expect(r.stderr).toBe('');
  });

  it('outputs JSON with --json on a valid covenant', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json, '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(r.stderr).toBe('');
  });

  it('fails with invalid JSON', async () => {
    const r = await run(['verify', 'not-json']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid covenant JSON');
  });

  it('detects a tampered covenant', async () => {
    const json = await makeCovenantJson();
    const obj = JSON.parse(json);
    obj.constraints = "deny ** on '**'"; // tamper
    const tampered = JSON.stringify(obj);
    const r = await run(['verify', tampered]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('FAIL');
    expect(r.stdout).toContain('Invalid:');
  });

  it('fails without a JSON argument', async () => {
    const r = await run(['verify']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Covenant JSON string is required');
  });

  it('shows help with --help', async () => {
    const r = await run(['verify', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele verify');
  });
});

// ===========================================================================
// evaluate
// ===========================================================================

describe('stele evaluate', () => {
  it('evaluates a permitted action', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('PERMIT');
    expect(r.stdout).toContain('read');
    expect(r.stdout).toContain('/data');
    expect(r.stderr).toBe('');
  });

  it('evaluates a denied action (default deny)', async () => {
    const json = await makeCovenantJson("deny write on '/system/**'");
    const r = await run(['evaluate', json, 'write', '/system/config']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('DENY');
  });

  it('outputs JSON with --json', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.permitted).toBe(true);
    expect(parsed.action).toBe('read');
    expect(parsed.resource).toBe('/data');
    expect(r.stderr).toBe('');
  });

  it('fails without JSON argument', async () => {
    const r = await run(['evaluate']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Covenant JSON string is required');
  });

  it('fails without action', async () => {
    const json = await makeCovenantJson();
    const r = await run(['evaluate', json]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Action is required');
  });

  it('fails without resource', async () => {
    const json = await makeCovenantJson();
    const r = await run(['evaluate', json, 'read']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Resource is required');
  });

  it('fails with invalid JSON', async () => {
    const r = await run(['evaluate', '{bad}', 'read', '/data']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid covenant JSON');
  });

  it('shows help with --help', async () => {
    const r = await run(['evaluate', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele evaluate');
  });
});

// ===========================================================================
// inspect
// ===========================================================================

describe('stele inspect', () => {
  it('pretty-prints covenant details', async () => {
    const json = await makeCovenantJson("permit read on '**'\ndeny write on '/system/**'");
    const r = await run(['inspect', json]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('=== Covenant Inspection ===');
    expect(r.stdout).toContain('test-issuer');
    expect(r.stdout).toContain('test-beneficiary');
    expect(r.stdout).toContain('Constraints:');
    expect(r.stdout).toContain("permit read on '**'");
    expect(r.stdout).toContain('Constraint summary:');
    expect(r.stdout).toContain('Permits:');
    expect(r.stdout).toContain('Denies:');
    expect(r.stdout).toContain('Signature:');
    expect(r.stderr).toBe('');
  });

  it('outputs JSON with --json', async () => {
    const json = await makeCovenantJson();
    const r = await run(['inspect', json, '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.id).toBeDefined();
    expect(parsed.issuer).toBeDefined();
    expect(parsed.beneficiary).toBeDefined();
    expect(parsed.constraints).toBeDefined();
    expect(r.stderr).toBe('');
  });

  it('fails without a JSON argument', async () => {
    const r = await run(['inspect']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Covenant JSON string is required');
  });

  it('fails with invalid JSON', async () => {
    const r = await run(['inspect', 'not-json']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid covenant JSON');
  });

  it('shows help with --help', async () => {
    const r = await run(['inspect', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele inspect');
  });
});

// ===========================================================================
// parse
// ===========================================================================

describe('stele parse', () => {
  it('parses valid CCL and shows summary', async () => {
    const r = await run(['parse', "permit read on '**'"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Parsed 1 statement(s)');
    expect(r.stdout).toContain('Permits:');
    expect(r.stdout).toContain('Serialized:');
    expect(r.stderr).toBe('');
  });

  it('parses multiple statements', async () => {
    const ccl = "permit read on '**'\ndeny write on '/system/**'\nrequire audit.log on '**'";
    const r = await run(['parse', ccl]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Parsed 3 statement(s)');
    expect(r.stdout).toContain('Permits:     1');
    expect(r.stdout).toContain('Denies:      1');
    expect(r.stdout).toContain('Obligations: 1');
  });

  it('outputs JSON with --json', async () => {
    const r = await run(['parse', "permit read on '**'", '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.statements).toBeDefined();
    expect(parsed.statements.length).toBe(1);
    expect(parsed.permits.length).toBe(1);
    expect(r.stderr).toBe('');
  });

  it('fails with invalid CCL', async () => {
    const r = await run(['parse', '!!!not valid ccl!!!']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('CCL parse error');
  });

  it('fails without a CCL argument', async () => {
    const r = await run(['parse']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('CCL string is required');
  });

  it('shows help with --help', async () => {
    const r = await run(['parse', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele parse');
  });
});

// ===========================================================================
// unknown command
// ===========================================================================

describe('unknown command', () => {
  it('returns error for unknown command', async () => {
    const r = await run(['foobar']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown command 'foobar'");
    expect(r.stderr).toContain('stele help');
  });
});

// ===========================================================================
// round-trip: create -> verify -> evaluate -> inspect
// ===========================================================================

describe('round-trip workflow', () => {
  it('creates, verifies, evaluates, and inspects a covenant', async () => {
    // 1. Create
    const createResult = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'\ndeny data.delete on '/system/**'",
      '--json',
    ]);
    expect(createResult.exitCode).toBe(0);
    const covenantJson = createResult.stdout;

    // 2. Verify
    const verifyResult = await run(['verify', covenantJson]);
    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain('Valid:');

    // 3. Evaluate (permitted)
    const evalPermit = await run(['evaluate', covenantJson, 'read', '/data']);
    expect(evalPermit.exitCode).toBe(0);
    expect(evalPermit.stdout).toContain('PERMIT');

    // 4. Evaluate (denied)
    const evalDeny = await run(['evaluate', covenantJson, 'data.delete', '/system/config']);
    expect(evalDeny.exitCode).toBe(1);
    expect(evalDeny.stdout).toContain('DENY');

    // 5. Inspect
    const inspectResult = await run(['inspect', covenantJson]);
    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('alice');
    expect(inspectResult.stdout).toContain('bob');
    expect(inspectResult.stdout).toContain('Permits:');

    // 6. Inspect --json
    const inspectJson = await run(['inspect', covenantJson, '--json']);
    expect(inspectJson.exitCode).toBe(0);
    const inspected = JSON.parse(inspectJson.stdout);
    expect(inspected.issuer.id).toBe('alice');
    expect(inspected.beneficiary.id).toBe('bob');
  });
});
