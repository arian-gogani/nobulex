import { describe, it, expect } from 'vitest';
import { generateKeyPair, sha256String } from '@stele/crypto';
import type { HashHex } from '@stele/crypto';
import {
  Monitor,
  MonitorDeniedError,
  CapabilityError,
  CapabilityGate,
  verifyMerkleProof,
} from './index';
import type { AuditEntry } from './index';

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const COVENANT_ID: HashHex = 'a'.repeat(64);

const CONSTRAINTS = [
  "permit file.read on '/data/**'",
  "deny file.write on '/system/**' severity critical",
  "deny network.send on '**' severity high",
].join('\n');

// ─── MonitorDeniedError ────────────────────────────────────────────────────────

describe('MonitorDeniedError', () => {
  it('has correct name, action, resource, and severity', () => {
    const rule = {
      type: 'deny' as const,
      action: 'file.write',
      resource: '/system/**',
      severity: 'critical' as const,
      line: 2,
    };
    const err = new MonitorDeniedError('file.write', '/system/config', rule, 'critical');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MonitorDeniedError);
    expect(err.name).toBe('MonitorDeniedError');
    expect(err.action).toBe('file.write');
    expect(err.resource).toBe('/system/config');
    expect(err.matchedRule).toBe(rule);
    expect(err.severity).toBe('critical');
    expect(err.message).toContain("'file.write'");
    expect(err.message).toContain("'/system/config'");
    expect(err.message).toContain('matched deny rule');
  });

  it('message describes "no matching permit rule" when matchedRule is undefined', () => {
    const err = new MonitorDeniedError('file.delete', '/tmp/test', undefined, undefined);

    expect(err.name).toBe('MonitorDeniedError');
    expect(err.action).toBe('file.delete');
    expect(err.resource).toBe('/tmp/test');
    expect(err.matchedRule).toBeUndefined();
    expect(err.severity).toBeUndefined();
    expect(err.message).toContain('no matching permit rule');
  });
});

// ─── CapabilityError ───────────────────────────────────────────────────────────

describe('CapabilityError', () => {
  it('has correct name and action with default message', () => {
    const err = new CapabilityError('file.delete');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CapabilityError);
    expect(err.name).toBe('CapabilityError');
    expect(err.action).toBe('file.delete');
    expect(err.message).toContain("'file.delete'");
  });

  it('accepts a custom message', () => {
    const err = new CapabilityError('network.send', 'Custom message here');

    expect(err.name).toBe('CapabilityError');
    expect(err.action).toBe('network.send');
    expect(err.message).toBe('Custom message here');
  });
});

// ─── Monitor ───────────────────────────────────────────────────────────────────

describe('Monitor', () => {
  describe('evaluate — enforce mode', () => {
    it('permits allowed actions', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      const result = await monitor.evaluate('file.read', '/data/users');

      expect(result.permitted).toBe(true);
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule!.type).toBe('permit');
    });

    it('blocks denied actions by throwing MonitorDeniedError', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await expect(
        monitor.evaluate('file.write', '/system/config'),
      ).rejects.toThrow(MonitorDeniedError);

      try {
        await monitor.evaluate('file.write', '/system/passwd');
      } catch (err) {
        expect(err).toBeInstanceOf(MonitorDeniedError);
        const mde = err as MonitorDeniedError;
        expect(mde.action).toBe('file.write');
        expect(mde.resource).toBe('/system/passwd');
        expect(mde.severity).toBe('critical');
      }
    });

    it('blocks actions with no matching permit rule (default deny)', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await expect(
        monitor.evaluate('file.delete', '/data/users'),
      ).rejects.toThrow(MonitorDeniedError);
    });

    it('blocks network.send on any resource', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await expect(
        monitor.evaluate('network.send', '/api/external'),
      ).rejects.toThrow(MonitorDeniedError);
    });
  });

  describe('evaluate — log_only mode', () => {
    it('permits denied actions without throwing', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'log_only' });

      // Should not throw even though the action is denied
      const result = await monitor.evaluate('file.write', '/system/config');

      expect(result.permitted).toBe(false);
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule!.type).toBe('deny');
    });

    it('still logs violations via the onViolation callback', async () => {
      const violations: AuditEntry[] = [];
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, {
        mode: 'log_only',
        onViolation: (entry) => violations.push(entry),
      });

      await monitor.evaluate('file.write', '/system/config');

      expect(violations).toHaveLength(1);
      expect(violations[0]!.action).toBe('file.write');
      expect(violations[0]!.outcome).toBe('EXECUTED'); // log_only overrides to EXECUTED
    });

    it('records audit entries for denied actions', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'log_only' });

      await monitor.evaluate('network.send', '/anywhere');

      const log = monitor.getAuditLog();
      expect(log.entries).toHaveLength(1);
      expect(log.entries[0]!.action).toBe('network.send');
      expect(log.entries[0]!.outcome).toBe('EXECUTED'); // log_only mode
    });
  });

  describe('execute', () => {
    it('runs the handler when the action is permitted', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      const result = await monitor.execute(
        'file.read',
        '/data/users',
        async (resource, _ctx) => {
          return { data: `contents of ${resource}` };
        },
      );

      expect(result).toEqual({ data: 'contents of /data/users' });
    });

    it('throws MonitorDeniedError when the action is denied', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await expect(
        monitor.execute(
          'file.write',
          '/system/config',
          async () => 'should not run',
        ),
      ).rejects.toThrow(MonitorDeniedError);
    });

    it('propagates handler errors and still creates an audit entry', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await expect(
        monitor.execute(
          'file.read',
          '/data/test',
          async () => {
            throw new Error('disk failure');
          },
        ),
      ).rejects.toThrow('disk failure');

      const log = monitor.getAuditLog();
      expect(log.entries).toHaveLength(1);
      expect(log.entries[0]!.outcome).toBe('EXECUTED');
      expect(log.entries[0]!.error).toBe('disk failure');
    });
  });

  describe('audit log', () => {
    it('records entries for both permitted and denied actions', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/users');
      try {
        await monitor.evaluate('file.write', '/system/config');
      } catch {
        // expected
      }

      const log = monitor.getAuditLog();
      expect(log.covenantId).toBe(COVENANT_ID);
      expect(log.entries).toHaveLength(2);
      expect(log.count).toBe(2);
      expect(log.entries[0]!.action).toBe('file.read');
      expect(log.entries[0]!.outcome).toBe('EXECUTED');
      expect(log.entries[1]!.action).toBe('file.write');
      expect(log.entries[1]!.outcome).toBe('DENIED');
    });

    it('entries contain correct fields', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/report', { user: 'alice' });

      const entry = monitor.getAuditEntry(0);
      expect(entry).toBeDefined();
      expect(entry!.index).toBe(0);
      expect(entry!.timestamp).toBeTruthy();
      expect(entry!.action).toBe('file.read');
      expect(entry!.resource).toBe('/data/report');
      expect(entry!.context).toEqual({ user: 'alice' });
      expect(entry!.result.permitted).toBe(true);
      expect(entry!.outcome).toBe('EXECUTED');
      expect(entry!.hash).toBeTruthy();
      expect(entry!.previousHash).toBeTruthy();
    });

    it('hash chain links entries together', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');

      const log = monitor.getAuditLog();
      const entries = log.entries;

      // First entry links to genesis hash
      expect(entries[0]!.previousHash).toBe('0'.repeat(64));

      // Subsequent entries link to the previous entry's hash
      expect(entries[1]!.previousHash).toBe(entries[0]!.hash);
      expect(entries[2]!.previousHash).toBe(entries[1]!.hash);

      // Each entry has a unique hash
      const hashes = new Set(entries.map((e) => e.hash));
      expect(hashes.size).toBe(3);
    });
  });

  describe('verifyAuditLogIntegrity', () => {
    it('returns true for an empty log', () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS);
      expect(monitor.verifyAuditLogIntegrity()).toBe(true);
    });

    it('returns true for an unmodified log', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');

      expect(monitor.verifyAuditLogIntegrity()).toBe(true);
    });

    it('returns false when an entry hash is tampered', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');

      // Tamper with the first entry's hash
      const entry = monitor.getAuditEntry(0)!;
      entry.hash = 'f'.repeat(64) as HashHex;

      expect(monitor.verifyAuditLogIntegrity()).toBe(false);
    });

    it('returns false when an entry action is tampered', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');

      // Tamper with the first entry's action field
      const entry = monitor.getAuditEntry(0)!;
      entry.action = 'file.write';

      expect(monitor.verifyAuditLogIntegrity()).toBe(false);
    });

    it('returns false when the previousHash linkage is broken', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');

      // Tamper with the second entry's previousHash
      const entry = monitor.getAuditEntry(1)!;
      entry.previousHash = '0'.repeat(64) as HashHex;

      expect(monitor.verifyAuditLogIntegrity()).toBe(false);
    });
  });

  describe('Merkle tree', () => {
    it('computeMerkleRoot returns genesis hash for empty log', () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS);
      expect(monitor.computeMerkleRoot()).toBe('0'.repeat(64));
    });

    it('computeMerkleRoot produces consistent results', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');

      const root1 = monitor.computeMerkleRoot();
      const root2 = monitor.computeMerkleRoot();

      expect(root1).toBe(root2);
      expect(root1).not.toBe('0'.repeat(64));
    });

    it('computeMerkleRoot changes when new entries are added', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      const root1 = monitor.computeMerkleRoot();

      await monitor.evaluate('file.read', '/data/b');
      const root2 = monitor.computeMerkleRoot();

      expect(root1).not.toBe(root2);
    });

    it('generateMerkleProof → verifyMerkleProof round-trip succeeds', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');
      await monitor.evaluate('file.read', '/data/d');

      // Verify proof for each entry
      for (let i = 0; i < 4; i++) {
        const proof = monitor.generateMerkleProof(i);
        expect(proof.entryHash).toBe(monitor.getAuditEntry(i)!.hash);
        expect(proof.index).toBe(i);
        expect(proof.merkleRoot).toBe(monitor.computeMerkleRoot());
        expect(verifyMerkleProof(proof)).toBe(true);
      }
    });

    it('generateMerkleProof → verifyMerkleProof round-trip with a single entry', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');

      const proof = monitor.generateMerkleProof(0);
      expect(verifyMerkleProof(proof)).toBe(true);
    });

    it('generateMerkleProof → verifyMerkleProof round-trip with odd number of entries', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');

      for (let i = 0; i < 3; i++) {
        const proof = monitor.generateMerkleProof(i);
        expect(verifyMerkleProof(proof)).toBe(true);
      }
    });

    it('verifyMerkleProof fails with a tampered entry hash', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      await monitor.evaluate('file.read', '/data/c');

      const proof = monitor.generateMerkleProof(1);
      // Tamper with the entry hash
      proof.entryHash = 'f'.repeat(64) as HashHex;

      expect(verifyMerkleProof(proof)).toBe(false);
    });

    it('verifyMerkleProof fails with a tampered merkle root', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');

      const proof = monitor.generateMerkleProof(0);
      proof.merkleRoot = 'b'.repeat(64) as HashHex;

      expect(verifyMerkleProof(proof)).toBe(false);
    });

    it('generateMerkleProof throws for out-of-range index', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');

      expect(() => monitor.generateMerkleProof(-1)).toThrow();
      expect(() => monitor.generateMerkleProof(1)).toThrow();
      expect(() => monitor.generateMerkleProof(100)).toThrow();
    });
  });

  describe('callbacks', () => {
    it('fires onAction callback for every evaluation', async () => {
      const actions: AuditEntry[] = [];
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, {
        mode: 'enforce',
        onAction: (entry) => actions.push(entry),
      });

      await monitor.evaluate('file.read', '/data/a');
      try {
        await monitor.evaluate('file.write', '/system/x');
      } catch {
        // expected
      }

      expect(actions).toHaveLength(2);
      expect(actions[0]!.action).toBe('file.read');
      expect(actions[1]!.action).toBe('file.write');
    });

    it('fires onViolation callback only for denied actions', async () => {
      const violations: AuditEntry[] = [];
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, {
        mode: 'enforce',
        onViolation: (entry) => violations.push(entry),
      });

      await monitor.evaluate('file.read', '/data/a');
      try {
        await monitor.evaluate('file.write', '/system/x');
      } catch {
        // expected
      }

      expect(violations).toHaveLength(1);
      expect(violations[0]!.action).toBe('file.write');
    });
  });

  describe('reset', () => {
    it('clears the audit log', async () => {
      const monitor = new Monitor(COVENANT_ID, CONSTRAINTS, { mode: 'enforce' });

      await monitor.evaluate('file.read', '/data/a');
      await monitor.evaluate('file.read', '/data/b');
      expect(monitor.getAuditLog().count).toBe(2);

      monitor.reset();

      expect(monitor.getAuditLog().count).toBe(0);
      expect(monitor.getAuditLog().entries).toHaveLength(0);
      expect(monitor.computeMerkleRoot()).toBe('0'.repeat(64));
    });
  });
});

// ─── CapabilityGate ────────────────────────────────────────────────────────────

describe('CapabilityGate', () => {
  async function createGate(constraints?: string) {
    const keyPair = await generateKeyPair();
    return CapabilityGate.fromConstraints(
      COVENANT_ID,
      constraints ?? CONSTRAINTS,
      keyPair,
      'node',
    );
  }

  describe('fromConstraints', () => {
    it('only exposes permitted capabilities from permit statements', async () => {
      const gate = await createGate();

      const capabilities = gate.listCapabilities();
      expect(capabilities).toContain('file.read');
      // deny statements should not create capabilities
      expect(capabilities).not.toContain('file.write');
      expect(capabilities).not.toContain('network.send');
    });
  });

  describe('hasCapability', () => {
    it('returns true for permitted actions', async () => {
      const gate = await createGate();

      expect(gate.hasCapability('file.read')).toBe(true);
    });

    it('returns false for denied/unknown actions', async () => {
      const gate = await createGate();

      expect(gate.hasCapability('file.write')).toBe(false);
      expect(gate.hasCapability('network.send')).toBe(false);
      expect(gate.hasCapability('file.delete')).toBe(false);
      expect(gate.hasCapability('unknown.action')).toBe(false);
    });
  });

  describe('register', () => {
    it('registers a handler for a permitted action', async () => {
      const gate = await createGate();

      expect(() => {
        gate.register('file.read', async (resource) => `read ${resource}`);
      }).not.toThrow();
    });

    it('throws CapabilityError for a non-permitted action', async () => {
      const gate = await createGate();

      expect(() => {
        gate.register('file.write', async () => 'nope');
      }).toThrow(CapabilityError);
    });
  });

  describe('execute', () => {
    it('runs handler for a permitted action with matching resource', async () => {
      const gate = await createGate();
      gate.register('file.read', async (resource) => `data from ${resource}`);

      const result = await gate.execute<string>('file.read', '/data/users');
      expect(result).toBe('data from /data/users');
    });

    it('returns IMPOSSIBLE for completely unregistered/non-permitted actions', async () => {
      const gate = await createGate();

      await expect(
        gate.execute('unknown.action', '/whatever'),
      ).rejects.toThrow(CapabilityError);

      try {
        await gate.execute('unknown.action', '/whatever');
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityError);
        expect((err as CapabilityError).message).toContain('impossible');
      }

      // Verify execution log records IMPOSSIBLE
      const log = gate.getExecutionLog();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0]!.outcome).toBe('IMPOSSIBLE');
    });

    it('throws MonitorDeniedError when constraints deny the action at runtime', async () => {
      // Use constraints that permit file.read on /data/** but also deny on /data/secret
      const constraintsWithConflict = [
        "permit file.read on '/data/**'",
        "deny file.read on '/data/secret' severity critical",
      ].join('\n');
      const gate = await createGate(constraintsWithConflict);
      gate.register('file.read', async (resource) => `data from ${resource}`);

      // /data/secret is denied (deny wins at higher specificity)
      await expect(
        gate.execute('file.read', '/data/secret'),
      ).rejects.toThrow(MonitorDeniedError);

      // /data/public should still work
      const result = await gate.execute<string>('file.read', '/data/public');
      expect(result).toBe('data from /data/public');
    });

    it('throws CapabilityError when handler not registered but capability exists', async () => {
      const gate = await createGate();
      // Don't register any handler for file.read

      await expect(
        gate.execute('file.read', '/data/users'),
      ).rejects.toThrow(CapabilityError);

      const log = gate.getExecutionLog();
      const entry = log[log.length - 1]!;
      expect(entry.outcome).toBe('IMPOSSIBLE');
      expect(entry.error).toContain('No handler registered');
    });
  });

  describe('generateManifest → verifyManifest round-trip', () => {
    it('generates a valid manifest and verifies it', async () => {
      const keyPair = await generateKeyPair();
      const gate = await CapabilityGate.fromConstraints(
        COVENANT_ID,
        CONSTRAINTS,
        keyPair,
        'node',
      );

      const manifest = await gate.generateManifest();

      expect(manifest.covenantId).toBe(COVENANT_ID);
      expect(manifest.runtimeType).toBe('node');
      expect(manifest.runtimePublicKey).toBe(keyPair.publicKeyHex);
      expect(manifest.capabilities).toHaveLength(1); // only 1 permit statement
      expect(manifest.capabilities[0]!.action).toBe('file.read');
      expect(manifest.capabilities[0]!.resource).toBe('/data/**');
      expect(manifest.manifestHash).toBeTruthy();
      expect(manifest.runtimeSignature).toBeTruthy();
      expect(manifest.generatedAt).toBeTruthy();

      // Verify the manifest
      const isValid = await CapabilityGate.verifyManifest(manifest);
      expect(isValid).toBe(true);
    });

    it('verifyManifest fails with a tampered manifest hash', async () => {
      const keyPair = await generateKeyPair();
      const gate = await CapabilityGate.fromConstraints(
        COVENANT_ID,
        CONSTRAINTS,
        keyPair,
      );

      const manifest = await gate.generateManifest();
      manifest.manifestHash = 'f'.repeat(64) as HashHex;

      const isValid = await CapabilityGate.verifyManifest(manifest);
      expect(isValid).toBe(false);
    });

    it('verifyManifest fails with a tampered capability', async () => {
      const keyPair = await generateKeyPair();
      const gate = await CapabilityGate.fromConstraints(
        COVENANT_ID,
        CONSTRAINTS,
        keyPair,
      );

      const manifest = await gate.generateManifest();
      manifest.capabilities[0]!.action = 'file.write'; // tamper

      const isValid = await CapabilityGate.verifyManifest(manifest);
      expect(isValid).toBe(false);
    });

    it('verifyManifest fails with a tampered signature', async () => {
      const keyPair = await generateKeyPair();
      const gate = await CapabilityGate.fromConstraints(
        COVENANT_ID,
        CONSTRAINTS,
        keyPair,
      );

      const manifest = await gate.generateManifest();
      // Replace first chars of signature
      manifest.runtimeSignature = 'ff' + manifest.runtimeSignature.slice(2);

      const isValid = await CapabilityGate.verifyManifest(manifest);
      expect(isValid).toBe(false);
    });
  });

  describe('proveImpossible', () => {
    it('classifies permitted and non-permitted actions correctly', async () => {
      const gate = await createGate();

      const result = await gate.proveImpossible([
        'file.read',
        'file.write',
        'network.send',
        'file.delete',
        'process.exec',
      ]);

      expect(result.possible).toContain('file.read');
      expect(result.impossible).toContain('file.write');
      expect(result.impossible).toContain('network.send');
      expect(result.impossible).toContain('file.delete');
      expect(result.impossible).toContain('process.exec');
      expect(result.manifestHash).toBeTruthy();
    });

    it('returns empty arrays when given no actions', async () => {
      const gate = await createGate();

      const result = await gate.proveImpossible([]);

      expect(result.possible).toHaveLength(0);
      expect(result.impossible).toHaveLength(0);
      expect(result.manifestHash).toBeTruthy();
    });
  });

  describe('execution log', () => {
    it('records all execution attempts', async () => {
      const gate = await createGate();
      gate.register('file.read', async (resource) => `data from ${resource}`);

      await gate.execute('file.read', '/data/test1');
      await gate.execute('file.read', '/data/test2');
      try {
        await gate.execute('unknown.action', '/whatever');
      } catch {
        // expected
      }

      const log = gate.getExecutionLog();
      expect(log).toHaveLength(3);
      expect(log[0]!.outcome).toBe('EXECUTED');
      expect(log[1]!.outcome).toBe('EXECUTED');
      expect(log[2]!.outcome).toBe('IMPOSSIBLE');
    });
  });
});
