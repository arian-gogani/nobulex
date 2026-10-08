import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HEX_KEY = /^[0-9a-f]{64}$/i;

function result(status, reason, details = {}) {
  return {
    receipt_coverage: status,
    reason,
    payment_ready: false,
    ...details,
  };
}

function validBill(bill) {
  if (!bill || !Array.isArray(bill.items) || bill.items.length === 0) return false;
  const lines = new Set();
  const references = new Set();
  for (const item of bill.items) {
    if (!item || typeof item.line_id !== 'string' || !item.line_id ||
        typeof item.batch_id !== 'string' || !item.batch_id ||
        typeof item.fill_id !== 'string' || !item.fill_id ||
        !Number.isSafeInteger(item.qty_filled) || item.qty_filled <= 0) return false;
    const ref = JSON.stringify([item.batch_id, item.fill_id]);
    if (lines.has(item.line_id) || references.has(ref)) return false;
    lines.add(item.line_id);
    references.add(ref);
  }
  return true;
}

function compareVerifiedBundle(bill, bundle, verification, { gateKey, fillKey }) {
  if (!validBill(bill)) return result('INDETERMINATE', 'invalid_or_duplicate_bill_items');
  if (!HEX_KEY.test(gateKey ?? '') || !HEX_KEY.test(fillKey ?? '')) {
    return result('INDETERMINATE', 'separate_gate_and_fill_keys_required');
  }
  if (!verification || verification.valid !== true ||
      verification.format !== 'gate-evidence-bundle' ||
      verification.manifestValid !== true ||
      verification.gateVerificationKey?.toLowerCase() !== gateKey.toLowerCase()) {
    return result('FAIL', 'bundle_verification_failed');
  }
  if (bundle?.schema !== 'scopeblind.gate.evidence-bundle/2' || !Array.isArray(bundle.entries)) {
    return result('INDETERMINATE', 'unreadable_bundle');
  }

  const records = verification.records;
  if (!Array.isArray(records)) return result('INDETERMINATE', 'missing_verification_records');
  const verifiedFills = records.filter((record) => record.role === 'fill');
  const fills = bundle.entries.flatMap((entry) => Array.isArray(entry?.fills) ? entry.fills : []);
  if (verifiedFills.length !== fills.length) return result('FAIL', 'fill_inventory_mismatch');

  const byDigest = new Map();
  for (const record of verifiedFills) {
    if (!record.digest || byDigest.has(record.digest) || record.cryptoValid !== true ||
        record.schemaRecognized !== true || record.signer?.toLowerCase() !== fillKey.toLowerCase()) {
      return result('FAIL', 'untrusted_or_duplicate_fill_record');
    }
    byDigest.set(record.digest, record);
  }

  const byReference = new Map();
  for (const fill of fills) {
    if (!fill || !byDigest.has(fill.digest) ||
        fill.verification_key?.toLowerCase() !== fillKey.toLowerCase() ||
        fill.payload?.schema !== 'scopeblind.gate.fill/2' ||
        typeof fill.payload.batch_id !== 'string' ||
        typeof fill.payload.fill_id !== 'string' ||
        !Number.isSafeInteger(fill.payload.qty_filled)) {
      return result('FAIL', 'untrusted_or_unreadable_fill');
    }
    const ref = JSON.stringify([fill.payload.batch_id, fill.payload.fill_id]);
    if (byReference.has(ref)) return result('FAIL', 'duplicate_fill_reference');
    byReference.set(ref, fill.payload);
  }

  const mismatches = [];
  for (const item of bill.items) {
    const observed = byReference.get(JSON.stringify([item.batch_id, item.fill_id]));
    if (!observed) mismatches.push({ line_id: item.line_id, reason: 'missing_receipt' });
    else if (observed.qty_filled !== item.qty_filled) {
      mismatches.push({ line_id: item.line_id, reason: 'quantity_mismatch' });
    }
  }
  if (mismatches.length) return result('FAIL', 'billed_items_do_not_match_receipts', { mismatches });
  return result('PASS', 'supplied_items_have_matching_verified_fill_receipts', {
    matched_items: bill.items.length,
    unbilled_fills: byReference.size - bill.items.length,
  });
}

export function checkBill({ bill, bundleBytes, verifierCli, gateKey, fillKey }) {
  if (!Buffer.isBuffer(bundleBytes)) return result('INDETERMINATE', 'bundle_bytes_required');
  if (!HEX_KEY.test(gateKey ?? '') || !HEX_KEY.test(fillKey ?? '')) {
    return result('INDETERMINATE', 'separate_gate_and_fill_keys_required');
  }
  let bundle;
  try { bundle = JSON.parse(bundleBytes.toString('utf8')); }
  catch { return result('INDETERMINATE', 'unreadable_bundle'); }
  if (typeof verifierCli !== 'string' || !verifierCli) {
    return result('INDETERMINATE', 'verifier_cli_required');
  }

  // Verify a private snapshot, then compare that same byte string. The source file cannot
  // change between the verifier's read and this consumer's read.
  const dir = mkdtempSync(join(tmpdir(), 'nobulex-billing-edge-'));
  try {
    const file = join(dir, 'bundle.json');
    writeFileSync(file, bundleBytes);
    const run = spawnSync(process.execPath, [verifierCli, file, '--key', gateKey, '--json'], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    if (run.error || run.status === null || run.status === 2 || !run.stdout?.trim()) {
      return result('INDETERMINATE', 'verifier_could_not_analyse', { verifier_exit: run.status });
    }
    let verification;
    try { verification = JSON.parse(run.stdout); }
    catch { return result('INDETERMINATE', 'verifier_response_unreadable'); }
    if (run.status !== 0 || verification.valid !== true) {
      return result('FAIL', 'bundle_verification_failed', { verifier_exit: run.status, verifier_error: verification.error ?? null });
    }
    return compareVerifiedBundle(bill, bundle, verification, { gateKey, fillKey });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
