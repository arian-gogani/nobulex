#!/usr/bin/env node

/**
 * Sign the YC application with a Nobulex bilateral receipt.
 *
 * The YC application itself becomes a demo of the product.
 *
 * Usage:
 *   1. Before submitting: node scripts/sign-yc-application.mjs pre "paste all answers"
 *   2. After submitting:  node scripts/sign-yc-application.mjs post "submitted"
 *   3. Anyone can verify: node scripts/sign-yc-application.mjs verify
 */

import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const RECEIPT_FILE = 'yc-application-receipt.json';

function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function main() {
  const mode = process.argv[2];
  const content = process.argv[3] || '';

  if (mode === 'pre') {
    const preExecution = {
      type: 'yc_application_pre_execution',
      applicant: 'arian-gogani',
      company: 'nobulex',
      batch: 'S26',
      timestamp: new Date().toISOString(),
      content_hash: sha256(content),
      commitment: 'these are the answers I intend to submit to Y Combinator',
    };

    const canonical = canonicalizeJson(preExecution);
    const preHash = sha256(canonical);

    const receipt = {
      bilateral_receipt: {
        pre_execution: { ...preExecution, canonical_sha256: preHash },
        post_execution: null,
        chain_status: 'awaiting_submission',
      },
      verify: 'clone this repo and run: node scripts/sign-yc-application.mjs verify',
      protocol: 'nobulex bilateral receipt v0.3',
      repo: 'https://github.com/arian-gogani/nobulex',
    };

    writeFileSync(RECEIPT_FILE, JSON.stringify(receipt, null, 2));
    console.log('pre-execution receipt written');
    console.log('content hash: ' + preExecution.content_hash);
    console.log('canonical sha256: ' + preHash);
    console.log('');
    console.log('now submit the application, then run:');
    console.log('  node scripts/sign-yc-application.mjs post "submitted"');

  } else if (mode === 'post') {
    if (!existsSync(RECEIPT_FILE)) {
      console.error('run with "pre" first.');
      process.exit(1);
    }
    const existing = JSON.parse(readFileSync(RECEIPT_FILE, 'utf8'));
    const preHash = existing.bilateral_receipt.pre_execution.canonical_sha256;

    const postExecution = {
      type: 'yc_application_post_execution',
      applicant: 'arian-gogani',
      company: 'nobulex',
      batch: 'S26',
      timestamp: new Date().toISOString(),
      pre_execution_hash: preHash,
      submission_status: content || 'submitted',
    };

    const canonical = canonicalizeJson(postExecution);
    const postHash = sha256(canonical);
    const receiptHash = sha256(preHash + postHash);

    existing.bilateral_receipt.post_execution = {
      ...postExecution,
      canonical_sha256: postHash,
    };
    existing.bilateral_receipt.receipt_hash = receiptHash;
    existing.bilateral_receipt.chain_status = 'complete';

    writeFileSync(RECEIPT_FILE, JSON.stringify(existing, null, 2));
    console.log('bilateral receipt complete');
    console.log('receipt hash: ' + receiptHash);
    console.log('');
    console.log('commit and push:');
    console.log('  git add yc-application-receipt.json');
    console.log('  git commit --no-verify -m "yc: bilateral receipt of S26 application"');
    console.log('  git push origin main');

  } else if (mode === 'verify') {
    if (!existsSync(RECEIPT_FILE)) {
      console.error('no receipt found.');
      process.exit(1);
    }
    const r = JSON.parse(readFileSync(RECEIPT_FILE, 'utf8')).bilateral_receipt;

    console.log('YC S26 application bilateral receipt verification');
    console.log('=================================================');
    console.log('applicant: ' + r.pre_execution.applicant);
    console.log('company:   ' + r.pre_execution.company);
    console.log('batch:     ' + r.pre_execution.batch);
    console.log('status:    ' + r.chain_status);
    console.log('');

    const preObj = { ...r.pre_execution };
    delete preObj.canonical_sha256;
    const preValid = sha256(canonicalizeJson(preObj)) === r.pre_execution.canonical_sha256;
    console.log('pre-execution hash:  ' + (preValid ? 'VALID' : 'INVALID'));

    if (r.post_execution) {
      const postObj = { ...r.post_execution };
      delete postObj.canonical_sha256;
      const postValid = sha256(canonicalizeJson(postObj)) === r.post_execution.canonical_sha256;
      const chainValid = sha256(
        r.pre_execution.canonical_sha256 + r.post_execution.canonical_sha256
      ) === r.receipt_hash;
      const linkValid = r.post_execution.pre_execution_hash === r.pre_execution.canonical_sha256;

      console.log('post-execution hash: ' + (postValid ? 'VALID' : 'INVALID'));
      console.log('receipt chain:       ' + (chainValid ? 'VALID' : 'INVALID'));
      console.log('pre->post linkage:   ' + (linkValid ? 'VALID' : 'INVALID'));

      if (preValid && postValid && chainValid && linkValid) {
        console.log('');
        console.log('VERIFIED: application receipt is intact and untampered');
      }
    } else {
      console.log('post-execution: pending (not yet submitted)');
    }
  } else {
    console.log('sign your YC application with a nobulex bilateral receipt');
    console.log('');
    console.log('usage:');
    console.log('  node scripts/sign-yc-application.mjs pre "your answers"');
    console.log('  node scripts/sign-yc-application.mjs post "submitted"');
    console.log('  node scripts/sign-yc-application.mjs verify');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
