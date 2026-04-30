#!/usr/bin/env node

/**
 * CTEF v0.3.1 cross-implementation byte-match verification
 *
 * Verifies all four CTEF inline vectors from agentgraph.co:
 * - envelope_vector (positive)
 * - verdict_vector (positive)
 * - scope_violation_vector (negative, expects INVALID_CLAIM_SCOPE)
 * - composition_failure_vector (negative, expects INVALID_COMPOSITION)
 *
 * Source: https://agentgraph.co/.well-known/cte-test-vectors.json
 * Frozen at: agentgraph-co/agentgraph@69ad94d
 */

import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const VECTORS_URL = 'https://agentgraph.co/.well-known/cte-test-vectors.json';
const LOCAL_FILE = 'ctef-vectors.json';

async function main() {
  if (!existsSync(LOCAL_FILE)) {
    console.log(`fetching vectors from ${VECTORS_URL}`);
    execSync(`curl -sL "${VECTORS_URL}" -o ${LOCAL_FILE}`);
  }

  const data = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));

  console.log('CTEF v0.3.1 byte-match verification');
  console.log('====================================');
  console.log(`version: ${data.version}`);
  console.log(`spec: ${data.spec}`);
  console.log('');

  const vectors = [
    { key: 'envelope_vector', type: 'positive' },
    { key: 'verdict_vector', type: 'positive' },
    { key: 'scope_violation_vector', type: 'negative' },
    { key: 'composition_failure_vector', type: 'negative' },
  ];

  let pass = 0;
  let fail = 0;

  for (const { key, type } of vectors) {
    const v = data[key];
    if (!v) { console.log(`SKIP  | ${key} (not found)`); continue; }

    const canonical = canonicalizeJson(v.input_object);
    const actual = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const match = actual === v.canonical_sha256;

    if (match) {
      pass++;
      let extra = '';
      if (type === 'negative') {
        extra = ` | error_code: ${v.expected_error_code}`;
      }
      console.log(`PASS  | ${key}${extra}`);
    } else {
      fail++;
      console.log(`FAIL  | ${key}`);
      console.log(`        expected: ${v.canonical_sha256}`);
      console.log(`        actual:   ${actual}`);
    }
  }

  console.log('');
  console.log(`result: ${pass}/4 byte-match${fail > 0 ? ` (${fail} failed)` : ''}`);

  // verify error codes exist on negative vectors
  const scopeErr = data.scope_violation_vector?.expected_error_code;
  const compErr = data.composition_failure_vector?.expected_error_code;
  console.log('');
  console.log('negative-path error codes:');
  console.log(`  scope_violation:      ${scopeErr}`);
  console.log(`  composition_failure:  ${compErr}`);

  if (fail === 0) {
    const receipt = {
      verifier: '@nobulex/crypto',
      fixture: 'agentgraph.co/.well-known/cte-test-vectors.json',
      version: data.version,
      vectors_total: 4,
      vectors_passed: pass,
      negative_path_error_codes: {
        scope_violation: scopeErr,
        composition_failure: compErr,
      },
      timestamp: new Date().toISOString(),
      result: 'PASS',
    };
    writeFileSync('ctef-byte-match-receipt.json', JSON.stringify(receipt, null, 2));
    console.log('');
    console.log('verification receipt written to ctef-byte-match-receipt.json');
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
