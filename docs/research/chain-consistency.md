# Hash-chain consistency is not event completeness

Status: executable explanatory note. Eight fictional cases verified on Python 3.14.7. This note evaluates a small local model, not a third-party product.

## Question

If all supplied records have valid hash links, can a reviewer conclude that no event was deleted or omitted?

This example produces internally consistent truncated and replacement sequences. Comparing their final hashes with a separately retained original checkpoint distinguishes those particular sequences. An event omitted before the chain was created remains invisible to both checks.

## Run

From this repository's root, with Python 3:

```sh
python3 examples/receipt_chain_limits.py
```

No package installation, network call, key, account, or trading integration is involved.

## Observed results

| Scenario | Internal links consistent | Matches retained head |
|---|---|---|
| Original sequence | Yes | Yes |
| Content edited without updating hashes | No | No |
| Interior entry removed without relinking | No | No |
| Tail removed | Yes | No |
| Replacement history recomputed | Yes | No |
| Empty input | Refused | No |
| Original with no checkpoint available | Yes | Not evaluated |
| Event omitted before recording; checkpoint covers only recorded events | Yes | Yes |

Measured result: 8/8 expected outcomes, exit 0. Four deliberate changes each caused exit 1: accepting an empty chain, ignoring checkpoint equality, accepting a missing checkpoint, and ignoring payload-hash mismatch. The original example then passed again. These tests exercise the stated cases; they are not a completeness proof for the verifier.

## Assumptions and limits

- The original checkpoint is supplied separately and is assumed to have been retained faithfully. The example does not establish its provenance or implement independent storage.
- Checkpoint comparison here means equality at one fixed boundary. A legitimate later extension also has a different final hash. A production append-only protocol needs a way to verify extension relative to the earlier checkpoint.
- The operator can recompute this unsigned chain. This is not a signature test. A signed system's rewrite resistance additionally depends on signing-key custody, retained signatures, and checkpoints.
- An external checkpoint commits to supplied records, not to events that were never recorded. Completeness needs some separate basis for knowing which events should exist.
- The JSON encoding is explicitly fixed for this small example. It is not an implementation or conformance test of RFC 8785.
- Malformed-input handling, timestamp trust, key identity, durable storage, concurrency, and broker execution are outside this model.

## Origin and correction record

This expands the local counterexample described in [our ATLAS discussion comment](https://github.com/mitre-atlas/atlas-data/issues/20#issuecomment-5838279584). Another participant [revised their proposed paragraph](https://github.com/mitre-atlas/atlas-data/issues/20#issuecomment-5840517067) to distinguish hash links from checkpoint comparison and event completeness. That is documented feedback on wording, not ATLAS acceptance of this note or Nobulex.

The correction is explicit: a bare claim that a hash chain detects all gaps is too broad. This note does not introduce a novel cryptographic construction.

## Reviewer request

Run the example and identify a result or assumption that is wrong. A useful extension would model a legitimate append after a retained checkpoint and separate it from replacement. Keep that separate from evidence of events omitted before recording.
