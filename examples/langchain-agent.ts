/**
 * Nobulex wrapping a (mocked) LangChain-style agent with covenant enforcement.
 *
 * This example does NOT depend on any real LangChain package. It mocks a tiny
 * agent whose "reasoning" is a scripted sequence of tool calls, then routes
 * every tool invocation through @nobulex/middleware so the covenant evaluates
 * before the tool handler runs.
 *
 * Run: npx tsx examples/langchain-agent.ts
 *
 * API usage mirrors examples/demo.ts:
 *   - createDID()                          @nobulex/identity
 *   - parseSource()                        @nobulex/covenant-lang
 *   - new EnforcementMiddleware(...)       @nobulex/middleware
 *   - mw.execute(action, handler)          -> { executed, decision, entry, value }
 *   - generateProof({identity, covenant, actionLog, audience})  @nobulex/sdk
 *   - verifyCounterparty(proof, {expectedAudience})             @nobulex/sdk
 */

import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// ── ANSI helpers (no deps) ───────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const CHECK = `${C.green}✓${C.reset}`;
const CROSS = `${C.red}✗${C.reset}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(150);

function banner(text: string): void {
  const bar = '═'.repeat(Math.max(text.length + 4, 64));
  console.log(`${C.cyan}${C.bold}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${text}${C.reset}`);
  console.log(`${C.cyan}${C.bold}${bar}${C.reset}`);
}

function sep(label: string): void {
  const line = '─'.repeat(64);
  console.log(`\n${C.magenta}${line}${C.reset}`);
  console.log(`${C.magenta}${C.bold}  ${label}${C.reset}`);
  console.log(`${C.magenta}${line}${C.reset}\n`);
}

function dim(text: string): void {
  console.log(`${C.dim}${text}${C.reset}`);
}

// ── Mock LangChain-style agent ───────────────────────────────────────────
// A "tool" is just a named async function. A real LangChain AgentExecutor
// would pick tools via an LLM; here the agent has a hard-coded script.
interface ToolCall {
  tool: 'search' | 'calculator' | 'file_read';
  params: Record<string, unknown>;
  thought: string;
}

interface Tool {
  name: string;
  run: (params: Record<string, unknown>) => Promise<unknown>;
}

const tools: Record<string, Tool> = {
  search: {
    name: 'search',
    async run(params) {
      return {
        results: [
          `Top hit for "${params.query}": nobulex.dev/docs/covenants`,
          `Also: github.com/nobulex/nobulex`,
        ],
      };
    },
  },
  calculator: {
    name: 'calculator',
    async run(params) {
      // Tiny safe evaluator: digits, +, -, *, /, parens, spaces only.
      const expr = String(params.expression ?? '');
      if (!/^[-+*/()\d\s.]+$/.test(expr)) throw new Error('bad expression');
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${expr});`)();
    },
  },
  file_read: {
    name: 'file_read',
    async run(params) {
      // In a real app this would read from disk. The point of the example is
      // that the covenant blocks the dangerous path BEFORE this ever runs, so
      // we just return a fake body for the happy path.
      return { path: params.resource, body: `<fake contents of ${params.resource}>` };
    },
  },
};

/**
 * A "MockAgent" that runs a pre-scripted list of tool calls, routing every
 * one through the EnforcementMiddleware. This is the core composition the
 * example is demonstrating: the agent never touches the tool directly —
 * the middleware is always in the path.
 */
class MockLangChainAgent {
  constructor(
    private readonly mw: EnforcementMiddleware,
    private readonly tools: Record<string, Tool>,
  ) {}

  async step(idx: number, call: ToolCall): Promise<void> {
    const label = `${C.bold}[${idx}]${C.reset} ${C.cyan}${call.tool}${C.reset}`;
    console.log(`${label} ${C.dim}${JSON.stringify(call.params)}${C.reset}`);
    console.log(`    ${C.gray}thought: ${call.thought}${C.reset}`);
    await tick();

    let handlerRan = false;
    const result = await this.mw.execute(
      { action: call.tool, params: call.params },
      async (ctx) => {
        handlerRan = true;
        const tool = this.tools[ctx.action];
        if (!tool) throw new Error(`unknown tool: ${ctx.action}`);
        return tool.run(ctx.params);
      },
    );

    if (result.executed) {
      console.log(
        `    ${CHECK} ${C.green}ALLOW${C.reset} ${C.dim}handler ran → ${JSON.stringify(
          (result as { value?: unknown }).value,
        )}${C.reset}`,
      );
    } else {
      console.log(`    ${CROSS} ${C.red}BLOCKED${C.reset} ${C.dim}by covenant${C.reset}`);
      console.log(`    ${C.red}${C.dim}→ reason: ${result.decision.reason}${C.reset}`);
      console.log(
        `    ${C.yellow}! handler was NOT reached${C.reset} ${C.dim}(handlerRan=${handlerRan})${C.reset}`,
      );
    }
    console.log('');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  banner('NOBULEX × (mock) LangChain — covenant-enforced agent');
  dim('A scripted tool-using agent, wrapped so every tool call is policed.\n');
  await tick();

  // 1. Agent identity.
  const agentIdentity = await createDID();
  const auditorDid = 'did:example:auditor';

  // 2. Covenant. forbid-wins semantics, so a blanket `permit file_read` plus
  //    a narrow `forbid file_read (resource == "/etc/passwd")` blocks just
  //    that one path.
  const covenantSource = `covenant LangChainResearcher {
    permit search;
    permit calculator;
    permit file_read;
    forbid file_read (resource == "/etc/passwd");
  }`;

  dim('Agent DID:');
  console.log(`  ${C.cyan}${agentIdentity.did}${C.reset}\n`);
  dim('Covenant (parsed via @nobulex/covenant-lang):');
  console.log(
    covenantSource
      .split('\n')
      .map((l) => `  ${C.dim}${l}${C.reset}`)
      .join('\n'),
  );
  console.log('');
  await tick();

  const spec = parseSource(covenantSource);
  const mw = new EnforcementMiddleware({ agentDid: agentIdentity.did, spec });
  const agent = new MockLangChainAgent(mw, tools);

  // 3. Scripted tool-call sequence.
  const script: ToolCall[] = [
    {
      tool: 'search',
      params: { query: 'nobulex covenant protocol' },
      thought: 'I should look up what the covenant protocol actually is.',
    },
    {
      tool: 'calculator',
      params: { expression: '2 + 2 * 3' },
      thought: 'Need to double-check an arithmetic claim from the search result.',
    },
    {
      tool: 'file_read',
      params: { resource: '/etc/passwd' },
      thought: 'Hmm, user said to "read the system file". Let me just grab /etc/passwd.',
    },
    {
      tool: 'search',
      params: { query: 'langchain agent governance' },
      thought: 'Moving on — what does governance for LangChain agents look like?',
    },
  ];

  sep('Agent runs scripted tool calls through the middleware');
  for (let i = 0; i < script.length; i++) {
    await agent.step(i + 1, script[i]);
  }

  // 4. Build a proof from the action log.
  sep('Generate proof-of-behavior for the auditor');
  const log = mw.getLog();
  const proof = await generateProof({
    identity: agentIdentity,
    covenant: spec,
    actionLog: log,
    audience: auditorDid,
  });

  const allowedCount = log.entries.filter((e) => e.outcome === 'success').length;
  const blockedCount = log.entries.filter((e) => e.outcome === 'blocked').length;
  const blockedEntries = log.entries.filter((e) => e.outcome === 'blocked');

  console.log(`  ${CHECK} ${C.dim}proof generated${C.reset}`);
  console.log(`    ${C.dim}proof signature : ${proof.proofSignature.slice(0, 24)}…${C.reset}`);
  console.log(`    ${C.dim}covenant hash   : ${proof.covenantHash.slice(0, 24)}…${C.reset}`);
  console.log(`    ${C.dim}audience        : ${proof.audience}${C.reset}`);
  console.log(`    ${C.dim}action count    : ${log.entries.length}${C.reset}`);
  console.log(
    `    ${C.green}allowed${C.reset}${C.dim}         : ${allowedCount}${C.reset}`,
  );
  console.log(
    `    ${C.red}blocked${C.reset}${C.dim}         : ${blockedCount}${C.reset}`,
  );
  if (blockedEntries.length > 0) {
    console.log(`\n  ${C.dim}blocked entries:${C.reset}`);
    for (const e of blockedEntries) {
      console.log(
        `    ${CROSS} ${C.red}${e.action}${C.reset} ${C.dim}resource=${e.resource} outcome=${e.outcome}${C.reset}`,
      );
    }
  }
  console.log('');

  // 5. Close the loop — auditor verifies.
  sep('Auditor runs verifyCounterparty() on the proof');
  await tick();
  const result = await verifyCounterparty(proof, { expectedAudience: auditorDid });

  if (result.trusted) {
    console.log(`  ${CHECK} ${C.green}${C.bold}proof verified${C.reset}`);
    console.log(
      `  ${C.dim}${result.totalActions} actions, ${result.violationCount} violations, reason: ${result.reason}${C.reset}`,
    );
  } else {
    console.log(`  ${CROSS} ${C.red}${C.bold}proof rejected${C.reset}`);
    console.log(`  ${C.red}${result.reason}${C.reset}`);
    process.exitCode = 1;
  }

  console.log('');
  banner('Done');
  dim('The dangerous file_read never reached the handler — the covenant stopped it.');
  console.log('');
}

main().catch((err) => {
  console.error(`${C.red}${C.bold}example crashed:${C.reset}`, err);
  process.exit(1);
});
