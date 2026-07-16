/*
 * `nobulex init`, scaffold a new covenant project.
 *
 * Writes:
 *   covenant.dsl, example covenant, hand-editable
 *   agent.ts, runnable starter that wires the middleware
 *   nobulex.config.json, tool-discoverable metadata (logs path, framework)
 *   README.md, one-page orientation
 *
 * Refuses to overwrite existing files unless --force is set. Printing the
 * written paths lets CI / agents verify scaffolding deterministically.
 */
import * as path from 'node:path';
import type { CommandResult, FileSystem } from './types.js';
import type { ParsedArgs } from './args.js';

const COVENANT_TEMPLATE = `covenant Starter {
  // What your agent is allowed to do. Adjust as needed.
  permit read;
  permit write;

  // Rules your agent is forbidden from violating.
  forbid delete;
  forbid transfer (amount > 1000);

  // Required invariants, every action checks these.
  require agent.verified == true;
}
`;

const AGENT_TS_TEMPLATE = `import { readFileSync } from 'node:fs';
import { EnforcementMiddleware } from '@nobulex/core';
import { parseSource } from '@nobulex/core';

/**
 * Starter agent. Wraps every action through the enforcement middleware;
 * the covenant at ./covenant.dsl decides what is allowed.
 */
async function main() {
  const source = readFileSync('./covenant.dsl', 'utf-8');
  const mw = new EnforcementMiddleware({
    agentDid: 'did:nobulex:starter-agent',
    spec: parseSource(source),
  });

  const result = await mw.execute(
    { action: 'read', params: { agent: { verified: true } } },
    () => ({ ok: true, data: 'hello from starter agent' }),
  );

  console.log(JSON.stringify(result.entry, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const CONFIG_TEMPLATE = `{
  "covenant": "./covenant.dsl",
  "log": "./action-log.json",
  "framework": "eu-ai-act-article-12"
}
`;

const README_TEMPLATE = `# Nobulex starter project

This project was scaffolded by \`nobulex init\`.

## Files

- \`covenant.dsl\`, the covenant your agent must honour. Edit freely.
- \`agent.ts\`, a runnable agent that wires the covenant into \`EnforcementMiddleware\`.
- \`nobulex.config.json\`, tool-discoverable settings (log path, compliance framework).

## Typical flow

\`\`\`bash
# 1. Run the agent. It writes an action log.
npx tsx agent.ts > action-log.json

# 2. Verify the log integrity + covenant compliance.
nobulex verify action-log.json

# 3. Read the timeline.
nobulex inspect action-log.json

# 4. Generate a compliance report for a framework.
nobulex report action-log.json --framework eu-ai-act-article-12
\`\`\`
`;

interface ScaffoldFile {
  readonly filename: string;
  readonly contents: string;
}

const FILES: readonly ScaffoldFile[] = [
  { filename: 'covenant.dsl', contents: COVENANT_TEMPLATE },
  { filename: 'agent.ts', contents: AGENT_TS_TEMPLATE },
  { filename: 'nobulex.config.json', contents: CONFIG_TEMPLATE },
  { filename: 'README.md', contents: README_TEMPLATE },
];

export function runInit(args: ParsedArgs, fs: FileSystem): CommandResult {
  const target = args.positionals[0] ?? '.';
  const force = args.flags['force'] === true;

  const targetAbs = path.resolve(target);

  // Ensure the target directory exists.
  if (!fs.exists(targetAbs)) {
    try {
      fs.mkdir(targetAbs);
    } catch (e) {
      return { exitCode: 1, stdout: '', stderr: `failed to create ${targetAbs}: ${(e as Error).message}\n` };
    }
  }

  // Pre-flight: don't overwrite anything unless --force.
  const collisions: string[] = [];
  for (const file of FILES) {
    const full = path.join(targetAbs, file.filename);
    if (fs.exists(full)) collisions.push(file.filename);
  }
  if (collisions.length > 0 && !force) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `refusing to overwrite existing files: ${collisions.join(', ')} (pass --force to overwrite)\n`,
    };
  }

  const written: string[] = [];
  for (const file of FILES) {
    const full = path.join(targetAbs, file.filename);
    fs.writeFile(full, file.contents);
    written.push(full);
  }

  const lines = [
    `Scaffolded Nobulex project in ${targetAbs}`,
    ...written.map((p) => `  + ${path.relative(targetAbs, p)}`),
    '',
    'Next steps:',
    '  1. Edit covenant.dsl to express your rules',
    '  2. Run the agent: npx tsx agent.ts > action-log.json',
    '  3. Verify the log:  nobulex verify action-log.json',
  ];

  return { exitCode: 0, stdout: lines.join('\n') + '\n' };
}
