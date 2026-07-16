/**
 * paper-trail.ts, The 3-line integration in 60 seconds.
 *
 * The pitch: your AI agents are making consequential decisions with no paper
 * trail. Server logs are your own testimony, opposing counsel attacks them
 * first in discovery. Nobulex wraps any LangChain runnable and produces
 * bilateral cryptographic receipts: tamper-evident, hash-chained, independently
 * verifiable evidence of every LLM call, tool invocation, and chain step.
 *
 * Three lines:
 *
 *   import { nobulex } from '@nobulex/langchain'
 *   const agent = nobulex.wrap(yourAgent, { covenant: 'your-policy-id' })
 *   const result = await agent.invoke(input)   // ← that's it
 *
 * Every action is now signed evidence. Pull the audit log when you need
 * it. Verify integrity at any point. Hand the receipts to your auditor,
 * insurer, regulator, or court.
 *
 * Run with: npx tsx examples/paper-trail.ts
 *
 * No real LangChain dependency required, this file simulates a runnable
 * so the example is hermetic. In production you'd pass a real chain or
 * AgentExecutor; the wrap call is the same.
 */

import { nobulex } from '@nobulex/langchain';
import type { Runnable } from '@nobulex/langchain';

// ── tiny terminal styling (no deps) ─────────────────────────────────────
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
  white: '\x1b[37m',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function header(title: string, subtitle?: string): void {
  const bar = '═'.repeat(72);
  console.log(`\n${C.cyan}${C.bold}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${title}${C.reset}`);
  if (subtitle) console.log(`${C.dim}  ${subtitle}${C.reset}`);
  console.log(`${C.cyan}${C.bold}${bar}${C.reset}\n`);
}

function step(n: number, label: string): void {
  console.log(`${C.magenta}${C.bold}STEP ${n}${C.reset}  ${C.white}${label}${C.reset}`);
}

function info(text: string): void {
  console.log(`        ${C.dim}${text}${C.reset}`);
}

function code(text: string): void {
  console.log(`${C.gray}        │${C.reset} ${C.cyan}${text}${C.reset}`);
}

function ok(text: string): void {
  console.log(`${C.green}        ✓${C.reset} ${text}`);
}

function bad(text: string): void {
  console.log(`${C.red}        ✗${C.reset} ${text}`);
}

function blank(): void {
  console.log('');
}

// ── a simulated LangChain runnable ──────────────────────────────────────
// This stands in for a real LangChain AgentExecutor or LLMChain. In a real
// project you'd swap this for your actual agent, the wrap() call is the
// same regardless.

type LoanApplication = {
  applicantId: string;
  amount: number;
  income: number;
  creditScore: number;
};

type Decision = {
  approved: boolean;
  reason: string;
  reviewedBy: string;
};

class LoanApprovalAgent implements Runnable<LoanApplication, Decision> {
  // In production, this would be an LLMChain or AgentExecutor that calls
  // a real model, runs tools, and returns a structured decision. The
  // shape of `invoke` matches the LangChain Runnable interface exactly.
  async invoke(input: LoanApplication, options?: Record<string, unknown>): Promise<Decision> {
    // LangChain's callback system passes our handler through `options.callbacks`.
    // We forward the lifecycle events the handler expects so this hermetic
    // example produces a realistic audit trail. With a real LangChain
    // runnable, the framework emits these events for you, you don't write
    // this part.
    const handlers = (options?.callbacks as Array<{
      handleChainStart?: Function;
      handleLLMStart?: Function;
      handleLLMEnd?: Function;
      handleToolStart?: Function;
      handleToolEnd?: Function;
      handleChainEnd?: Function;
    }>) ?? [];

    const runId = `run-${Date.now()}`;

    for (const h of handlers) {
      if (h.handleChainStart) {
        await h.handleChainStart({ name: 'LoanApprovalAgent' }, input as unknown as Record<string, unknown>, runId);
      }
    }

    // simulated LLM reasoning call
    for (const h of handlers) {
      if (h.handleLLMStart) {
        await h.handleLLMStart(
          { name: 'gpt-4o' },
          [`Evaluate loan application: ${JSON.stringify(input)}`],
          `${runId}-llm-1`,
          runId,
        );
      }
    }
    await sleep(80);
    for (const h of handlers) {
      if (h.handleLLMEnd) {
        await h.handleLLMEnd(
          { generations: [[{ text: 'Need to check credit history and income verification' }]] },
          `${runId}-llm-1`,
        );
      }
    }

    // simulated tool call: credit check
    for (const h of handlers) {
      if (h.handleToolStart) {
        await h.handleToolStart(
          { name: 'credit_check' },
          JSON.stringify({ applicantId: input.applicantId }),
          `${runId}-tool-1`,
          runId,
        );
      }
    }
    await sleep(60);
    for (const h of handlers) {
      if (h.handleToolEnd) {
        await h.handleToolEnd(
          JSON.stringify({ score: input.creditScore, history: 'clean' }),
          `${runId}-tool-1`,
        );
      }
    }

    // simulated tool call: income verification
    for (const h of handlers) {
      if (h.handleToolStart) {
        await h.handleToolStart(
          { name: 'income_verification' },
          JSON.stringify({ applicantId: input.applicantId }),
          `${runId}-tool-2`,
          runId,
        );
      }
    }
    await sleep(60);
    for (const h of handlers) {
      if (h.handleToolEnd) {
        await h.handleToolEnd(
          JSON.stringify({ verified: true, income: input.income }),
          `${runId}-tool-2`,
        );
      }
    }

    // final LLM call: decision
    for (const h of handlers) {
      if (h.handleLLMStart) {
        await h.handleLLMStart(
          { name: 'gpt-4o' },
          [`Given credit ${input.creditScore} and income ${input.income}, decide on $${input.amount} loan`],
          `${runId}-llm-2`,
          runId,
        );
      }
    }
    await sleep(80);

    const debtToIncome = input.amount / (input.income * 4);
    const approved = input.creditScore >= 680 && debtToIncome < 0.4;
    const decision: Decision = {
      approved,
      reason: approved
        ? `Credit score ${input.creditScore} ≥ 680 and debt-to-income ratio ${debtToIncome.toFixed(2)} < 0.40`
        : `Credit score ${input.creditScore} or debt-to-income ratio ${debtToIncome.toFixed(2)} outside policy`,
      reviewedBy: 'loan-agent-v1',
    };

    for (const h of handlers) {
      if (h.handleLLMEnd) {
        await h.handleLLMEnd({ generations: [[{ text: JSON.stringify(decision) }]] }, `${runId}-llm-2`);
      }
    }

    for (const h of handlers) {
      if (h.handleChainEnd) {
        await h.handleChainEnd(decision as unknown as Record<string, unknown>, runId);
      }
    }

    return decision;
  }
}

// ── the demo ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  header(
    'Nobulex, the paper trail for AI agents',
    'Wrap any LangChain runnable. Every action becomes signed evidence.',
  );

  // ── Step 1: The three lines ────────────────────────────────────────────
  step(1, 'Three lines of code.');
  blank();
  code("import { nobulex } from '@nobulex/langchain'");
  code('');
  code('const myAgent = new LoanApprovalAgent()');
  code(
    "const agent = nobulex.wrap(myAgent, { covenant: 'lending-policy-v3' })",
  );
  blank();
  info('That is the entire integration. No workflow changes. No new SDK.');
  info('Every LLM call, tool invocation, and chain step is now signed evidence.');
  blank();

  const myAgent = new LoanApprovalAgent();
  const agent = nobulex.wrap(myAgent, {
    covenant: 'lending-policy-v3',
    agentId: 'loan-agent-prod-east-1',
  });

  // ── Step 2: Make a real decision ───────────────────────────────────────
  step(2, 'Your agent makes a decision. Same code as before.');
  blank();

  const application: LoanApplication = {
    applicantId: 'APP-2026-05-10-78421',
    amount: 45000,
    income: 92000,
    creditScore: 742,
  };

  info(`Application: ${application.applicantId}`);
  info(`Amount: $${application.amount.toLocaleString()}, Income: $${application.income.toLocaleString()}, Credit: ${application.creditScore}`);
  blank();

  const decision = await agent.invoke(application);

  if (decision.approved) {
    ok(`Decision: APPROVED`);
  } else {
    bad(`Decision: DENIED`);
  }
  info(`Reason: ${decision.reason}`);
  info(`Reviewed by: ${decision.reviewedBy}`);
  blank();

  // ── Step 3: The receipts that were silently produced ───────────────────
  step(3, 'A signed paper trail was silently produced.');
  blank();

  const auditLog = await agent.getAuditLog();

  info(`Agent ID:       ${auditLog.agentId}`);
  info(`Covenant:       ${auditLog.covenant}`);
  info(`Actions logged: ${auditLog.items.length}`);
  info(`Time range:     ${auditLog.startTime}`);
  info(`                ${auditLog.endTime}`);
  blank();

  console.log(`${C.dim}        Action timeline:${C.reset}`);
  for (const item of auditLog.items) {
    const t = item.actionType.padEnd(14);
    const h = item.hash.slice(0, 12);
    console.log(`${C.dim}        ├─${C.reset} ${C.yellow}${t}${C.reset}  ${C.gray}hash:${h}…${C.reset}`);
  }
  blank();

  info(`Merkle root:    ${auditLog.merkleRoot.slice(0, 48)}…`);
  info(`Signature:      ${auditLog.signature.slice(0, 48)}…`);
  info(`Signer pubkey:  ${auditLog.signerPublicKey.slice(0, 48)}…`);
  blank();
  ok('Receipt set is hash-chained, signed, and independently verifiable.');
  blank();

  // ── Step 4: Prove integrity ────────────────────────────────────────────
  step(4, 'Anyone can verify the paper trail.');
  blank();

  const integrity = await agent.verifyIntegrity();

  if (integrity.valid) {
    ok(`Integrity check passed`);
    info(`Items verified:    ${integrity.totalItems}`);
    info(`Signature valid:   ${integrity.signatureValid}`);
    info(`Merkle root:       ${integrity.merkleRoot?.slice(0, 32)}…`);
  } else {
    bad(`Integrity check failed`);
    for (const err of integrity.errors) info(`  - ${err}`);
  }
  blank();

  info('A third party (auditor, insurer, court, opposing counsel) can run the');
  info('same verification independently. They do not need to trust your logs.');
  info('They verify the signatures against the public key. Math, not testimony.');
  blank();

  // ── Step 5: Why this matters ───────────────────────────────────────────
  header('Why this matters', 'The difference between logs and a paper trail.');

  console.log(`${C.bold}        Server logs (CloudTrail, Datadog, LangSmith):${C.reset}`);
  console.log(`${C.red}        ✗${C.reset} You control them, therefore self-serving evidence`);
  console.log(`${C.red}        ✗${C.reset} Tampering is not cryptographically prevented`);
  console.log(`${C.red}        ✗${C.reset} Discovery counsel attacks them first`);
  console.log(`${C.red}        ✗${C.reset} Insurance underwriters can't price them as evidence`);
  blank();

  console.log(`${C.bold}        Nobulex bilateral receipts:${C.reset}`);
  console.log(`${C.green}        ✓${C.reset} Hash-chained, tampering is detectable`);
  console.log(`${C.green}        ✓${C.reset} Signed, origin is provable`);
  console.log(`${C.green}        ✓${C.reset} Independently verifiable, no need to trust you`);
  console.log(`${C.green}        ✓${C.reset} Same evidence holds up in court, audit, and underwriting`);
  blank();

  console.log(`${C.cyan}${C.bold}        The pitch in twelve words:${C.reset}`);
  console.log(`        ${C.white}Your humans have paper trails. Your AI agents don't. We fix that.${C.reset}`);
  blank();

  console.log(`${C.dim}        Next steps: github.com/arian-gogani/nobulex${C.reset}`);
  console.log(`${C.dim}                    nobulex.com${C.reset}`);
  blank();
}

main().catch((err) => {
  console.error('\nError:', err);
  process.exit(1);
});
