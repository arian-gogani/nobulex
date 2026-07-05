/**
 * Trust-anchor regression: proves verifyCovenant authenticates the AUTHORIZED
 * signer, not the key embedded in the document. Reproduces the self-signed
 * receipt break (attacker mints own keypair, signs a covenant for an agent)
 * and asserts the hardened verifier rejects it.
 */
import { generateKeyPair } from '@nobulex/crypto';
import { buildCovenant, verifyCovenant } from '../packages/core/src/index.ts';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log('PASS', label);
  } else {
    fail++;
    console.log('FAIL', label);
  }
}

const issuer = await generateKeyPair();
const ben = await generateKeyPair();

const doc = await buildCovenant({
  issuer: { id: 'alice', publicKey: issuer.publicKeyHex, role: 'issuer' },
  beneficiary: { id: 'bob', publicKey: ben.publicKeyHex, role: 'beneficiary' },
  constraints: "permit read on '/data/**'",
  privateKey: issuer.privateKey,
});

// A) no trust anchor -> fail closed
const a = await verifyCovenant(doc);
check('no anchor: valid === false (fail closed)', a.valid === false);
check(
  'no anchor: authorized_signer failed',
  a.checks.find((c) => c.name === 'authorized_signer')?.passed === false,
);

// B) correct authorized key -> valid
const b = await verifyCovenant(doc, { authorizedKeys: issuer.publicKeyHex });
check('authorized key: valid === true', b.valid === true);

// C) attacker self-signs a receipt for the same agent id -> rejected
const attacker = await generateKeyPair();
const forged = await buildCovenant({
  issuer: { id: 'alice', publicKey: attacker.publicKeyHex, role: 'issuer' },
  beneficiary: { id: 'bob', publicKey: ben.publicKeyHex, role: 'beneficiary' },
  constraints: "permit read on '/data/**'",
  privateKey: attacker.privateKey,
});
const c = await verifyCovenant(forged, { authorizedKeys: issuer.publicKeyHex });
check('attacker self-signed receipt: valid === false', c.valid === false);
check(
  'attacker key rejected as authorized signer',
  c.checks.find((x) => x.name === 'authorized_signer')?.passed === false,
);
check(
  'attacker signature invalid under authorized key',
  c.checks.find((x) => x.name === 'signature_valid')?.passed === false,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
