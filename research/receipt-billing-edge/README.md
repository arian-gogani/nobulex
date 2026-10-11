# Receipt-to-billing boundary, first local run

This experiment consumes a real published **demo** evidence bundle from
`VeritasActa/verify` and a separate, synthetic bill fixture written here.
It asks whether each supplied billed fill ID and quantity has a matching signed
fill in the bundle. It is a cross-project input check, not a customer deployment
or a claim that any money moved.

The verifier runs first with an explicitly supplied gate key. The consumer also
requires a separately supplied fill signer key. Both keys here are public **demo
keys pinned from the sample**, not independently established production
identities. The upstream verifier checks signatures, schemas, parent-child
relationships and the signed manifest. Our consumer checks line uniqueness,
fill uniqueness, exact IDs and exact positive integer filled quantities against that verified
snapshot. The same snapshot bytes are passed to the verifier and the consumer.

To reproduce from a fresh checkout, use Node 18 or newer:

```sh
git clone https://github.com/VeritasActa/verify.git /tmp/nobulex-acta-verify
git -C /tmp/nobulex-acta-verify checkout 5ab70b3c0ada4806e156fe1c6f8394df58333d1f
cd /tmp/nobulex-acta-verify
NODE_ENV=development npm ci --include=dev --ignore-scripts
cd /path/to/nobulex
node research/receipt-billing-edge/run.mjs /tmp/nobulex-acta-verify
```

`run.mjs` refuses a different upstream commit or sample SHA-256 and exits nonzero
if any expected outcome changes. The case set includes a matching bill, a
missing fill, a wrong quantity, a duplicate billed line, an unexpected gate
key, an unexpected fill key, altered bundle bytes, an absent separately supplied
fill key, and an unavailable verifier.

Author-run result on Node v25.1.0 after `npm ci` on the pinned verifier commit:

| Case | Receipt coverage |
| --- | --- |
| Matching demo bill | PASS |
| Missing fill | FAIL |
| Wrong quantity | FAIL |
| Duplicate bill line | INDETERMINATE |
| Wrong gate key | FAIL |
| Wrong fill key | FAIL |
| Altered bundle bytes | FAIL |
| Missing fill key | INDETERMINATE |
| Verifier unavailable | INDETERMINATE |

The runner exited 0 only after all nine assertions matched. A deliberate
mutation that disabled the quantity comparison made the same runner exit 1 at
`wrong_quantity`, where the mutated code incorrectly returned PASS.

`receipt_coverage: PASS` means only that **the supplied bill fixture** matches
the supplied signed demo bundle under the specified demo keys. It cannot show
that the bill lists every real action, that the custodian is genuine, that the
price or amount is correct, or that payment should be released. Every case
returns `payment_ready: false` for that reason. A signed export manifest proves
coverage of the export's declared scope, not of events omitted before export.

The upstream sample and verifier remain in their Apache-2.0 repository; this
folder records its exact source commit and sample digest. The bill fixture and
consumer are Nobulex-authored and synthetic. This is an author-run pilot until
someone else reproduces it or reviews the input contract.
