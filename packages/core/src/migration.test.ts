import { describe, it, expect } from 'vitest';

import {
  DocumentMigrator,
  defaultMigrator,
  PROTOCOL_VERSION,
} from './index';

import type { Migration } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMigration(from: string, to: string, description?: string): Migration {
  return {
    fromVersion: from,
    toVersion: to,
    description: description ?? `Migrate from ${from} to ${to}`,
    migrate(doc: Record<string, unknown>): Record<string, unknown> {
      return { ...doc, version: to };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentMigrator', () => {
  // ── Register and list migrations ──────────────────────────────────────

  describe('register and listMigrations', () => {
    it('starts with no migrations', () => {
      const migrator = new DocumentMigrator();
      expect(migrator.listMigrations()).toHaveLength(0);
    });

    it('registers a single migration', () => {
      const migrator = new DocumentMigrator();
      const m = makeMigration('0.1', '0.2');
      migrator.register(m);

      const list = migrator.listMigrations();
      expect(list).toHaveLength(1);
      expect(list[0]!.fromVersion).toBe('0.1');
      expect(list[0]!.toVersion).toBe('0.2');
    });

    it('registers multiple migrations and lists them in order', () => {
      const migrator = new DocumentMigrator();
      migrator.register(makeMigration('0.1', '0.2'));
      migrator.register(makeMigration('0.2', '0.3'));
      migrator.register(makeMigration('0.3', '1.0'));

      const list = migrator.listMigrations();
      expect(list).toHaveLength(3);
      expect(list[0]!.fromVersion).toBe('0.1');
      expect(list[1]!.fromVersion).toBe('0.2');
      expect(list[2]!.fromVersion).toBe('0.3');
    });

    it('supports chaining via .register().register()', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '1.0'));

      expect(migrator.listMigrations()).toHaveLength(2);
    });

    it('listMigrations returns a copy, not the internal array', () => {
      const migrator = new DocumentMigrator();
      migrator.register(makeMigration('0.1', '0.2'));

      const list1 = migrator.listMigrations();
      const list2 = migrator.listMigrations();
      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  // ── currentVersion ─────────────────────────────────────────────────────

  describe('currentVersion', () => {
    it('returns PROTOCOL_VERSION when no migrations are registered', () => {
      const migrator = new DocumentMigrator();
      expect(migrator.currentVersion()).toBe(PROTOCOL_VERSION);
    });

    it('returns the terminal toVersion of the migration chain', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '0.3'))
        .register(makeMigration('0.3', '1.0'));

      expect(migrator.currentVersion()).toBe('1.0');
    });

    it('returns the terminal version for a single migration', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.9', '1.0'));

      expect(migrator.currentVersion()).toBe('1.0');
    });
  });

  // ── needsMigration ─────────────────────────────────────────────────────

  describe('needsMigration', () => {
    it('detects old versions need migration', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '1.0'));

      expect(migrator.needsMigration({ version: '0.1' })).toBe(true);
      expect(migrator.needsMigration({ version: '0.2' })).toBe(true);
    });

    it('detects current version does not need migration', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      expect(migrator.needsMigration({ version: '1.0' })).toBe(false);
    });

    it('returns true when version is missing', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      expect(migrator.needsMigration({})).toBe(true);
    });

    it('returns true when version is undefined', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      expect(migrator.needsMigration({ version: undefined })).toBe(true);
    });
  });

  // ── Single-step migration ──────────────────────────────────────────────

  describe('single-step migration', () => {
    it('migrates a document one version step', () => {
      const migrator = new DocumentMigrator()
        .register({
          fromVersion: '0.1',
          toVersion: '1.0',
          description: 'Upgrade to 1.0',
          migrate(doc) {
            return { ...doc, version: '1.0', upgraded: true };
          },
        });

      const result = migrator.migrate({ version: '0.1', data: 'test' });

      expect(result.document.version).toBe('1.0');
      expect(result.document.upgraded).toBe(true);
      expect(result.document.data).toBe('test');
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]).toBe('Upgrade to 1.0');
    });

    it('returns unchanged document when already at current version', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      const original = { version: '1.0', data: 'unchanged' };
      const result = migrator.migrate(original);

      expect(result.document.version).toBe('1.0');
      expect(result.document.data).toBe('unchanged');
      expect(result.applied).toHaveLength(0);
    });
  });

  // ── Multi-step migration chains ───────────────────────────────────────

  describe('multi-step migration chains', () => {
    it('chains three migrations correctly', () => {
      const migrator = new DocumentMigrator()
        .register({
          fromVersion: '0.1',
          toVersion: '0.2',
          description: 'Add field A',
          migrate(doc) {
            return { ...doc, version: '0.2', fieldA: true };
          },
        })
        .register({
          fromVersion: '0.2',
          toVersion: '0.3',
          description: 'Add field B',
          migrate(doc) {
            return { ...doc, version: '0.3', fieldB: true };
          },
        })
        .register({
          fromVersion: '0.3',
          toVersion: '1.0',
          description: 'Add field C',
          migrate(doc) {
            return { ...doc, version: '1.0', fieldC: true };
          },
        });

      const result = migrator.migrate({ version: '0.1' });

      expect(result.document.version).toBe('1.0');
      expect(result.document.fieldA).toBe(true);
      expect(result.document.fieldB).toBe(true);
      expect(result.document.fieldC).toBe(true);
      expect(result.applied).toHaveLength(3);
    });

    it('starts from intermediate version', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '0.3'))
        .register(makeMigration('0.3', '1.0'));

      const result = migrator.migrate({ version: '0.2' });

      expect(result.document.version).toBe('1.0');
      expect(result.applied).toHaveLength(2);
    });

    it('each step receives the output of the previous step', () => {
      const migrator = new DocumentMigrator()
        .register({
          fromVersion: '0.1',
          toVersion: '0.2',
          description: 'Step 1',
          migrate(doc) {
            return { ...doc, version: '0.2', step1: true };
          },
        })
        .register({
          fromVersion: '0.2',
          toVersion: '1.0',
          description: 'Step 2',
          migrate(doc) {
            // Verify step1 was applied
            const result = { ...doc, version: '1.0', step2: true };
            result.step1Seen = doc.step1 === true;
            return result;
          },
        });

      const result = migrator.migrate({ version: '0.1' });
      expect(result.document.step1Seen).toBe(true);
    });
  });

  // ── Applied migrations tracked ────────────────────────────────────────

  describe('applied migrations tracking', () => {
    it('tracks descriptions of all applied migrations', () => {
      const migrator = new DocumentMigrator()
        .register({ fromVersion: '0.1', toVersion: '0.2', description: 'Alpha', migrate: (d) => ({ ...d, version: '0.2' }) })
        .register({ fromVersion: '0.2', toVersion: '0.3', description: 'Beta', migrate: (d) => ({ ...d, version: '0.3' }) })
        .register({ fromVersion: '0.3', toVersion: '1.0', description: 'Gamma', migrate: (d) => ({ ...d, version: '1.0' }) });

      const result = migrator.migrate({ version: '0.1' });

      expect(result.applied).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('tracks partial chain from intermediate version', () => {
      const migrator = new DocumentMigrator()
        .register({ fromVersion: '0.1', toVersion: '0.2', description: 'First', migrate: (d) => ({ ...d, version: '0.2' }) })
        .register({ fromVersion: '0.2', toVersion: '1.0', description: 'Second', migrate: (d) => ({ ...d, version: '1.0' }) });

      const result = migrator.migrate({ version: '0.2' });

      expect(result.applied).toEqual(['Second']);
    });

    it('returns empty applied array when no migration needed', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      const result = migrator.migrate({ version: '1.0' });
      expect(result.applied).toEqual([]);
    });
  });

  // ── Migration path calculation ────────────────────────────────────────

  describe('getMigrationPath', () => {
    it('returns empty array when from equals to', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '1.0'));

      expect(migrator.getMigrationPath('1.0', '1.0')).toEqual([]);
    });

    it('finds a direct single-step path', () => {
      const m = makeMigration('0.1', '1.0');
      const migrator = new DocumentMigrator().register(m);

      const path = migrator.getMigrationPath('0.1', '1.0');
      expect(path).toHaveLength(1);
      expect(path[0]!.fromVersion).toBe('0.1');
      expect(path[0]!.toVersion).toBe('1.0');
    });

    it('finds a multi-step path', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '0.3'))
        .register(makeMigration('0.3', '1.0'));

      const path = migrator.getMigrationPath('0.1', '1.0');
      expect(path).toHaveLength(3);
      expect(path[0]!.fromVersion).toBe('0.1');
      expect(path[1]!.fromVersion).toBe('0.2');
      expect(path[2]!.fromVersion).toBe('0.3');
    });

    it('returns empty array when no path exists', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'));

      const path = migrator.getMigrationPath('0.1', '1.0');
      expect(path).toEqual([]);
    });

    it('returns empty array when starting version has no migration', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.2', '1.0'));

      const path = migrator.getMigrationPath('0.1', '1.0');
      expect(path).toEqual([]);
    });

    it('finds partial path in the middle of a chain', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.1', '0.2'))
        .register(makeMigration('0.2', '0.3'))
        .register(makeMigration('0.3', '1.0'));

      const path = migrator.getMigrationPath('0.2', '1.0');
      expect(path).toHaveLength(2);
      expect(path[0]!.fromVersion).toBe('0.2');
      expect(path[1]!.fromVersion).toBe('0.3');
    });
  });

  // ── Error cases ────────────────────────────────────────────────────────

  describe('error cases', () => {
    it('throws when no migration path is found', () => {
      const migrator = new DocumentMigrator()
        .register(makeMigration('0.2', '0.3'))
        .register(makeMigration('0.3', '1.0'));

      expect(() => migrator.migrate({ version: '0.1' })).toThrow('No migration path');
    });

    it('throws when no migrations are registered and version is missing', () => {
      const migrator = new DocumentMigrator();
      expect(() => migrator.migrate({})).toThrow('No migrations registered');
    });
  });
});

// ---------------------------------------------------------------------------
// Default migrator with built-in migrations
// ---------------------------------------------------------------------------

describe('defaultMigrator', () => {
  it('has built-in migrations registered', () => {
    const list = defaultMigrator.listMigrations();
    expect(list.length).toBe(3);
  });

  it('current version matches PROTOCOL_VERSION', () => {
    expect(defaultMigrator.currentVersion()).toBe(PROTOCOL_VERSION);
    expect(defaultMigrator.currentVersion()).toBe('1.0');
  });

  it('has migration from 0.1 to 0.2', () => {
    const list = defaultMigrator.listMigrations();
    const m = list.find((m) => m.fromVersion === '0.1' && m.toVersion === '0.2');
    expect(m).toBeDefined();
    expect(m!.description).toContain('nonce');
  });

  it('has migration from 0.2 to 0.3', () => {
    const list = defaultMigrator.listMigrations();
    const m = list.find((m) => m.fromVersion === '0.2' && m.toVersion === '0.3');
    expect(m).toBeDefined();
    expect(m!.description).toContain('publicKey');
  });

  it('has migration from 0.3 to 1.0', () => {
    const list = defaultMigrator.listMigrations();
    const m = list.find((m) => m.fromVersion === '0.3' && m.toVersion === '1.0');
    expect(m).toBeDefined();
    expect(m!.description).toContain('version');
  });

  // ── Built-in migration: 0.1 -> 0.2 (add nonce) ───────────────────────

  describe('migration 0.1 -> 0.2: add nonce', () => {
    it('adds a nonce when missing', () => {
      const doc = { version: '0.1', id: 'test', constraints: 'x' };
      const path = defaultMigrator.getMigrationPath('0.1', '0.2');
      expect(path).toHaveLength(1);

      const migrated = path[0]!.migrate(doc);
      expect(migrated.version).toBe('0.2');
      expect(typeof migrated.nonce).toBe('string');
      expect((migrated.nonce as string).length).toBe(64);
    });

    it('preserves existing nonce', () => {
      const doc = { version: '0.1', nonce: 'a'.repeat(64) };
      const path = defaultMigrator.getMigrationPath('0.1', '0.2');

      const migrated = path[0]!.migrate(doc);
      expect(migrated.nonce).toBe('a'.repeat(64));
    });
  });

  // ── Built-in migration: 0.2 -> 0.3 (lowercase hex) ───────────────────

  describe('migration 0.2 -> 0.3: normalize publicKey', () => {
    it('normalizes issuer publicKey to lowercase', () => {
      const doc = {
        version: '0.2',
        issuer: { id: 'i', publicKey: 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890', role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', role: 'beneficiary' },
      };
      const path = defaultMigrator.getMigrationPath('0.2', '0.3');

      const migrated = path[0]!.migrate(doc);
      expect(migrated.version).toBe('0.3');
      expect((migrated.issuer as Record<string, unknown>).publicKey).toBe(
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      );
    });

    it('normalizes beneficiary publicKey to lowercase', () => {
      const doc = {
        version: '0.2',
        issuer: { id: 'i', publicKey: 'aa'.repeat(32), role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'BB'.repeat(32), role: 'beneficiary' },
      };
      const path = defaultMigrator.getMigrationPath('0.2', '0.3');

      const migrated = path[0]!.migrate(doc);
      expect((migrated.beneficiary as Record<string, unknown>).publicKey).toBe('bb'.repeat(32));
    });

    it('handles already lowercase keys', () => {
      const doc = {
        version: '0.2',
        issuer: { id: 'i', publicKey: 'aa'.repeat(32), role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'bb'.repeat(32), role: 'beneficiary' },
      };
      const path = defaultMigrator.getMigrationPath('0.2', '0.3');

      const migrated = path[0]!.migrate(doc);
      expect((migrated.issuer as Record<string, unknown>).publicKey).toBe('aa'.repeat(32));
      expect((migrated.beneficiary as Record<string, unknown>).publicKey).toBe('bb'.repeat(32));
    });
  });

  // ── Built-in migration: 0.3 -> 1.0 (finalize) ────────────────────────

  describe('migration 0.3 -> 1.0: finalize', () => {
    it('sets version to 1.0', () => {
      const doc = { version: '0.3', id: 'test', nonce: 'a'.repeat(64) };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(migrated.version).toBe('1.0');
    });

    it('adds createdAt if missing', () => {
      const doc = { version: '0.3' };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(typeof migrated.createdAt).toBe('string');
      expect((migrated.createdAt as string).length).toBeGreaterThan(0);
    });

    it('preserves existing createdAt', () => {
      const doc = { version: '0.3', createdAt: '2024-01-01T00:00:00.000Z' };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(migrated.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('adds signature placeholder if missing', () => {
      const doc = { version: '0.3' };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(typeof migrated.signature).toBe('string');
    });

    it('adds id placeholder if missing', () => {
      const doc = { version: '0.3' };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(typeof migrated.id).toBe('string');
    });

    it('adds nonce if still missing at 0.3 -> 1.0', () => {
      const doc = { version: '0.3' };
      const path = defaultMigrator.getMigrationPath('0.3', '1.0');

      const migrated = path[0]!.migrate(doc);
      expect(typeof migrated.nonce).toBe('string');
      expect((migrated.nonce as string).length).toBe(64);
    });
  });

  // ── Full chain migration ──────────────────────────────────────────────

  describe('full chain migration 0.1 -> 1.0', () => {
    it('migrates a v0.1 document all the way to 1.0', () => {
      const doc: Record<string, unknown> = {
        version: '0.1',
        issuer: { id: 'i', publicKey: 'AB'.repeat(32), role: 'issuer' },
        beneficiary: { id: 'b', publicKey: 'CD'.repeat(32), role: 'beneficiary' },
        constraints: "permit read on '/data'",
      };

      const result = defaultMigrator.migrate(doc);

      expect(result.document.version).toBe('1.0');
      expect(result.applied).toHaveLength(3);

      // Nonce should have been added
      expect(typeof result.document.nonce).toBe('string');
      expect((result.document.nonce as string).length).toBe(64);

      // Public keys should be normalized to lowercase
      expect((result.document.issuer as Record<string, unknown>).publicKey).toBe('ab'.repeat(32));
      expect((result.document.beneficiary as Record<string, unknown>).publicKey).toBe('cd'.repeat(32));

      // Required fields should be present
      expect(typeof result.document.createdAt).toBe('string');
      expect(typeof result.document.signature).toBe('string');
      expect(typeof result.document.id).toBe('string');
    });

    it('needsMigration returns false after migration', () => {
      const doc: Record<string, unknown> = { version: '0.1' };
      const result = defaultMigrator.migrate(doc);

      expect(defaultMigrator.needsMigration(result.document as { version?: string })).toBe(false);
    });
  });
});
