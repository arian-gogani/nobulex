// Standalone verifier for the guarded canonicalizeJson against the rfc8785
// golden fixture. Runs the REAL source via tsx, no vitest needed.
import { readFileSync } from 'node:fs';
import { canonicalizeJson } from '../packages/core/src/crypto/index.ts';
const golden = JSON.parse(
  readFileSync(new URL('../fixtures/jcs-rfc8785-vectors.json', import.meta.url), 'utf8'),
);

let pass = 0;
let fail = 0;

for (const [i, v] of golden.vectors.entries()) {
  const got = canonicalizeJson(v.input);
  if (got === v.canonical) {
    pass++;
  } else {
    fail++;
    console.log(`VECTOR ${i} MISMATCH`);
    console.log('  expected:', v.canonical);
    console.log('  got     :', got);
  }
}

function expectThrow(label, fn, re) {
  try {
    fn();
    fail++;
    console.log(`THROW-CASE FAIL (${label}): did not throw`);
  } catch (e) {
    if (re.test(String(e.message))) {
      pass++;
    } else {
      fail++;
      console.log(`THROW-CASE FAIL (${label}): wrong message: ${e.message}`);
    }
  }
}

expectThrow('big-int', () => canonicalizeJson({ big: 12345678901234567890 }), /safe integer domain/);
expectThrow('infinity', () => canonicalizeJson({ x: Infinity }), /non-finite/);
expectThrow('nan', () => canonicalizeJson({ x: NaN }), /non-finite/);

console.log(`\nRESULT: ${pass} passed, ${fail} failed (${golden.vectors.length} golden vectors + 3 throw-cases)`);
process.exit(fail === 0 ? 0 : 1);
