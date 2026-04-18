import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { run, memoryFs, parseArgs } from './index.js';
import { ActionLogBuilder } from '@nobulex/core';
import type { ActionLog } from '@nobulex/core';

// ── Helpers ─────────────────────────────────────────────────────────────────

function validLog(): ActionLog {
  const b = new ActionLogBuilder('did:nobulex:test-agent');
  b.append({ action: 'read', resource: '/a', params: {}, outcome: 'success' });
  b.append({ action: 'write', resource: '/b', params: { n: 1 }, outcome: 'success' });
  b.append({ action: 'delete', resource: '/c', params: {}, outcome: 'blocked' });
  return b.toLog();
}

function writeLog(fs: ReturnType<typeof memoryFs>, p: string, log: ActionLog) {
  fs.writeFile(p, JSON.stringify(log));
}

// ── Arg parser ──────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('collects positionals', () => {
    const r = parseArgs(['foo', 'bar']);
    expect(r.positionals).toEqual(['foo', 'bar']);
    expect(r.flags).toEqual({});
  });

  it('parses --name=value', () => {
    const r = parseArgs(['--framework=soc2']);
    expect(r.flags['framework']).toBe('soc2');
  });

  it('parses --name value when not boolean', () => {
    const r = parseArgs(['--framework', 'soc2']);
    expect(r.flags['framework']).toBe('soc2');
  });

  it('treats declared boolean flags as true when standalone', () => {
    const r = parseArgs(['--json'], { boolean: ['json'] });
    expect(r.flags['json']).toBe(true);
  });

  it('short alias maps to long name', () => {
    const r = parseArgs(['-f', 'soc2'], { aliases: { f: 'framework' } });
    expect(r.flags['framework']).toBe('soc2');
  });
});

// ── help / version ──────────────────────────────────────────────────────────

describe('top-level commands', () => {
  it('shows help when no command is given', () => {
    const r = run([], memoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('init');
    expect(r.stdout).toContain('verify');
    expect(r.stdout).toContain('inspect');
    expect(r.stdout).toContain('report');
  });

  it('--version prints the version', () => {
    const r = run(['--version'], memoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^nobulex \d/);
  });

  it('unknown command exits with code 2', () => {
    const r = run(['frobnicate'], memoryFs());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown command');
  });
});

// ── init ────────────────────────────────────────────────────────────────────

describe('nobulex init', () => {
  let fs: ReturnType<typeof memoryFs>;
  beforeEach(() => { fs = memoryFs(); });

  it('scaffolds every expected file', () => {
    const r = run(['init', '/project'], fs);
    expect(r.exitCode).toBe(0);
    expect(fs.exists('/project/covenant.dsl')).toBe(true);
    expect(fs.exists('/project/agent.ts')).toBe(true);
    expect(fs.exists('/project/nobulex.config.json')).toBe(true);
    expect(fs.exists('/project/README.md')).toBe(true);
  });

  it('covenant.dsl parses as a valid covenant (smoke test)', async () => {
    const r = run(['init', '/project'], fs);
    expect(r.exitCode).toBe(0);
    const { parseSource } = await import('@nobulex/core');
    const source = fs.readFile('/project/covenant.dsl');
    const spec = parseSource(source);
    expect(spec.name).toBe('Starter');
    expect(spec.statements.length).toBeGreaterThan(0);
  });

  it('refuses to overwrite existing files without --force', () => {
    fs.writeFile(path.resolve('/project/covenant.dsl'), 'existing');
    const r = run(['init', '/project'], fs);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('refusing to overwrite');
    // original contents preserved
    expect(fs.readFile(path.resolve('/project/covenant.dsl'))).toBe('existing');
  });

  it('--force overrides existing files', () => {
    fs.writeFile(path.resolve('/project/covenant.dsl'), 'existing');
    const r = run(['init', '/project', '--force'], fs);
    expect(r.exitCode).toBe(0);
    expect(fs.readFile(path.resolve('/project/covenant.dsl'))).not.toBe('existing');
  });

  it('defaults to the current directory', () => {
    const r = run(['init'], fs);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Scaffolded');
  });

  it('mentions next steps in stdout', () => {
    const r = run(['init', '/p'], fs);
    expect(r.stdout).toContain('Next steps');
  });
});

// ── verify ──────────────────────────────────────────────────────────────────

describe('nobulex verify', () => {
  let fs: ReturnType<typeof memoryFs>;
  beforeEach(() => { fs = memoryFs(); });

  it('prints usage when no path is given', () => {
    const r = run(['verify'], fs);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('usage');
  });

  it('returns exit 0 on a valid log', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['verify', '/log.json'], fs);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('integrity verified');
    expect(r.stdout).toContain('did:nobulex:test-agent');
  });

  it('returns exit 1 when the hash chain is tampered', () => {
    const log = validLog();
    const tampered = {
      ...log,
      entries: log.entries.map((e, i) =>
        i === 1 ? { ...e, action: 'HIJACKED' } : e,
      ),
    };
    writeLog(fs, '/log.json', tampered as ActionLog);
    const r = run(['verify', '/log.json'], fs);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('hash mismatch');
  });

  it('returns exit 1 when the file is missing', () => {
    const r = run(['verify', '/nope.json'], fs);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/not found/);
  });

  it('returns exit 1 when the file is not JSON', () => {
    fs.writeFile('/log.json', '{ oops');
    const r = run(['verify', '/log.json'], fs);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
  });

  it('--json emits a machine-readable result', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['verify', '/log.json', '--json'], fs);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.entries).toBe(3);
    expect(parsed.agentDid).toBe('did:nobulex:test-agent');
  });
});

// ── inspect ─────────────────────────────────────────────────────────────────

describe('nobulex inspect', () => {
  let fs: ReturnType<typeof memoryFs>;
  beforeEach(() => { fs = memoryFs(); });

  it('prints usage when no path is given', () => {
    const r = run(['inspect'], fs);
    expect(r.exitCode).toBe(2);
  });

  it('prints a timeline of events', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['inspect', '/log.json'], fs);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('did:nobulex:test-agent');
    expect(r.stdout).toContain("'read'");
    expect(r.stdout).toContain("'write'");
    expect(r.stdout).toContain('blocked');
    expect(r.stdout).toContain('events:');
  });

  it('prints a friendly message for an empty log', () => {
    const empty = new ActionLogBuilder('did:nobulex:x').toLog();
    writeLog(fs, '/log.json', empty);
    const r = run(['inspect', '/log.json'], fs);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('no events');
  });

  it('--json emits the ReplayTimeline', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['inspect', '/log.json', '--json'], fs);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.events).toHaveLength(3);
    expect(parsed.agentDid).toBe('did:nobulex:test-agent');
  });
});

// ── report ──────────────────────────────────────────────────────────────────

describe('nobulex report', () => {
  let fs: ReturnType<typeof memoryFs>;
  beforeEach(() => { fs = memoryFs(); });

  it('prints usage when no path is given', () => {
    const r = run(['report'], fs);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('frameworks');
  });

  it('rejects a missing --framework', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['report', '/log.json'], fs);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--framework');
  });

  it('rejects an unknown framework', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['report', '/log.json', '--framework', 'nist-csf'], fs);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown framework');
  });

  it('emits a JSON report by default', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(['report', '/log.json', '--framework', 'eu-ai-act-article-12'], fs);
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.framework).toBe('eu-ai-act-article-12');
    expect(report.requirements.length).toBeGreaterThan(0);
    expect(typeof report.summary.coveragePercent).toBe('number');
  });

  it('--text emits a human-readable summary', () => {
    writeLog(fs, '/log.json', validLog());
    const r = run(
      ['report', '/log.json', '--framework', 'soc2', '--text'],
      fs,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Framework: soc2');
    expect(r.stdout).toContain('Requirements:');
    expect(r.stdout).toContain('Coverage:');
  });

  it('supports all four advertised frameworks', () => {
    writeLog(fs, '/log.json', validLog());
    for (const fw of ['eu-ai-act-article-12', 'colorado-ai-act', 'soc2', 'iso-42001']) {
      const r = run(['report', '/log.json', '--framework', fw], fs);
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(report.framework).toBe(fw);
    }
  });
});
