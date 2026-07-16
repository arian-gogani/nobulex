/*
 * Minimal hand-written arg parser, no dep on `util.parseArgs` so this keeps
 * working on Node 18 without polyfills. Recognises:
 *   - bare positionals
 *   - `--flag` / `--flag=value` / `--flag value`
 *   - `-f` short aliases (registered per-caller)
 * Unknown flags are captured in `extras` instead of erroring; each subcommand
 * decides which flags it cares about.
 */

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseArgs(
  argv: readonly string[],
  opts: { aliases?: Record<string, string>; boolean?: readonly string[] } = {},
): ParsedArgs {
  const aliases = opts.aliases ?? {};
  const booleans = new Set(opts.boolean ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (!raw.startsWith('-')) {
      positionals.push(raw);
      continue;
    }

    // --name=value or --name or -n
    let name: string;
    let value: string | undefined;
    if (raw.startsWith('--')) {
      const eq = raw.indexOf('=');
      if (eq >= 0) {
        name = raw.slice(2, eq);
        value = raw.slice(eq + 1);
      } else {
        name = raw.slice(2);
      }
    } else {
      const short = raw.slice(1);
      name = aliases[short] ?? short;
    }

    if (value === undefined) {
      // boolean flag, or value is the next positional
      if (booleans.has(name)) {
        flags[name] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) {
          flags[name] = true;
        } else {
          flags[name] = next;
          i++;
        }
      }
    } else {
      flags[name] = value;
    }
  }

  return { positionals, flags };
}
