import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import fs from 'fs';

const fixture = JSON.parse(fs.readFileSync('./aps-fixture-v1.json', 'utf8'));

console.log('=== APS Bilateral-Delegation Fixture v1 ===');
console.log('Spec:', fixture.spec);
console.log('Canonicalization:', fixture.canonicalization);
console.log('Vector count:', fixture.vectors.length);
console.log('Seed sha256:', fixture.seed_sha256_hex);
console.log('Pubkey:', fixture.keypair?.public_key_hex || fixture.keypair?.publicKey);
console.log('');

let pass = 0, fail = 0;
const results = [];

for (const v of fixture.vectors) {
  const input = v.input ?? v.payload ?? v.envelope ?? v.object;
  const expected = v.canonical_sha256 ?? v.expected_sha256 ?? v.sha256;
  if (input === undefined) {
    console.log(`SKIP ${v.name || v.id}: keys=${Object.keys(v).join(',')}`);
    continue;
  }
  
  const canonical = canonicalizeJson(input);
  const actualHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const match = actualHash === expected;
  
  if (match) pass++; else fail++;
  results.push({ name: v.name || v.id, match });
  
  const status = match ? 'MATCH   ' : 'MISMATCH';
  console.log(`${status} | ${v.name || v.id || 'unnamed'}`);
  if (!match) {
    console.log(`  expected: ${expected}`);
    console.log(`  actual:   ${actualHash}`);
  }
}

console.log('');
console.log(`=== Result: ${pass}/${fixture.vectors.length} byte-match ===`);
