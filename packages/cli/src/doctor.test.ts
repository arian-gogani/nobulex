import { describe, it, expect, afterEach } from 'vitest';
import { runDoctor } from './doctor';
import type { DoctorCheck } from './doctor';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nobulex-doctor-'));
  tempDirs.push(dir);
  return dir;
}

// ===========================================================================
// runDoctor
// ===========================================================================

describe('runDoctor', () => {
  it('returns an array of checks', async () => {
    const checks = await runDoctor();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  });

  it('each check has name, status, and message', async () => {
    const checks = await runDoctor();
    for (const check of checks) {
      expect(typeof check.name).toBe('string');
      expect(check.name.length).toBeGreaterThan(0);
      expect(['ok', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.message).toBe('string');
      expect(check.message.length).toBeGreaterThan(0);
    }
  });

  it('all checks pass in test environment', async () => {
    const checks = await runDoctor();
    const failed = checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) {
      // Provide useful debug info if any check fails
      const details = failed.map((c) => `${c.name}: ${c.message}`).join('\n');
      expect.fail(`Expected all checks to pass but got failures:\n${details}`);
    }
  });
});

// ===========================================================================
// Individual checks
// ===========================================================================

describe('Node.js version check', () => {
  it('reports correct Node.js version', async () => {
    const checks = await runDoctor();
    const nodeCheck = checks.find((c) => c.name === 'Node.js version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('ok');
    expect(nodeCheck!.message).toContain(process.version);
    expect(nodeCheck!.message).toContain('>= 18');
  });
});

describe('Package imports check', () => {
  it('reports all packages importable', async () => {
    const checks = await runDoctor();
    const pkgCheck = checks.find((c) => c.name === 'Package imports');
    expect(pkgCheck).toBeDefined();
    expect(pkgCheck!.status).toBe('ok');
    expect(pkgCheck!.message).toContain('crypto');
    expect(pkgCheck!.message).toContain('ccl');
    expect(pkgCheck!.message).toContain('core');
  });
});

describe('Crypto check', () => {
  it('reports crypto works', async () => {
    const checks = await runDoctor();
    const cryptoCheck = checks.find((c) => c.name === 'Crypto');
    expect(cryptoCheck).toBeDefined();
    expect(cryptoCheck!.status).toBe('ok');
    expect(cryptoCheck!.message).toContain('Key pair generation');
  });
});

describe('Core check', () => {
  it('reports core works (build + verify)', async () => {
    const checks = await runDoctor();
    const coreCheck = checks.find((c) => c.name === 'Core');
    expect(coreCheck).toBeDefined();
    expect(coreCheck!.status).toBe('ok');
    expect(coreCheck!.message).toContain('round-trip');
  });
});

describe('CCL check', () => {
  it('reports CCL parsing works', async () => {
    const checks = await runDoctor();
    const cclCheck = checks.find((c) => c.name === 'CCL');
    expect(cclCheck).toBeDefined();
    expect(cclCheck!.status).toBe('ok');
    expect(cclCheck!.message).toContain('CCL parsing');
  });
});

describe('Config check', () => {
  it('reports warn when no config file exists', async () => {
    const tmp = makeTmpDir();
    const checks = await runDoctor(tmp);
    const configCheck = checks.find((c) => c.name === 'Config');
    expect(configCheck).toBeDefined();
    // No config file in temp dir, should be warn
    expect(configCheck!.status).toBe('warn');
    expect(configCheck!.message).toContain('No nobulex.config.json');
  });

  it('reports ok when config file exists and is valid', async () => {
    const tmp = makeTmpDir();
    writeFileSync(
      join(tmp, 'nobulex.config.json'),
      JSON.stringify({
        defaultIssuer: { id: 'test', publicKey: 'a'.repeat(64) },
        outputFormat: 'text',
      }),
      'utf-8',
    );

    const checks = await runDoctor(tmp);
    const configCheck = checks.find((c) => c.name === 'Config');
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe('ok');
    expect(configCheck!.message).toContain('Config loaded');
  });
});

describe('Dist files check', () => {
  it('reports ok for dist files', async () => {
    const checks = await runDoctor();
    const distCheck = checks.find((c) => c.name === 'Dist files');
    expect(distCheck).toBeDefined();
    expect(distCheck!.status).toBe('ok');
  });
});

// ===========================================================================
// Check count
// ===========================================================================

describe('check completeness', () => {
  it('runs exactly 7 checks', async () => {
    const checks = await runDoctor();
    expect(checks.length).toBe(7);
  });

  it('covers all expected check names', async () => {
    const checks = await runDoctor();
    const names = checks.map((c) => c.name);
    expect(names).toContain('Node.js version');
    expect(names).toContain('Package imports');
    expect(names).toContain('Crypto');
    expect(names).toContain('Core');
    expect(names).toContain('CCL');
    expect(names).toContain('Config');
    expect(names).toContain('Dist files');
  });
});
