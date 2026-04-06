/**
 * @nobulex/cli configuration file support.
 *
 * Reads and writes `nobulex.config.json` in the current working directory.
 * Zero external dependencies -- uses only Node built-in `fs` and `path`.
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a `nobulex.config.json` configuration file. */
export interface NobulexConfig {
  /** Default issuer identity for `create` / `init`. */
  defaultIssuer?: { id: string; publicKey: string };
  /** Default beneficiary identity for `create`. */
  defaultBeneficiary?: { id: string; publicKey: string };
  /** Path to a JSON file containing a key pair (`{ publicKey, privateKey }`). */
  keyFile?: string;
  /** Default output format for all commands. */
  outputFormat?: 'json' | 'text';
  /** Default CCL constraint string for `create`. */
  constraints?: string;
}

/** Name of the configuration file. */
export const CONFIG_FILE_NAME = 'nobulex.config.json';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for a `nobulex.config.json` starting from `cwd` and walking up to the
 * filesystem root.  Returns the absolute path if found, or `undefined`.
 *
 * @param cwd - Directory to start searching from (defaults to process.cwd()).
 * @returns Absolute path to nobulex.config.json, or undefined if not found.
 */
export function findConfigFile(cwd?: string): string | undefined {
  let dir = resolve(cwd ?? '.');

  // Walk up directory tree
  // eslint-disable-next-line no-constant-condition -- Walk up dirs until root; break on found or root
  while (true) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return undefined;
}

/**
 * Load the `nobulex.config.json` starting from `cwd`.
 * Returns `undefined` if no config file is found.
 * Throws if the file exists but cannot be parsed.
 *
 * @param cwd - Directory to search from (defaults to process.cwd()).
 * @returns Parsed config, or undefined if no config file found.
 */
export function loadConfig(cwd?: string): NobulexConfig | undefined {
  const filePath = findConfigFile(cwd);
  if (!filePath) return undefined;

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as NobulexConfig;
  return parsed;
}

/**
 * Write a `nobulex.config.json` to the given directory (defaults to cwd).
 * Overwrites any existing config file at that location.
 *
 * @param config - The config object to write.
 * @param cwd - Directory to write to (defaults to process.cwd()).
 */
export function saveConfig(config: NobulexConfig, cwd?: string): void {
  const dir = resolve(cwd ?? '.');
  const filePath = join(dir, CONFIG_FILE_NAME);
  const json = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(filePath, json, 'utf-8');
}
