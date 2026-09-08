// Unicode normalization of the action_ref preimage.
//
// RFC 8785 canonicalizes serialization, not Unicode. Without an explicit
// normalization step the same name written two legal ways produces two content
// addresses, both receipts verify, and the cross-system join silently does not
// happen.
//
// These must stay byte-identical to packages/python/test_action_ref_normalization.py.
// The two SDKs are only interoperable if they agree on the preimage.

const { computeActionRef } = require('./dist/index.js');

const TS = 1757000000000;
const NFC_NAME = 'did:web:café.example'.normalize('NFC');
const NFD_NAME = 'did:web:café.example'.normalize('NFD');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.log('  FAIL  ' + label);
    failed++;
  }
}

// Guard: every assertion below is void if these are byte-identical.
check('the two forms really do differ', NFC_NAME !== NFD_NAME);

check(
  'agent_id normalization',
  computeActionRef(NFC_NAME, 'transfer', 'acct:123', TS) ===
    computeActionRef(NFD_NAME, 'transfer', 'acct:123', TS)
);

const scopeNfc = 'résumé:read'.normalize('NFC');
const scopeNfd = 'résumé:read'.normalize('NFD');
check('scope forms differ', scopeNfc !== scopeNfd);
check(
  'scope normalization',
  computeActionRef('did:web:agent.example', 'transfer', scopeNfc, TS) ===
    computeActionRef('did:web:agent.example', 'transfer', scopeNfd, TS)
);

const atNfc = 'prüfen'.normalize('NFC');
const atNfd = 'prüfen'.normalize('NFD');
check(
  'action_type normalization',
  computeActionRef('did:web:agent.example', atNfc, 'acct:123', TS) ===
    computeActionRef('did:web:agent.example', atNfd, 'acct:123', TS)
);

// Must-not-fire guards.
check(
  'normalization does not collapse distinct agents',
  computeActionRef(NFC_NAME, 'transfer', 'acct:123', TS) !==
    computeActionRef('did:web:cafe.example', 'transfer', 'acct:123', TS)
);

check(
  'timestamp still participates',
  computeActionRef(NFC_NAME, 'transfer', 'acct:123', TS) !==
    computeActionRef(NFC_NAME, 'transfer', 'acct:123', TS + 1)
);

check(
  'fields are not interchangeable',
  computeActionRef('a', 'b', 'c', TS) !== computeActionRef('b', 'a', 'c', TS)
);

check(
  'ascii action_ref is 64 hex chars',
  /^[0-9a-f]{64}$/.test(computeActionRef('did:web:agent.example', 'transfer', 'acct:123', TS))
);

// Cross-language pin. This value is produced by the patched Python SDK for the
// same inputs. If either implementation drifts, this is the test that catches it.
check(
  'cross-language pin matches the Python SDK',
  computeActionRef('did:web:agent.example', 'transfer', 'acct:123', TS) ===
    '8f22ddd7fe2c5466740ab88774de8c6451146d357b350b866a252cc385a4cc93'
);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed);
