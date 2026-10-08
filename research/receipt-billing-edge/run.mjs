import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBill, sha256 } from './check.mjs';

const UPSTREAM_COMMIT = '5ab70b3c0ada4806e156fe1c6f8394df58333d1f';
const SAMPLE_SHA256 = '894c9443f6a7a8c3dc7011fa3f52daf5d29e9dab14fa7c52c51a5c5c9847c3c1';
const GATE_KEY = '0f37d844c1934a03851a48d7927e5109be76d8cbed6eac1dc8684ed89d977790';
const FILL_KEY = '8969e958b59558aea3dfec2f631b1e900eb0d69fa5e368543375a3220a5850cb';
const DIR = dirname(fileURLToPath(import.meta.url));

function main() {
  const root = process.argv[2];
  if (!root) throw new Error('usage: node run.mjs /path/to/pinned/VeritasActa/verify');
  const upstream = resolve(root);
  const actualCommit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualCommit, UPSTREAM_COMMIT, 'verifier source commit changed');
  const bundleBytes = readFileSync(join(upstream, 'samples', 'sample-gate-bundle.json'));
  assert.equal(sha256(bundleBytes), SAMPLE_SHA256, 'upstream sample bytes changed');
  const verifierCli = join(upstream, 'cli.js');
  const bill = JSON.parse(readFileSync(join(DIR, 'bill.sample.json'), 'utf8'));
  const base = { bill, bundleBytes, verifierCli, gateKey: GATE_KEY, fillKey: FILL_KEY };

  const cases = [
    ['matching_demo_bill', base, 'PASS', 'supplied_items_have_matching_verified_fill_receipts'],
    ['missing_fill', { ...base, bill: { items: [...bill.items, { line_id: 'BILL-3', batch_id: 'B-SAMPLE-001', fill_id: 'FILL-003', qty_filled: 1 }] } }, 'FAIL', 'billed_items_do_not_match_receipts'],
    ['wrong_quantity', { ...base, bill: { items: [{ ...bill.items[0], qty_filled: 41 }, bill.items[1]] } }, 'FAIL', 'billed_items_do_not_match_receipts'],
    ['duplicate_bill_line', { ...base, bill: { items: [...bill.items, { ...bill.items[0] }] } }, 'INDETERMINATE', 'invalid_or_duplicate_bill_items'],
    ['wrong_gate_key', { ...base, gateKey: '0'.repeat(64) }, 'FAIL', 'bundle_verification_failed'],
    ['wrong_fill_key', { ...base, fillKey: '0'.repeat(64) }, 'FAIL', 'untrusted_or_duplicate_fill_record'],
    ['tampered_bundle', { ...base, bundleBytes: Buffer.from(bundleBytes.toString('utf8').replace('FILL-001', 'FILL-999')) }, 'FAIL', 'bundle_verification_failed'],
    ['no_separate_fill_key', { ...base, fillKey: undefined }, 'INDETERMINATE', 'separate_gate_and_fill_keys_required'],
    ['verifier_unavailable', { ...base, verifierCli: '/nonexistent/nobulex-verifier.js' }, 'INDETERMINATE', 'verifier_could_not_analyse'],
  ];
  const outcomes = [];
  for (const [name, input, expectedStatus, expectedReason] of cases) {
    const output = checkBill(input);
    assert.equal(output.receipt_coverage, expectedStatus, `${name}: status`);
    assert.equal(output.reason, expectedReason, `${name}: reason`);
    assert.equal(output.payment_ready, false, `${name}: payment readiness`);
    outcomes.push({ name, receipt_coverage: output.receipt_coverage, reason: output.reason });
  }
  console.log(JSON.stringify({
    upstream_commit: UPSTREAM_COMMIT,
    upstream_sample_sha256: SAMPLE_SHA256,
    cases: outcomes,
    claim_ceiling: 'Matching sample fill references and quantities under two supplied demo keys; no real bill, independent custodian, amount, or payment approval.',
  }, null, 2));
}

try { main(); }
catch (error) { console.error(`REFUSED: ${error.message}`); process.exitCode = 1; }
