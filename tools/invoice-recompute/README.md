# invoice-recompute

Single-invoice recomputation harness: re-rate every line of a usage-based
invoice from the buyer's own usage evidence against a dated, source-cited
price sheet, and issue one verdict per line. Python 3.11+, stdlib only.

This is the front half of the buyer-side cheap test
(CHEAP-TEST-buyer-side-20261013.md). The verdict discipline, dominance
rollup, planted-defect control pattern, and canonical-digest habit come from
the existing nobulex-registry suite; this tool adds the parts that repo
never had: an invoice parser, a price-sheet encoding, usage normalizers,
and a rating engine.

## What a MATCH does not establish (read before anything else)

**A MATCH is consistency of the examined line with the evidence the buyer
provided and the price sheet pinned for the run. It is not certification of
the invoice.** Specifically, none of the following are established by any
output of this tool:

- Vendor-side metering correctness. Buyer logs carry the usage figures the
  vendor's API returned; this tool checks that those figures, summed and
  rated, match the invoice. It cannot check that the vendor counted tokens
  correctly in the first place.
- Usage the buyer did not log. A billed quantity above the logged quantity
  is a discrepancy against the buyer's evidence, never proven overbilling:
  retries, system tokens, and unlogged keys can all be legitimate.
- Private or negotiated rate cards. The sheet encodes published,
  standard-tier rates. Discounted lines will MISMATCH against it honestly
  and meaninglessly; provide the contract rate card instead.
- Dollar recovery. No output of this tool ever says "overbilled" or
  "recovered". Deltas are signed numbers, stated in both directions, with
  their evidence basis.

Every generated report prints its limits section before anything else.

## Verdicts

- `MATCH` billed amount agrees with the recomputed amount within tolerance
  (default 0.5 percent relative plus one cent absolute, per line).
- `MISMATCH` a stated numeric disagreement; delta signed, reported in both
  directions (billed minus recomputed and recomputed minus billed).
- `INDETERMINATE` examined, but the evidence does not support a claim:
  evidence tier too low for the line, no usage events for the model,
  unreadable usage rows, a rate the sheet does not print, or a line that
  does not say which token type it bills. Unknown never passes.
- `NOT_EVALUATED` never rated: unparseable line (raw text preserved),
  model absent from the sheet, or price marked UNENCODABLE.

Rollup: worst outcome dominates, in the order MISMATCH, INDETERMINATE,
NOT_EVALUATED, MATCH. One MISMATCH is not averaged away by two hundred
MATCH lines, and no MATCH outranks a line that issued no claim. This
mirrors `aggregate()` in nobulex-registry `suite/harness.py` (its six
verdicts folded to these four); it is reimplemented minimally in
`recompute.py` rather than imported, so this tool does not depend on a
sibling checkout. The report says so too.

## Evidence tiers

- Tier 1: the buyer's own JSONL request logs (`--usage-format jsonl`).
  Buys independent recomputation of quantities and amounts.
- Tier 2: the vendor's own usage export CSV (`--usage-format csv`). Buys a
  vendor self-consistency check only; it is NOT independent of the
  vendor's metering and the report says so.
- Tier 3: invoice only (omit `--usage`). Buys arithmetic-internal and
  published-price checks; every quantity verdict is INDETERMINATE.

Accepted columns and aliases are documented in the `usage.py` and
`invoice.py` module docstrings.

## Run

Recompute an invoice (CSV or JSON) against the OpenAI sheet with tier 1
logs:

```
python3 recompute.py invoice.csv --pricesheet pricesheets/openai-2026-10.json --usage requests.jsonl --usage-format jsonl
```

Tier 2 (vendor usage export CSV):

```
python3 recompute.py invoice.csv --pricesheet pricesheets/openai-2026-10.json --usage usage-export.csv --usage-format csv
```

Tier 3 (invoice only), with a JSON copy of the report:

```
python3 recompute.py invoice.json --pricesheet pricesheets/openai-2026-10.json --json-out report.json
```

Exit code 0 means rollup MATCH; 1 means anything below.

Run the control (planted-defect selftest plus mutation test):

```
python3 selftest.py
```

The selftest proves the clean fixture yields all-MATCH, that five planted
defect classes (billed above logs, billed below logs, model not in sheet,
usage gap, unparseable line) each yield exactly their verdict, and then
disables the rating comparison in a temp copy and requires the selftest to
go red there. A pipeline that has never demonstrated detection proves
nothing by silence.

## Price sheet status: REAL (standard tier)

`pricesheets/openai-2026-10.json` was encoded on 2026-10-13 from
https://developers.openai.com/api/docs/pricing (the address
platform.openai.com/docs/pricing now 301-redirects to). Every encoded rate
was read twice from the same fetched document, once from the
server-rendered table cells and once from the embedded component props
(which carry an explicit `tier` field, so the standard tier was read, not
inferred from tab order), and the two readings agreed. 37 models are
encoded; 21 published models are marked UNENCODABLE with per-model reasons
(short/long context splits at 272K input tokens, rates annotated as
context-bounded, per-minute or modality-split pricing, fine-tuning).

Sheet limits, also printed into every report:

- Standard service tier only; batch, flex, fast and ultrafast lines cannot
  be rated from this sheet.
- The page prints no effective dates, so the real sheet ships with
  `valid_from` and `valid_to` both null, which means it declares no validity
  window. By design the engine then rates every usage-based line
  INDETERMINATE rather than guessing that the retrieved rate held for the
  invoice period. **Pre-send step for any real engagement: set `valid_from`
  and `valid_to` from your own knowledge of when the rates were in effect
  (and archive the sheet for that period), or the recomputation check cannot
  run.**
- Regional (data residency) processing carries a published 10 percent
  uplift this sheet does not encode.

The selftest never touches the real sheet: it builds its own sheet marked
`"fixture": true`, and the engine refuses fixture sheets against real
invoices unless `allow_fixture` is passed explicitly.

## Report digest

`report.py` serializes the report body canonically and prints a sha256
content digest. It reuses `jcs_canonicalize` (RFC 8785) from this repo's
`packages/python/nobulex/crypto.py` when importable, and otherwise falls
back to a minimal local canonical JSON (sorted keys, compact separators;
not full RFC 8785). The report states which canonicalizer produced the
digest. Monetary values are serialized as fixed-format strings so both
canonicalizers produce identical bytes. The body carries no wall clock, so
identical inputs reproduce identical digests.

## Known boundaries of this version

- Validity-window gating is coarse: a usage event is checked for falling
  inside the sheet's declared `valid_from..valid_to` window, and any event
  outside it, or any event whose timestamp will not parse, makes that line's
  recomputation check INDETERMINATE. What it does NOT yet do is split a
  single invoice line across a mid-period rate change; it refuses such a line
  rather than rating each half. A sheet with no window rates every
  usage-based line INDETERMINATE. This closed a defect where a usage event
  dated years off was rated with full confidence against the retrieved sheet.
- Validity-window membership is date-granular and timezone-naive. Each
  usage event's date is compared against `valid_from..valid_to` using the
  timestamp exactly as written (logs are typically UTC); no conversion to
  the vendor's billing timezone is performed. An event on the first or last
  day of the window can therefore belong to the adjacent billing period if
  the billing timezone differs from the timestamp timezone (for example a
  `2026-10-01T00:30:00Z` event is still 2026-09-30 in any negative-offset
  billing zone). Such boundary-day events are not silently assumed in-period:
  the engine attaches a per-line date-granularity caveat and the report
  surfaces it even on a MATCH line, and the standing limits state the verdict
  assumes the timestamp date is the billing date. This version deliberately
  does not reconcile timezones; the caveat is the stated limit. A line whose
  correctness turns on a sub-day boundary should be re-run with usage
  pre-filtered to the vendor's billing-period boundaries.
- No per-request context-length accounting, which is why the 272K-split
  models are UNENCODABLE rather than guessed.
- One vendor (OpenAI), one unit (USD per 1M tokens), one tier per sheet.
