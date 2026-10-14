"""Emit the deliverable: limits first, then the line table, then the
not-examined list, then a sha256 content digest over a canonically
serialized report body.

Canonicalization: this module first tries to reuse jcs_canonicalize (RFC
8785 via the rfc8785 package) from the nobulex Python package that lives in
this same repository at packages/python/nobulex/crypto.py. If that import
fails (the package or its rfc8785 dependency is not installed), it falls
back to a minimal local canonical JSON: sorted keys, no whitespace,
ensure_ascii=False. The fallback is NOT full RFC 8785 (its float
serialization and string escaping rules differ in corner cases), which is
why every monetary value in the report body is serialized as a fixed-format
STRING and every count as an int, so both canonicalizers produce identical
bytes for identical reports. The report states which canonicalizer produced
the digest.

The body carries no wall-clock timestamp, so re-running the same inputs
reproduces the same digest. Reproducibility is the point of the digest.
"""

import hashlib
import json
import os
import sys

_PKG_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "packages", "python"))


def _get_canonicalizer():
    """Returns (name, fn) where fn: dict -> canonical JSON string."""
    try:
        if _PKG_PATH not in sys.path:
            sys.path.insert(0, _PKG_PATH)
        from nobulex.crypto import jcs_canonicalize
        return ("rfc8785 via nobulex.crypto.jcs_canonicalize",
                jcs_canonicalize)
    except Exception:
        def local_canonical(obj):
            return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                              ensure_ascii=False)
        return ("local minimal canonical JSON (sorted keys, compact, "
                "ensure_ascii=False; NOT full RFC 8785)", local_canonical)


def _money(x):
    if x is None:
        return None
    return "%.6f" % x


TOOL_ID = "invoice-recompute v0.1"

STANDING_LIMITS = [
    "A MATCH is consistency of the examined line with the evidence the "
    "buyer provided and the pinned price sheet. It is not certification "
    "of the invoice.",
    "Vendor-side metering correctness is not established. The usage "
    "figures in buyer logs are the figures the vendor's API returned; "
    "recomputation checks that those figures, summed and rated, match the "
    "invoice. It cannot check that the vendor counted tokens correctly in "
    "the first place.",
    "Usage the buyer did not log is not established. A billed quantity "
    "above the logged quantity is a discrepancy against the buyer's "
    "evidence, not proven overbilling: vendor-side retries, system "
    "tokens, and usage from unlogged keys can all be legitimate.",
    "Private or negotiated rate cards are not established. The price "
    "sheet encodes published rates for one service tier; discounted or "
    "regionally uplifted lines rate as MISMATCH or INDETERMINATE against "
    "the published sheet and must be re-run against the contract rate "
    "card if the buyer provides one.",
    "No dollar recovery is asserted anywhere in this report. Deltas are "
    "signed numbers, stated in both directions, with their evidence basis. "
    "The buyer computes financial conclusions from their own ledger.",
    "Rounding-order ambiguity is real: per-request rounding versus "
    "per-period aggregation can differ by small amounts and the vendor's "
    "choice is unobservable from outside. Agreement inside the stated "
    "tolerance is reported as within-tolerance consistency, nothing "
    "stronger.",
    "Validity-window membership is checked date-granularly: each usage "
    "event's date is compared against the sheet's valid_from..valid_to "
    "window, and any event outside it (or any sheet declaring no window) "
    "makes that line's recomputation INDETERMINATE. The comparison uses "
    "the timestamp's own date as written and attempts no timezone "
    "conversion. If the vendor's billing timezone differs from the "
    "timestamp timezone, an event on the first or last day of the window "
    "can belong to the adjacent billing period; such boundary events carry "
    "a per-line date-granularity caveat, and any MATCH or MISMATCH on them "
    "assumes the timestamp date is the billing date.",
]

TIER_LABELS = {
    1: "tier 1: buyer-side request logs (independent of the vendor's "
       "reporting pipeline to the extent the logged fields are the ones "
       "the API returned)",
    2: "tier 2: the vendor's own usage export (a vendor self-consistency "
       "check, NOT independent of the vendor's metering)",
    3: "tier 3: invoice only (arithmetic-internal and published-price "
       "checks only; every quantity verdict is INDETERMINATE)",
}


def build_report(invoice_path, sheet, evidence, results, rollup,
                 tol_rel, tol_abs):
    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1

    lines_out = []
    for r in results:
        lines_out.append({
            "line_id": r.get("line_id"),
            "model": r.get("model"),
            "usage_type": r.get("usage_type"),
            "billed_quantity": r.get("billed_quantity"),
            "billed_unit_price_per_1m": _money(
                r.get("billed_unit_price_per_1m")),
            "billed_amount": _money(r.get("billed_amount")),
            "sheet_rate_per_1m": _money(r.get("sheet_rate_per_1m")),
            "logged_quantity": r.get("logged_quantity"),
            "recomputed_amount": _money(r.get("recomputed_amount")),
            "quantity_delta_billed_minus_logged": r.get(
                "quantity_delta_billed_minus_logged"),
            "evidence_tier": r.get("evidence_tier"),
            "verdict": r["verdict"],
            "reasons": list(r.get("reasons", [])),
            "raw": r.get("raw"),
        })

    not_examined = [
        {"item": "lines verdicted NOT_EVALUATED",
         "detail": [
             {"line_id": r.get("line_id"), "reasons": r.get("reasons"),
              "raw": r.get("raw")}
             for r in results if r["verdict"] == "NOT_EVALUATED"]},
        {"item": "models the price sheet marks UNENCODABLE",
         "detail": sheet.doc.get("unencodable", {})},
        {"item": "service tiers other than the sheet's",
         "detail": "sheet encodes %s tier only" % sheet.service_tier},
        {"item": "vendor-side metering, unlogged usage, private rate "
                 "cards, regional uplift, time-window membership",
         "detail": "see limits section; none of these are established"},
    ]

    body = {
        "tool": TOOL_ID,
        "limits": STANDING_LIMITS + sheet.caveats,
        "inputs": {
            "invoice_file": os.path.basename(str(invoice_path)),
            "invoice_sha256": _file_sha256(invoice_path),
            "usage_source": os.path.basename(str(evidence.source)),
            "usage_sha256": _file_sha256(evidence.source),
            "evidence_tier": evidence.tier,
            "evidence_tier_label": TIER_LABELS[evidence.tier],
            "usage_events": len(evidence.events),
            "usage_unreadable": len(evidence.unreadable),
            "pricesheet_id": sheet.sheet_id,
            "pricesheet_fixture": sheet.fixture,
            "pricesheet_source_url": sheet.source_url,
            "pricesheet_retrieved": sheet.retrieved,
            "pricesheet_service_tier": sheet.service_tier,
            "tolerance_rel": "%.6f" % tol_rel,
            "tolerance_abs": "%.6f" % tol_abs,
        },
        "rollup": {
            "verdict": rollup,
            "counts": counts,
            "note": "worst outcome dominates (order MISMATCH, "
                    "INDETERMINATE, NOT_EVALUATED, MATCH), mirroring "
                    "nobulex-registry suite/harness.py aggregate(); "
                    "reimplemented locally, not imported",
        },
        "lines": lines_out,
        "not_examined": not_examined,
    }
    name, canon = _get_canonicalizer()
    digest = hashlib.sha256(canon(body).encode("utf-8")).hexdigest()
    return {"body": body,
            "digest": {"algorithm": "sha256", "canonicalization": name,
                       "value": digest}}


def _file_sha256(path):
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except (OSError, TypeError, ValueError):
        return None


def render_markdown(doc):
    body = doc["body"]
    out = []
    w = out.append
    w("# Single-invoice recomputation report\n")
    w("\n## Limits (read first)\n\n")
    if body["inputs"]["pricesheet_fixture"]:
        w("**WARNING: the price sheet used for this run is a FIXTURE. "
          "Every rate in it is synthetic. No statement below says anything "
          "about a real invoice.**\n\n")
    for i, lim in enumerate(body["limits"], 1):
        w("%d. %s\n" % (i, lim))

    w("\n## Inputs\n\n")
    inp = body["inputs"]
    for k in ("invoice_file", "invoice_sha256", "usage_source",
              "usage_sha256", "evidence_tier_label", "usage_events",
              "usage_unreadable", "pricesheet_id", "pricesheet_source_url",
              "pricesheet_retrieved", "pricesheet_service_tier",
              "tolerance_rel", "tolerance_abs"):
        w("- %s: %s\n" % (k, inp[k]))

    w("\n## Verdict rollup\n\n")
    w("- rollup verdict: **%s**\n" % body["rollup"]["verdict"])
    for v in ("MATCH", "MISMATCH", "INDETERMINATE", "NOT_EVALUATED"):
        w("- %s: %d\n" % (v, body["rollup"]["counts"].get(v, 0)))
    w("- %s\n" % body["rollup"]["note"])

    w("\n## Line table\n\n")
    w("| line | model | type | billed qty | billed amt | logged qty "
      "| recomputed amt | tier | verdict |\n")
    w("|---|---|---|---|---|---|---|---|---|\n")
    for ln in body["lines"]:
        w("| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n" % (
            ln["line_id"], ln.get("model") or "?",
            ln.get("usage_type") or "?",
            ln.get("billed_quantity") if ln.get("billed_quantity")
            is not None else "?",
            ln.get("billed_amount") or "?",
            ln.get("logged_quantity") if ln.get("logged_quantity")
            is not None else "-",
            ln.get("recomputed_amount") or "-",
            ln.get("evidence_tier"), ln["verdict"]))

    w("\n## Per-line reasons (non-MATCH)\n\n")
    any_reason = False
    for ln in body["lines"]:
        if ln["verdict"] == "MATCH":
            continue
        any_reason = True
        w("- %s [%s]:\n" % (ln["line_id"], ln["verdict"]))
        for rs in ln["reasons"]:
            w("  - %s\n" % rs)
        if ln.get("raw"):
            w("  - raw line preserved: %s\n" % ln["raw"])
    if not any_reason:
        w("(none; every line is MATCH)\n")

    # A MATCH line is otherwise silent, so any date-granularity caveat it
    # carries would never reach the human reader. Surface those here: a
    # boundary MATCH must state the assumption it rests on.
    caveat_lines = [
        ln for ln in body["lines"]
        if ln["verdict"] == "MATCH"
        and any(str(rs).startswith("date-granularity caveat")
                for rs in ln["reasons"])]
    if caveat_lines:
        w("\n## Date-granularity caveats on MATCH lines\n\n")
        for ln in caveat_lines:
            w("- %s [MATCH]:\n" % ln["line_id"])
            for rs in ln["reasons"]:
                if str(rs).startswith("date-granularity caveat"):
                    w("  - %s\n" % rs)

    w("\n## Not examined\n\n")
    for item in body["not_examined"]:
        w("- %s: %s\n" % (item["item"], json.dumps(item["detail"],
                                                   ensure_ascii=False)))

    w("\n## Content digest\n\n")
    w("- algorithm: %s\n" % doc["digest"]["algorithm"])
    w("- canonicalization: %s\n" % doc["digest"]["canonicalization"])
    w("- digest over canonical report body: %s\n" % doc["digest"]["value"])
    return "".join(out)
