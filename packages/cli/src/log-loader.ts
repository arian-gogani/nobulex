/*
 * Shared: read a file path and parse it into an ActionLog. Also minimally
 * validates the shape, a wrong file path is the most common CLI mistake
 * and we want a friendlier error than `TypeError: entries is undefined`.
 */
import type { ActionLog } from '@nobulex/core';
import type { FileSystem } from './types.js';

export function loadActionLog(pathArg: string, fs: FileSystem): ActionLog {
  let raw: string;
  try {
    raw = fs.readFile(pathArg);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`log file not found: ${pathArg}`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`log file is not valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('log file is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['agentDid'] !== 'string') {
    throw new Error('log file is missing string field: agentDid');
  }
  if (!Array.isArray(obj['entries'])) {
    throw new Error('log file is missing array field: entries');
  }
  // length is derived but we keep permissive: some exporters omit it. Make sure
  // the shape we hand back always has it.
  if (typeof obj['length'] !== 'number') {
    obj['length'] = (obj['entries'] as unknown[]).length;
  }
  if (obj['rootHash'] === undefined) obj['rootHash'] = null;
  if (obj['headHash'] === undefined) obj['headHash'] = null;

  return obj as unknown as ActionLog;
}
