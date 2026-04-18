/*
 * Default filesystem backed by node:fs. Tests inject an in-memory variant.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileSystem } from './types.js';

export const nodeFs: FileSystem = {
  readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
  writeFile: (p: string, contents: string) => fs.writeFileSync(p, contents, 'utf-8'),
  mkdir: (p: string) => fs.mkdirSync(p, { recursive: true }),
  exists: (p: string) => fs.existsSync(p),
};

/** Create an in-memory FileSystem. Useful for tests and dry-runs. */
export function memoryFs(initial: Record<string, string> = {}): FileSystem & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    readFile(p) {
      const contents = files.get(path.normalize(p));
      if (contents === undefined) {
        const err = new Error(`ENOENT: no such file, open '${p}'`);
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      return contents;
    },
    writeFile(p, contents) {
      files.set(path.normalize(p), contents);
    },
    mkdir(p) {
      // In-memory, directories are implicit; mark with a sentinel so `exists`
      // returns true for empty dirs too.
      files.set(path.normalize(p) + '/', '');
    },
    exists(p) {
      const normalized = path.normalize(p);
      if (files.has(normalized)) return true;
      if (files.has(normalized + '/')) return true;
      const prefix = normalized + '/';
      for (const key of files.keys()) if (key.startsWith(prefix)) return true;
      return false;
    },
  };
}
