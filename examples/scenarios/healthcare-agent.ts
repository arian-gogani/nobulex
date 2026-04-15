/*
 * Healthcare agent scenario — medical records with role-based access.
 *
 * Run: npx tsx examples/scenarios/healthcare-agent.ts
 */

import { createDID } from '@nobulex/identity';
import { parseSource } from '@nobulex/covenant-lang';
import { EnforcementMiddleware } from '@nobulex/middleware';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', gray: '\x1b[90m',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const requests = [
  { action: 'read', params: { resource: '/patient/12345/labs', role: 'doctor' } },
  { action: 'read', params: { resource: '/patient/12345/medications', role: 'doctor' } },
  { action: 'read', params: { resource: '/patient/12345/billing', role: 'billing' } },
  { action: 'read', params: { resource: '/patient/67890/labs', role: 'doctor' } },
  { action: 'export', params: { resource: '/patient/12345/full-record', role: 'doctor' } },
  { action: 'read', params: { resource: '/patient/67890/notes', role: 'doctor' } },
  { action: 'read', params: { resource: '/patient/12345/diagnosis', role: 'billing' } },
  { action: 'read', params: { resource: '/patient/99999/labs', role: 'doctor' } },
];

async function main() {
  console.log(`\n${C.bold}═══ Healthcare Records — HIPAA Compliance Demo ═══${C.reset}\n`);

  const agent = await createDID();
  console.log(`${C.cyan}Agent ID:${C.reset} ${agent.did.slice(0, 30)}...`);

  const covenant = parseSource(`
    covenant MedicalRecordsAccess {
      permit read (role == "doctor");
      forbid read (role == "billing");
      forbid export;
    }
  `);

  console.log(`${C.cyan}Covenant:${C.reset} MedicalRecordsAccess`);
  console.log(`${C.dim}  Rules: doctors can read, billing blocked, no exports${C.reset}\n`);

  const mw = new EnforcementMiddleware({ agentDid: agent.did, spec: covenant });
  let blocked = 0;
  let allowed = 0;

  console.log(`${C.bold}Processing ${requests.length} access requests...${C.reset}\n`);

  for (const req of requests) {
    await sleep(150);
    const res = await mw.execute(
      { action: req.action, params: req.params },
      async () => ({ success: true }),
    );

    if (res.executed) {
      allowed++;
      console.log(`  ${C.green}✓${C.reset} ${req.action.toUpperCase()} ${req.params.resource} [${req.params.role}] — ${C.green}allowed${C.reset}`);
    } else {
      blocked++;
      const reason = res.decision.reason ?? 'forbidden by covenant';
      console.log(`  ${C.red}✗${C.reset} ${req.action.toUpperCase()} ${req.params.resource} [${req.params.role}] — ${C.red}BLOCKED${C.reset} ${C.dim}(${reason})${C.reset}`);
    }
  }

  console.log(`\n${C.bold}── HIPAA Audit Summary ──${C.reset}`);
  console.log(`  Total access requests: ${requests.length}`);
  console.log(`  ${C.green}Granted:${C.reset} ${allowed}`);
  console.log(`  ${C.red}Denied:${C.reset} ${blocked}`);
  console.log(`  Audit trail entries: ${requests.length}`);

  const proof = await generateProof({
    identity: agent,
    covenant,
    actionLog: mw.getLog(),
  });

  console.log(`\n${C.bold}── Proof of Compliance ──${C.reset}`);
  console.log(`  Actions recorded: ${proof.actionLog.entries.length}`);
  console.log(`  Chain integrity: ${proof.actionLog.headHash?.slice(0, 16)}...`);
  console.log(`  Signed at: ${proof.generatedAt}`);

  console.log(`\n${C.bold}── Compliance Officer Verification ──${C.reset}\n`);
  const result = await verifyCounterparty(proof, { minActions: 1 });

  if (result.trusted) {
    console.log(`  ${C.green}✓ All access requests audited${C.reset}`);
    console.log(`  ${C.green}✓ Unauthorized access blocked pre-execution${C.reset}`);
    console.log(`  ${C.green}✓ Tamper-evident audit trail verified${C.reset}`);
    console.log(`  ${C.green}✓ Covenant signature valid${C.reset}`);
    console.log(`\n  ${C.bold}${C.green}RESULT: HIPAA compliance verified ✅${C.reset}`);
  } else {
    console.log(`  ${C.red}✗ Verification failed: ${result.reason}${C.reset}`);
  }

  console.log('');
}

main().catch(console.error);
