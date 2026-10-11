// The separateness that the reason string promised and the code did not check.
//
// Offline. No upstream checkout, no verifier, no network. The key gate runs
// before any process is spawned, which is exactly why it can be tested here
// and why it is worth testing: it is the first thing between a caller and a
// PASS.
//
// The defect: both call sites tested only that each key was 64 hex characters
// while returning the reason 'separate_gate_and_fill_keys_required'. Passing
// one key for both the gate and the fill signer therefore reached the
// comparison, which then confirmed every fill was signed by the same party
// that operated the gate and reported PASS. The premise of the whole
// comparison is that those are different parties. Self-attested evidence
// compared against itself establishes nothing, and the output said
// receipt_coverage: PASS.
//
// Run: node research/receipt-billing-edge/keys.test.mjs
import assert from 'node:assert/strict';
import { checkBill } from './check.mjs';

const A = '0f37d844c1934a03851a48d7927e5109be76d8cbed6eac1dc8684ed89d977790';
const B = '8969e958b59558aea3dfec2f631b1e900eb0d69fa5e368543375a3220a5850cb';
const BYTES = Buffer.from(JSON.stringify({ schema: 'x', entries: [] }), 'utf8');

let ran = 0;
function check(name, fn) {
  fn();
  ran += 1;
  console.log('  ok   ' + name);
}

check('one key used for both roles is refused', () => {
  const out = checkBill({
    bill: { items: [] }, bundleBytes: BYTES, verifierCli: '/nonexistent',
    gateKey: A, fillKey: A,
  });
  assert.equal(out.receipt_coverage, 'INDETERMINATE');
  assert.equal(out.reason, 'gate_and_fill_keys_must_differ');
  assert.equal(out.payment_ready, false);
});

check('case does not launder the collision', () => {
  // The comparisons elsewhere in this file are case-insensitive, so the
  // distinctness test has to be too, or the same key in two spellings passes.
  const out = checkBill({
    bill: { items: [] }, bundleBytes: BYTES, verifierCli: '/nonexistent',
    gateKey: A, fillKey: A.toUpperCase(),
  });
  assert.equal(out.reason, 'gate_and_fill_keys_must_differ');
});

check('a malformed key still reports the format reason, not the new one', () => {
  for (const [g, f] of [['', B], [A, 'nothex'], [A, undefined], [null, B]]) {
    const out = checkBill({
      bill: { items: [] }, bundleBytes: BYTES, verifierCli: '/nonexistent',
      gateKey: g, fillKey: f,
    });
    assert.equal(out.reason, 'separate_gate_and_fill_keys_required');
  }
});

check('two different keys are NOT refused by the key gate', () => {
  // The control. Without it the guard above could be one that refuses every
  // call, which would pass the first three cases and break the real runner.
  const out = checkBill({
    bill: { items: [] }, bundleBytes: BYTES, verifierCli: '/nonexistent',
    gateKey: A, fillKey: B,
  });
  assert.notEqual(out.reason, 'gate_and_fill_keys_must_differ');
  assert.notEqual(out.reason, 'separate_gate_and_fill_keys_required');
});

check('nothing on any path reports payment_ready', () => {
  for (const [g, f] of [[A, A], [A, B], ['', ''], [A, 'nothex']]) {
    const out = checkBill({
      bill: { items: [] }, bundleBytes: BYTES, verifierCli: '/nonexistent',
      gateKey: g, fillKey: f,
    });
    assert.equal(out.payment_ready, false);
  }
});

console.log('\n  ' + ran + ' cases passed.');
