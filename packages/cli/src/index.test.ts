import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run } from './index';
import { buildCovenant, serializeCovenant, PROTOCOL_VERSION } from '@stele/core';
import { generateKeyPair } from '@stele/crypto';
import { setColorsEnabled, stripAnsi } from './format';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

// ---------------------------------------------------------------------------
// Helper: ANSI detection
// ---------------------------------------------------------------------------

function hasAnsi(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(s);
}

// ---------------------------------------------------------------------------
// Reset color state between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  setColorsEnabled(true);
});

// ===========================================================================
// help / --help
// ===========================================================================

describe('stele help', () => {
  it('shows help with no arguments', async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Stele CLI');
    expect(r.stdout).toContain('Commands');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('verify');
    expect(r.stdout).toContain('evaluate');
    expect(r.stdout).toContain('inspect');
    expect(r.stdout).toContain('parse');
    expect(r.stdout).toContain('completions');
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

  it('includes ANSI codes in help when colors enabled', async () => {
    const r = await run([]);
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('strips ANSI from help when --no-color is set', async () => {
    const r = await run(['--no-color']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('Stele CLI');
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
    const tmp = mkdtempSync(join(tmpdir(), 'stele-test-'));
    try {
      const r = await run(['init'], tmp);
      expect(r.exitCode).toBe(0);
      expect(stripAnsi(r.stdout)).toContain('Generated Ed25519 key pair.');
      expect(stripAnsi(r.stdout)).toContain('Public key');
      expect(r.stderr).toBe('');
      // Public key should be 64 hex chars
      const plain = stripAnsi(r.stdout);
      const match = plain.match(/Public key\s+([0-9a-f]{64})/);
      expect(match).not.toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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

  it('writes stele.config.json on init', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-test-'));
    try {
      const r = await run(['init'], tmp);
      expect(r.exitCode).toBe(0);
      const configPath = join(tmp, 'stele.config.json');
      expect(existsSync(configPath)).toBe(true);
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.defaultIssuer).toBeDefined();
      expect(config.defaultIssuer.publicKey).toHaveLength(64);
      expect(config.outputFormat).toBe('text');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init output contains ANSI when colors enabled', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-test-'));
    try {
      const r = await run(['init'], tmp);
      expect(hasAnsi(r.stdout)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init output has no ANSI with --no-color', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-test-'));
    try {
      const r = await run(['init', '--no-color'], tmp);
      expect(hasAnsi(r.stdout)).toBe(false);
      expect(r.stdout).toContain('Generated Ed25519 key pair.');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// create
// ===========================================================================

describe('stele create', () => {
  it('creates a covenant and outputs formatted text', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(r.exitCode).toBe(0);
    expect(stripAnsi(r.stdout)).toContain('Covenant created successfully.');
    expect(stripAnsi(r.stdout)).toContain('alice');
    expect(stripAnsi(r.stdout)).toContain('bob');
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
    // --json should not have ANSI
    expect(hasAnsi(r.stdout)).toBe(false);
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

  it('create text output contains ANSI', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
    ]);
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('create --no-color strips ANSI', async () => {
    const r = await run([
      'create',
      '--issuer', 'alice',
      '--beneficiary', 'bob',
      '--constraints', "permit read on '**'",
      '--no-color',
    ]);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('Covenant created successfully.');
  });
});

// ===========================================================================
// verify
// ===========================================================================

describe('stele verify', () => {
  it('verifies a valid covenant with colored output', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json]);
    expect(r.exitCode).toBe(0);
    // Should contain checkmarks (colored)
    expect(r.stdout).toContain('\u2714'); // checkmark
    expect(stripAnsi(r.stdout)).toContain('Valid:');
    expect(r.stderr).toBe('');
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('verify --no-color uses [OK] prefix instead of checkmark', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json, '--no-color']);
    expect(r.exitCode).toBe(0);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('[OK]');
    expect(r.stdout).toContain('Valid:');
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
    expect(hasAnsi(r.stdout)).toBe(false);
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
    // Should contain X mark for failures
    expect(r.stdout).toContain('\u2718'); // X mark
    expect(stripAnsi(r.stdout)).toContain('Invalid:');
  });

  it('tampered covenant --no-color shows [ERROR] prefix', async () => {
    const json = await makeCovenantJson();
    const obj = JSON.parse(json);
    obj.constraints = "deny ** on '**'";
    const tampered = JSON.stringify(obj);
    const r = await run(['verify', tampered, '--no-color']);
    expect(r.exitCode).toBe(1);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('[ERROR]');
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

  it('verify output includes box-drawing summary', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json]);
    // Box drawing characters
    expect(r.stdout).toContain('\u250C'); // top-left corner
    expect(r.stdout).toContain('Summary');
  });
});

// ===========================================================================
// evaluate
// ===========================================================================

describe('stele evaluate', () => {
  it('evaluates a permitted action with PERMITTED text', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data']);
    expect(r.exitCode).toBe(0);
    expect(stripAnsi(r.stdout)).toContain('PERMITTED');
    expect(stripAnsi(r.stdout)).toContain('read');
    expect(stripAnsi(r.stdout)).toContain('/data');
    expect(r.stderr).toBe('');
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('evaluates a denied action (default deny) with DENIED text', async () => {
    const json = await makeCovenantJson("deny write on '/system/**'");
    const r = await run(['evaluate', json, 'write', '/system/config']);
    expect(r.exitCode).toBe(1);
    expect(stripAnsi(r.stdout)).toContain('DENIED');
  });

  it('evaluate --no-color strips ANSI', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data', '--no-color']);
    expect(r.exitCode).toBe(0);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('PERMITTED');
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
    expect(hasAnsi(r.stdout)).toBe(false);
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
  it('pretty-prints covenant details with boxes', async () => {
    const json = await makeCovenantJson("permit read on '**'\ndeny write on '/system/**'");
    const r = await run(['inspect', json]);
    expect(r.exitCode).toBe(0);
    // Box drawing characters
    expect(r.stdout).toContain('\u250C'); // top-left corner
    expect(r.stdout).toContain('Covenant Inspection');
    expect(stripAnsi(r.stdout)).toContain('test-issuer');
    expect(stripAnsi(r.stdout)).toContain('test-beneficiary');
    expect(r.stdout).toContain('Parties');
    expect(r.stdout).toContain('Constraints');
    expect(stripAnsi(r.stdout)).toContain('Permits');
    expect(stripAnsi(r.stdout)).toContain('Denies');
    expect(stripAnsi(r.stdout)).toContain('Signature:');
    expect(r.stderr).toBe('');
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('inspect --no-color strips ANSI', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['inspect', json, '--no-color']);
    expect(r.exitCode).toBe(0);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('Covenant Inspection');
    expect(r.stdout).toContain('test-issuer');
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
    expect(hasAnsi(r.stdout)).toBe(false);
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
  it('parses valid CCL and shows formatted summary', async () => {
    const r = await run(['parse', "permit read on '**'"]);
    expect(r.exitCode).toBe(0);
    expect(stripAnsi(r.stdout)).toContain('Parsed 1 statement(s)');
    expect(stripAnsi(r.stdout)).toContain('Permits');
    expect(stripAnsi(r.stdout)).toContain('Serialized:');
    expect(r.stderr).toBe('');
    expect(hasAnsi(r.stdout)).toBe(true);
  });

  it('parses multiple statements', async () => {
    const ccl = "permit read on '**'\ndeny write on '/system/**'\nrequire audit.log on '**'";
    const r = await run(['parse', ccl]);
    expect(r.exitCode).toBe(0);
    expect(stripAnsi(r.stdout)).toContain('Parsed 3 statement(s)');
    const plain = stripAnsi(r.stdout);
    expect(plain).toContain('Permits');
    expect(plain).toContain('Denies');
    expect(plain).toContain('Obligations');
  });

  it('parse --no-color strips ANSI', async () => {
    const r = await run(['parse', "permit read on '**'", '--no-color']);
    expect(r.exitCode).toBe(0);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(r.stdout).toContain('Parsed 1 statement(s)');
  });

  it('outputs JSON with --json', async () => {
    const r = await run(['parse', "permit read on '**'", '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.statements).toBeDefined();
    expect(parsed.statements.length).toBe(1);
    expect(parsed.permits.length).toBe(1);
    expect(r.stderr).toBe('');
    expect(hasAnsi(r.stdout)).toBe(false);
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
// completions
// ===========================================================================

describe('stele completions', () => {
  it('generates bash completion script', async () => {
    const r = await run(['completions', 'bash']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('_stele_completions');
    expect(r.stdout).toContain('complete -F');
    expect(r.stdout).toContain('compgen');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('verify');
    expect(r.stderr).toBe('');
  });

  it('generates zsh completion script', async () => {
    const r = await run(['completions', 'zsh']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('#compdef stele');
    expect(r.stdout).toContain('_stele');
    expect(r.stdout).toContain('_arguments');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('create');
    expect(r.stderr).toBe('');
  });

  it('fails without shell argument', async () => {
    const r = await run(['completions']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Shell argument is required');
  });

  it('fails with unsupported shell', async () => {
    const r = await run(['completions', 'fish']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unsupported shell 'fish'");
    expect(r.stderr).toContain('bash');
    expect(r.stderr).toContain('zsh');
  });

  it('shows help with --help', async () => {
    const r = await run(['completions', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('stele completions');
    expect(r.stdout).toContain('bash');
    expect(r.stdout).toContain('zsh');
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
// config loading
// ===========================================================================

describe('config loading', () => {
  it('loads config from specified directory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-cfg-'));
    try {
      // Write a config file
      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(tmp, 'stele.config.json'),
        JSON.stringify({
          defaultIssuer: { id: 'cfg-issuer', publicKey: 'a'.repeat(64) },
          defaultBeneficiary: { id: 'cfg-beneficiary', publicKey: 'b'.repeat(64) },
          constraints: "permit read on '**'",
        }),
        'utf-8',
      );

      // create should pick up defaults from config
      const r = await run([
        'create',
        '--json',
      ], tmp);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.issuer.id).toBe('cfg-issuer');
      expect(parsed.beneficiary.id).toBe('cfg-beneficiary');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('CLI flags override config defaults', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-cfg-'));
    try {
      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(tmp, 'stele.config.json'),
        JSON.stringify({
          defaultIssuer: { id: 'cfg-issuer', publicKey: 'a'.repeat(64) },
          defaultBeneficiary: { id: 'cfg-beneficiary', publicKey: 'b'.repeat(64) },
          constraints: "permit read on '**'",
        }),
        'utf-8',
      );

      const r = await run([
        'create',
        '--issuer', 'override-issuer',
        '--beneficiary', 'override-beneficiary',
        '--json',
      ], tmp);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.issuer.id).toBe('override-issuer');
      expect(parsed.beneficiary.id).toBe('override-beneficiary');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('works gracefully when no config file exists', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'stele-nocfg-'));
    try {
      const r = await run(['version'], tmp);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('0.1.0');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// --json flag ensures no ANSI across all commands
// ===========================================================================

describe('--json flag produces clean JSON without ANSI', () => {
  it('init --json has no ANSI', async () => {
    const r = await run(['init', '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('version --json has no ANSI', async () => {
    const r = await run(['version', '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('verify --json has no ANSI', async () => {
    const json = await makeCovenantJson();
    const r = await run(['verify', json, '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('evaluate --json has no ANSI', async () => {
    const json = await makeCovenantJson("permit read on '**'");
    const r = await run(['evaluate', json, 'read', '/data', '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('inspect --json has no ANSI', async () => {
    const json = await makeCovenantJson();
    const r = await run(['inspect', json, '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('parse --json has no ANSI', async () => {
    const r = await run(['parse', "permit read on '**'", '--json']);
    expect(hasAnsi(r.stdout)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
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
    expect(stripAnsi(verifyResult.stdout)).toContain('Valid:');

    // 3. Evaluate (permitted)
    const evalPermit = await run(['evaluate', covenantJson, 'read', '/data']);
    expect(evalPermit.exitCode).toBe(0);
    expect(stripAnsi(evalPermit.stdout)).toContain('PERMITTED');

    // 4. Evaluate (denied)
    const evalDeny = await run(['evaluate', covenantJson, 'data.delete', '/system/config']);
    expect(evalDeny.exitCode).toBe(1);
    expect(stripAnsi(evalDeny.stdout)).toContain('DENIED');

    // 5. Inspect
    const inspectResult = await run(['inspect', covenantJson]);
    expect(inspectResult.exitCode).toBe(0);
    expect(stripAnsi(inspectResult.stdout)).toContain('alice');
    expect(stripAnsi(inspectResult.stdout)).toContain('bob');
    expect(stripAnsi(inspectResult.stdout)).toContain('Permits');

    // 6. Inspect --json
    const inspectJson = await run(['inspect', covenantJson, '--json']);
    expect(inspectJson.exitCode).toBe(0);
    const inspected = JSON.parse(inspectJson.stdout);
    expect(inspected.issuer.id).toBe('alice');
    expect(inspected.beneficiary.id).toBe('bob');
  });
});
