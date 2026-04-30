#!/usr/bin/env node

/**
 * APS bilateral-delegation byte-match verification
 *
 * Reproduces the 10/10 byte-match against aeoess/agent-passport-system
 * fixtures. Anyone can clone this repo, run `node scripts/verify-aps-byte-match.mjs`,
 * and independently confirm the results.
 *
 * Fixture source: aeoess/agent-passport-system/fixtures/bilateral-delegation/canonicalize-fixture-v1.json
 * Expected migration-attestation-shape SHA-256: 446b5431790e8afb201b2e19790268ae3d4c39b94a10923ef3e43cc92958bbfd
 * Seed SHA-256: 4f3d8defea1e82c1705c35d97ee4db046c6313ba83855a7d0de04a44f04c834a
 */

import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const FIXTURE_URL = 'https://raw.githubusercontent.com/aeoess/agent-passport-system/main/fixtures/bilateral-delegation/canonicalize-fixture-v1.json';
const LOCAL_FIXTURE = 'aps-fixture-v1.json';

async function main() {
  // fetch fixture if not cached locally
  if (!existsSync(LOCAL_FIXTURE)) {
    console.log(`fetching fixture from ${FIXTURE_URL}`);
    try {
      execSync(`curl -sL "${FIXTURE_URL}" -o ${LOCAL_FIXTURE}`);
    } catch {
      console.error('failed to fetch fixture. check network or download manually.');
      process.exit(1);
    }
  }

  const fixture = JSON.parse(readFileSync(LOCAL_FIXTURE, 'utf8'));

  console.log('APS bilateral-delegation byte-match verification');
  console.log('================================================');
  console.log(`spec: ${fixture.spec}`);
  console.log(`canonicalization: ${fixture.canonicalization}`);
  console.log(`vectors: ${fixture.vectors.length}`);
  console.log(`seed sha256: ${fixture.seed_sha256_hex}`);
  console.log('');

  let pass = 0;
  let fail = 0;

  for (const v of fixture.vectors) {
    const input = v.input ?? v.payload ?? v.envelope ?? v.object;
    const expected = v.canonical_sha256 ?? v.expected_sha256 ?? v.sha256;

    if (!input || !expected) {
      console.log(`SKIP  | ${v.name || v.id} (missing input or expected hash)`);
      continue;
    }

    const canonical = canonicalizeJson(input);
    const actual = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const match = actual === expected;

    if (match) {
      pass++;
      console.log(`PASS  | ${v.name || v.id}`);
    } else {
      fail++;
      console.log(`FAIL  | ${v.name || v.id}`);
      console.log(`        expected: ${expected}`);
      console.log(`        actual:   ${actual}`);
    }
  }

  console.log('');
  console.log(`result: ${pass}/${fixture.vectors.length} byte-match${fail > 0 ? ` (${fail} failed)` : ''}`);
  console.log('');

  if (fail === 0) {
    // write verification receipt so others can confirm the run happened
    const receipt = {
      verifier: '@nobulex/crypto',
      fixture: 'aeoess/agent-passport-system/fixtures/bilateral-delegation/canonicalize-fixture-v1.json',
      vectors_total: fixture.vectors.length,
      vectors_passed: pass,
      seed_sha256: fixture.seed_sha256_hex,
      timestamp: new Date().toISOString(),
      result: 'PASS',
    };
    writeFileSync('aps-byte-match-receipt.json', JSON.stringify(receipt, null, 2));
    console.log('verification receipt written to aps-byte-match-receipt.json');
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
