/**
 * @stele/core/migration — Document migration system for protocol version upgrades.
 *
 * Provides a `DocumentMigrator` class that can chain version-specific migrations
 * to upgrade CovenantDocument structures from older protocol versions to the current one.
 *
 * Ships with built-in migrations:
 *   0.1 -> 0.2: Add nonce field if missing
 *   0.2 -> 0.3: Normalize publicKey to lowercase hex
 *   0.3 -> 1.0: Add version field, ensure all required fields present
 *
 * @packageDocumentation
 */

import { generateNonce, toHex } from '@stele/crypto';
import { PROTOCOL_VERSION } from './types.js';

// ─── Public types ────────────────────────────────────────────────────────────────

/** Describes a single version-to-version migration step. */
export interface Migration {
  /** The version this migration upgrades from. */
  fromVersion: string;
  /** The version this migration upgrades to. */
  toVersion: string;
  /** Human-readable description of what this migration does. */
  description: string;
  /** Transform a document from `fromVersion` to `toVersion`. */
  migrate: (doc: Record<string, unknown>) => Record<string, unknown>;
}

// ─── DocumentMigrator ────────────────────────────────────────────────────────────

/**
 * A registry of ordered migrations that can upgrade CovenantDocument structures
 * from older protocol versions to the current one.
 *
 * Migrations are applied in sequence along the shortest version path.
 *
 * @example
 * ```typescript
 * const migrator = new DocumentMigrator();
 * migrator.register({ fromVersion: '0.9', toVersion: '1.0', description: '...', migrate: fn });
 *
 * if (migrator.needsMigration(doc)) {
 *   const { document, applied } = migrator.migrate(doc);
 * }
 * ```
 */
export class DocumentMigrator {
  private migrations: Migration[] = [];

  /**
   * Register a migration step.
   *
   * @param migration - The migration to register.
   * @returns `this` for chaining.
   */
  register(migration: Migration): this {
    this.migrations.push(migration);
    return this;
  }

  /**
   * Get the current protocol version (the highest `toVersion` among
   * registered migrations, or PROTOCOL_VERSION if no migrations exist).
   */
  currentVersion(): string {
    if (this.migrations.length === 0) {
      return PROTOCOL_VERSION;
    }

    // Find the highest toVersion by walking the migration chain
    // The current version is the one that no migration upgrades FROM
    const fromVersions = new Set(this.migrations.map((m) => m.fromVersion));
    const toVersions = this.migrations.map((m) => m.toVersion);

    // A terminal version is one that appears as a toVersion but not as a fromVersion
    for (const tv of toVersions) {
      if (!fromVersions.has(tv)) {
        return tv;
      }
    }

    // Fallback: use PROTOCOL_VERSION
    return PROTOCOL_VERSION;
  }

  /**
   * Check whether a document needs migration (its version differs from
   * the current version).
   *
   * @param doc - An object with an optional `version` field.
   * @returns `true` if the document's version is missing or differs from current.
   */
  needsMigration(doc: { version?: string }): boolean {
    const current = this.currentVersion();
    return doc.version !== current;
  }

  /**
   * Migrate a document to the current version by applying all necessary
   * migration steps in order.
   *
   * @param doc - The document to migrate (as a plain object).
   * @returns An object with the migrated `document` and a list of `applied` migration descriptions.
   * @throws {Error} When no migration path can be found.
   */
  migrate(doc: Record<string, unknown>): { document: Record<string, unknown>; applied: string[] } {
    const current = this.currentVersion();
    const docVersion = (typeof doc.version === 'string' ? doc.version : undefined);

    // If already current, return as-is
    if (docVersion === current) {
      return { document: { ...doc }, applied: [] };
    }

    // Determine the starting version
    const startVersion = docVersion ?? this.findEarliestVersion();

    if (startVersion === undefined) {
      throw new Error(
        `No migrations registered; cannot migrate document with version "${docVersion ?? '(none)'}"`,
      );
    }

    // Find the migration path
    const path = this.getMigrationPath(startVersion, current);
    if (path.length === 0 && startVersion !== current) {
      throw new Error(
        `No migration path from version "${startVersion}" to "${current}"`,
      );
    }

    // Apply each migration in sequence
    let result: Record<string, unknown> = { ...doc };
    const applied: string[] = [];

    for (const migration of path) {
      result = migration.migrate(result);
      applied.push(migration.description);
    }

    return { document: result, applied };
  }

  /**
   * List all registered migrations.
   *
   * @returns A copy of the migrations array.
   */
  listMigrations(): Migration[] {
    return [...this.migrations];
  }

  /**
   * Compute the migration path from one version to another using
   * breadth-first search through the migration graph.
   *
   * @param from - The starting version.
   * @param to   - The target version.
   * @returns An ordered array of migrations to apply.
   */
  getMigrationPath(from: string, to: string): Migration[] {
    if (from === to) return [];

    // BFS through the migration graph
    const queue: Array<{ version: string; path: Migration[] }> = [
      { version: from, path: [] },
    ];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Find all migrations from current.version
      for (const migration of this.migrations) {
        if (migration.fromVersion === current.version && !visited.has(migration.toVersion)) {
          const newPath = [...current.path, migration];

          if (migration.toVersion === to) {
            return newPath;
          }

          visited.add(migration.toVersion);
          queue.push({ version: migration.toVersion, path: newPath });
        }
      }
    }

    return [];
  }

  /**
   * Find the earliest version (one that no migration targets as toVersion).
   */
  private findEarliestVersion(): string | undefined {
    if (this.migrations.length === 0) return undefined;

    const toVersions = new Set(this.migrations.map((m) => m.toVersion));

    for (const migration of this.migrations) {
      if (!toVersions.has(migration.fromVersion)) {
        return migration.fromVersion;
      }
    }

    // Fallback to the first migration's fromVersion
    return this.migrations[0]!.fromVersion;
  }
}

// ─── Built-in migrations ──────────────────────────────────────────────────────────

/**
 * Migration 0.1 -> 0.2: Add nonce field if missing.
 *
 * Early protocol versions did not require a nonce for replay protection.
 * This migration generates a random 64-character hex nonce.
 */
const migration_0_1_to_0_2: Migration = {
  fromVersion: '0.1',
  toVersion: '0.2',
  description: 'Add nonce field if missing (generate random)',
  migrate(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };
    if (!result.nonce || typeof result.nonce !== 'string' || (result.nonce as string).length === 0) {
      result.nonce = toHex(generateNonce());
    }
    result.version = '0.2';
    return result;
  },
};

/**
 * Migration 0.2 -> 0.3: Normalize publicKey to lowercase hex.
 *
 * Ensures consistent hex encoding across all key references.
 */
const migration_0_2_to_0_3: Migration = {
  fromVersion: '0.2',
  toVersion: '0.3',
  description: 'Normalize publicKey to lowercase hex',
  migrate(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };

    // Normalize issuer publicKey
    if (
      result.issuer &&
      typeof result.issuer === 'object' &&
      !Array.isArray(result.issuer)
    ) {
      const issuer = { ...(result.issuer as Record<string, unknown>) };
      if (typeof issuer.publicKey === 'string') {
        issuer.publicKey = (issuer.publicKey as string).toLowerCase();
      }
      result.issuer = issuer;
    }

    // Normalize beneficiary publicKey
    if (
      result.beneficiary &&
      typeof result.beneficiary === 'object' &&
      !Array.isArray(result.beneficiary)
    ) {
      const beneficiary = { ...(result.beneficiary as Record<string, unknown>) };
      if (typeof beneficiary.publicKey === 'string') {
        beneficiary.publicKey = (beneficiary.publicKey as string).toLowerCase();
      }
      result.beneficiary = beneficiary;
    }

    result.version = '0.3';
    return result;
  },
};

/**
 * Migration 0.3 -> 1.0: Add version field, ensure all required fields present.
 *
 * Final migration to the current protocol version. Sets the version to 1.0
 * and ensures nonce and createdAt are present.
 */
const migration_0_3_to_1_0: Migration = {
  fromVersion: '0.3',
  toVersion: '1.0',
  description: 'Add version field, ensure all required fields present',
  migrate(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };

    result.version = '1.0';

    // Ensure nonce is present
    if (!result.nonce || typeof result.nonce !== 'string' || (result.nonce as string).length === 0) {
      result.nonce = toHex(generateNonce());
    }

    // Ensure createdAt is present
    if (!result.createdAt || typeof result.createdAt !== 'string') {
      result.createdAt = new Date().toISOString();
    }

    // Ensure signature placeholder is present
    if (!result.signature || typeof result.signature !== 'string') {
      result.signature = '';
    }

    // Ensure id placeholder is present
    if (!result.id || typeof result.id !== 'string') {
      result.id = '';
    }

    return result;
  },
};

// ─── Default migrator ─────────────────────────────────────────────────────────────

/**
 * Pre-configured migrator with all built-in migrations registered.
 *
 * Supports migrating documents from version 0.1 through to the current
 * protocol version (1.0).
 */
export const defaultMigrator: DocumentMigrator = new DocumentMigrator()
  .register(migration_0_1_to_0_2)
  .register(migration_0_2_to_0_3)
  .register(migration_0_3_to_1_0);
