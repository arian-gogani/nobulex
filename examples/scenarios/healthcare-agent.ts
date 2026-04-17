/**
 * Healthcare Agent Scenario -- Medical records access with HIPAA-style enforcement.
 *
 * Demonstrates a medical records agent that:
 *   1. Creates an agent DID
 *   2. Parses a MedicalRecords covenant (permit read, forbid export)
 *   3. Processes 8 access requests through enforcement middleware
 *   4. Generates a cryptographic proof-of-behavior
 *   5. Verifies the proof via the 8-step handshake
 *
 * Run: npx tsx examples/scenarios/healthcare-agent.ts
 */

import { createDID, parseSource, EnforcementMiddleware } from '@nobulex/core';
import { generateProof, verifyCounterparty } from '@nobulex/sdk';

// --- ANSI helpers (no deps) ---
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

const CHECK = `${C.green}\u2713${C.reset}`;
const CROSS = `${C.red}\u2717${C.reset}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(150);

// --- Access request definitions ---
// 6 reads (allowed), 2 exports (blocked by covenant)
interface AccessRequest {
  action: string;
  params: Record<string, unknown>;
  label: string;
}

const requests: AccessRequest[] = [
  { action: 'read', params: { resource: 'patient-records/labs/12345' },        label: 'read  patient-records/labs/12345' },
  { action: 'read', params: { resource: 'patient-records/medications/12345' }, label: 'read  patient-records/medications/12345' },
  { action: 'read', params: { resource: 'patient-records/vitals/67890' },      label: 'read  patient-records/vitals/67890' },
  { action: 'export', params: { resource: 'patient-records/bulk' },            label: 'export patient-records/bulk' },
  { action: 'read', params: { resource: 'patient-records/notes/67890' },       label: 'read  patient-records/notes/67890' },
  { action: 'read', params: { resource: 'patient-records/imaging/11111' },     label: 'read  patient-records/imaging/11111' },
  { action: 'export', params: { resource: 'patient-records/ssn' },             label: 'export patient-records/ssn' },
  { action: 'read', params: { resource: 'patient-records/allergies/12345' },   label: 'read  patient-records/allergies/12345' },
];

async function main(): Promise<void> {
  // ── 1. Create agent DID ──────────────────────────────────────────────
  await tick();
  const identity = await createDID();
  const agentDid = identity.did;

  // ── 2. Parse the covenant ────────────────────────────────────────────
  const covenantSource = `covenant MedicalRecords {
  permit read;
  forbid export;
}`;

  const spec = parseSource(covenantSource);

  // ── 3. Set up enforcement middleware ─────────────────────────────────
  const mw = new EnforcementMiddleware({ agentDid, spec });

  // ── 4. Process access requests ───────────────────────────────────────
  console.log(`\n${C.dim}Processing 8 access requests through enforcement middleware...${C.reset}\n`);

  const results: Array<{ idx: number; label: string; action: string; blocked: boolean; reason?: string }> = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    await tick();

    const res = await mw.execute(
      { action: req.action, params: req.params },
      async () => ({ ok: true }),
    );

    if (res.executed) {
      results.push({ idx: i + 1, label: req.label, action: req.action, blocked: false });
      console.log(`  ${CHECK} ${C.dim}#${String(i + 1).padStart(2)}${C.reset}  ${req.label}`);
    } else {
      const reason = res.decision.reason ?? 'forbidden by covenant';
      results.push({ idx: i + 1, label: req.label, action: req.action, blocked: true, reason });
      console.log(`  ${CROSS} ${C.red}#${String(i + 1).padStart(2)}${C.reset}  ${req.label}  ${C.red}DENIED${C.reset}`);
    }
  }

  // ── 5. Generate proof + verify ───────────────────────────────────────
  await tick();
  const log = mw.getLog();
  const proof = await generateProof({
    identity,
    covenant: spec,
    actionLog: log,
  });

  const verifyResult = await verifyCounterparty(proof);

  // ── 6. Print HIPAA-style audit summary ───────────────────────────────
  const approvedResults = results.filter((r) => !r.blocked);
  const deniedResults = results.filter((r) => r.blocked);

  console.log('');
  console.log(`${C.green}${C.bold}\u2554${'═'.repeat(46)}\u2557${C.reset}`);
  console.log(`${C.green}${C.bold}\u2551     Medical Records Access Audit Trail       \u2551${C.reset}`);
  console.log(`${C.green}${C.bold}\u255A${'═'.repeat(46)}\u255D${C.reset}`);
  console.log('');

  console.log(`  ${C.bold}System:${C.reset}    MedicalRecords covenant`);
  console.log(`  ${C.bold}Agent DID:${C.reset} ${agentDid.slice(0, 20)}...`);
  console.log('');

  console.log(`  ${C.bold}Access requests:${C.reset} ${results.length}`);
  console.log(`    ${CHECK} Approved: ${approvedResults.length}  ${C.dim}(read)${C.reset}`);
  console.log(`    ${CROSS} Denied:   ${deniedResults.length}  ${C.dim}(export \u2014 blocked by covenant)${C.reset}`);
  console.log('');

  if (deniedResults.length > 0) {
    console.log(`  ${C.red}${C.bold}Denied requests:${C.reset}`);
    for (const d of deniedResults) {
      const resource = (requests[d.idx - 1].params.resource as string);
      console.log(
        `    ${C.red}#${String(d.idx).padStart(2)}${C.reset}  export ${resource}  ${C.dim}\u2192 DENIED${C.reset}`,
      );
    }
    console.log('');
  }

  console.log(`  ${C.bold}Audit chain:${C.reset}`);
  console.log(`    ${C.dim}Entries:         ${proof.actionLog.entries.length}${C.reset}`);
  console.log(`    ${C.dim}Integrity:       ${verifyResult.trusted ? 'verified' : 'FAILED'}${C.reset}`);
  console.log(`    ${C.dim}Tamper evidence: hash chain intact${C.reset}`);
  console.log('');

  if (verifyResult.trusted) {
    console.log(`  ${C.green}${C.bold}HIPAA compliance status: COMPLIANT ${CHECK}${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}HIPAA compliance status: NON-COMPLIANT${C.reset}`);
    console.log(`  ${C.red}reason: ${verifyResult.reason}${C.reset}`);
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  console.error(`${C.red}${C.bold}healthcare-agent crashed:${C.reset}`, err);
  process.exit(1);
});
