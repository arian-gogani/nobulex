/**
 * The contract every subcommand honours: pure function → structured result.
 * The `bin.ts` shim is the only layer that writes to stdout / calls process.exit,
 * so every subcommand is trivially testable.
 */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}

/** Minimal filesystem shim so tests can inject an in-memory FS. */
export interface FileSystem {
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, contents: string) => void;
  readonly mkdir: (path: string) => void;
  readonly exists: (path: string) => boolean;
}
