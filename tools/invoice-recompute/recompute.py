"""Rating engine: recompute each invoice line from normalized usage times
the pinned price sheet, and issue one verdict per line.

Verdicts, exactly four:

  MATCH          billed amount agrees with the recomputed amount within the
                 stated tolerance (default 0.5 percent relative plus one
                 cent absolute, per line). A MATCH is consistency with the
                 evidence provided, never certification of the invoice.
  MISMATCH       a stated numeric disagreement. The delta is signed and is
                 reported in both directions (billed minus recomputed, and
                 recomputed minus billed). This engine never characterizes a
                 mismatch as overbilling or as recovery; direction is a sign,
                 not an accusation.
  INDETERMINATE  the line was examined but the evidence does not support a
                 claim: evidence tier too low, no usage events for the
                 model, unreadable usage rows poking holes in the sums, a
                 rate the sheet does not print, or a line that does not say
                 which token type it bills.
  NOT_EVALUATED  the line was never rated at all: unparseable, model absent
                 from the sheet, or price marked UNENCODABLE. The reason and
                 the raw line are preserved.

Rollup discipline mirrors suite/harness.py in the nobulex-registry repo
(aggregate() and its _ORDER, harness.py lines 55 to 66): the worst outcome
dominates, one MISMATCH is not averaged away by two hundred MATCH lines, and
INDETERMINATE / NOT_EVALUATED may never be outranked by a MATCH from some
other line. That function is reimplemented here minimally (four tokens
instead of six) rather than imported, because this tool lives in a different
repository and must not depend on a sibling checkout being present; the
reimplementation is stated in README.md and in every report.
"""

import argparse
import json
import sys

import pricesheet as ps_mod
import usage as usage_mod
import invoice as invoice_mod

MATCH = "MATCH"
MISMATCH = "MISMATCH"
INDETERMINATE = "INDETERMINATE"
NOT_EVALUATED = "NOT_EVALUATED"

# Dominance order, worst first. Mirrors suite/harness.py _ORDER with the
# registry's six verdicts folded to this tool's four:
# FAIL_UNSAFE -> MISMATCH, INDETERMINATE -> INDETERMINATE,
# NOT_EVALUATED -> NOT_EVALUATED, PASS -> MATCH.
_ORDER = [MISMATCH, INDETERMINATE, NOT_EVALUATED, MATCH]

DEFAULT_TOL_REL = 0.005
DEFAULT_TOL_ABS = 0.01


def aggregate(outcomes):
    """Worst-dominates rollup. Empty input is NOT_EVALUATED: a run that
    examined nothing claims nothing."""
    for o in _ORDER:
        if o in outcomes:
            return o
    return NOT_EVALUATED


def amounts_agree(observed, recomputed, tol_rel, tol_abs):
    """The single rating comparison. Every numeric agreement decision in
    this engine routes through here so the selftest can prove the engine
    goes red when comparison is disabled.
    """
    delta = abs(observed - recomputed)
    # MUTATION-POINT: selftest.py copies this tree, replaces the next line
    # with "return True", and requires the selftest to fail. An engine that
    # stops comparing must not keep passing its own control.
    return delta <= tol_abs + tol_rel * abs(recomputed)


def _logged_quantity(totals, usage_type):
    """Token quantity the evidence supports for one usage type.

    input_tokens as logged includes the cached subset (see usage.py), so a
    billed "input" line is rated against the non-cached remainder.
    """
    if usage_type == "input":
        return totals["input_tokens"] - totals["cached_input_tokens"]
    if usage_type == "cached_input":
        return totals["cached_input_tokens"]
    if usage_type == "output":
        return totals["output_tokens"]
    return None


def evaluate_line(line, sheet, evidence, tol_rel, tol_abs):
    """Evaluate one parsed-or-not invoice line. Returns a result dict."""
    if not line.get("parsed"):
        return {
            "line_id": line.get("line_id"),
            "verdict": NOT_EVALUATED,
            "reasons": ["unparseable line: " + line.get("reason", "?")],
            "raw": line.get("raw"),
            "evidence_tier": evidence.tier,
        }

    result = {
        "line_id": line["line_id"],
        "model": line["model"],
        "usage_type": line["usage_type"],
        "billed_quantity": line["quantity"],
        "billed_unit_price_per_1m": line["unit_price_per_1m"],
        "billed_amount": line["billed_amount"],
        "evidence_tier": evidence.tier,
        "reasons": [],
    }
    checks = []

    status, data = sheet.lookup(line["model"])
    if status == ps_mod.ABSENT:
        result["verdict"] = NOT_EVALUATED
        result["reasons"].append(
            "model %r absent from price sheet %s"
            % (line["model"], sheet.sheet_id))
        result["raw"] = line["raw"]
        return result
    if status == ps_mod.UNENCODABLE:
        result["verdict"] = NOT_EVALUATED
        result["reasons"].append(
            "price UNENCODABLE for %r: %s" % (line["model"], data))
        result["raw"] = line["raw"]
        return result

    # Check 1, arithmetic-internal: quantity times unit price equals amount.
    # Needs no usage evidence at all, so it runs at every tier.
    implied = line["quantity"] * line["unit_price_per_1m"] / 1_000_000.0
    if amounts_agree(line["billed_amount"], implied, tol_rel, tol_abs):
        checks.append(MATCH)
    else:
        checks.append(MISMATCH)
        d = line["billed_amount"] - implied
        result["reasons"].append(
            "internal arithmetic: billed amount minus quantity*unit_price "
            "= %+0.6f; quantity*unit_price minus billed amount = %+0.6f "
            "(evidence basis: the invoice's own figures)" % (d, -d))

    if line["usage_type"] == "unknown":
        checks.append(INDETERMINATE)
        result["reasons"].append(
            "line does not state which token type is billed; no rate can "
            "be chosen")
        result["verdict"] = aggregate(checks)
        return result

    rate, why = sheet.rate_for(line["model"], line["usage_type"])
    if rate is None:
        checks.append(INDETERMINATE)
        result["reasons"].append(why)
        result["verdict"] = aggregate(checks)
        return result
    result["sheet_rate_per_1m"] = rate

    # Check 2, published-price: the billed unit price against the sheet.
    if amounts_agree(line["unit_price_per_1m"], rate, 0.0, 1e-9):
        checks.append(MATCH)
    else:
        checks.append(MISMATCH)
        d = line["unit_price_per_1m"] - rate
        result["reasons"].append(
            "billed unit price minus published %s-tier rate = %+0.6f per "
            "1M; published rate minus billed unit price = %+0.6f per 1M "
            "(evidence basis: price sheet %s, retrieved %s, %s)"
            % (sheet.service_tier, d, -d, sheet.sheet_id, sheet.retrieved,
               sheet.source_url))

    # Check 3, recomputation from usage evidence.
    if evidence.tier == usage_mod.TIER_INVOICE_ONLY:
        checks.append(INDETERMINATE)
        result["reasons"].append(
            "evidence tier 3 (invoice only): quantity cannot be rebuilt; "
            "only the arithmetic-internal and published-price checks ran")
    elif evidence.unreadable:
        checks.append(INDETERMINATE)
        result["reasons"].append(
            "usage evidence contains %d unreadable record(s); token sums "
            "are lower bounds, not totals, so no quantity claim is made"
            % len(evidence.unreadable))
    else:
        totals = evidence.totals_for(line["model"])
        if totals["event_count"] == 0:
            checks.append(INDETERMINATE)
            result["reasons"].append(
                "no usage evidence for model %r in the provided files; "
                "billed-but-unlogged usage cannot be distinguished from a "
                "fabricated line without a completeness claim for the logs"
                % line["model"])
        else:
            logged_qty = _logged_quantity(totals, line["usage_type"])
            recomputed = logged_qty * rate / 1_000_000.0
            result["logged_quantity"] = logged_qty
            result["recomputed_amount"] = recomputed
            result["quantity_delta_billed_minus_logged"] = (
                line["quantity"] - logged_qty)
            # Coverage gate: a recomputation is only a MATCH/MISMATCH claim
            # when the sheet can vouch for the period the usage fell in.
            # Usage outside the declared window, or a sheet with no window,
            # or usage whose timestamp cannot be parsed, is INDETERMINATE.
            stamps = evidence.timestamps_for(line["model"])
            cov = [sheet.coverage(ts) for ts in stamps]
            statuses = [c[0] for c in cov]
            if "UNKNOWN_NO_WINDOW" in statuses:
                checks.append(INDETERMINATE)
                reason = next(c[1] for c in cov
                              if c[0] == "UNKNOWN_NO_WINDOW")
                result["reasons"].append(reason)
            elif "OUT" in statuses:
                checks.append(INDETERMINATE)
                reason = next(c[1] for c in cov if c[0] == "OUT")
                result["reasons"].append(reason)
            elif "UNKNOWN_UNPARSEABLE" in statuses:
                checks.append(INDETERMINATE)
                n = sum(1 for s in statuses if s == "UNKNOWN_UNPARSEABLE")
                result["reasons"].append(
                    "%d of %d usage event(s) for this model carry no "
                    "parseable timestamp; cannot confirm the usage falls "
                    "within the sheet validity window" % (n, len(statuses)))
            else:
                # All usage dates are inside the window. Flag events sitting
                # on a window-boundary day: date-granular membership can bin
                # them into the adjacent billing period if the vendor's
                # billing timezone differs from the timestamp timezone. The
                # caveat is attached to MATCH and MISMATCH alike, because the
                # binning risk is independent of whether the amounts agree.
                edge = sum(1 for ts in stamps if sheet.on_window_edge(ts))
                if edge:
                    result["reasons"].append(
                        "date-granularity caveat: %d of %d usage event(s) "
                        "for this model fall on a validity-window boundary "
                        "day (%s or %s). Window membership is compared "
                        "date-only using the timestamp as written; if the "
                        "vendor's billing timezone differs from the "
                        "timestamp timezone, a boundary event can belong to "
                        "the adjacent billing period. This verdict assumes "
                        "the timestamp date is the billing date."
                        % (edge, len(stamps), sheet.valid_from,
                           sheet.valid_to))
                if amounts_agree(line["billed_amount"], recomputed,
                                 tol_rel, tol_abs):
                    checks.append(MATCH)
                else:
                    checks.append(MISMATCH)
                    d = line["billed_amount"] - recomputed
                    result["reasons"].append(
                        "billed amount minus recomputed amount = %+0.6f; "
                        "recomputed amount minus billed amount = %+0.6f "
                        "(recomputed = %d logged %s tokens x %s per 1M; "
                        "evidence basis: tier %d usage files, price sheet %s)"
                        % (d, -d, logged_qty, line["usage_type"], rate,
                           evidence.tier, sheet.sheet_id))

    result["verdict"] = aggregate(checks)
    if result["verdict"] == MATCH:
        result["reasons"].append(
            "consistent with provided evidence within tolerance "
            "(rel %s, abs %s); this is not certification of the invoice"
            % (tol_rel, tol_abs))
    return result


def evaluate_invoice(lines, sheet, evidence, tol_rel=DEFAULT_TOL_REL,
                     tol_abs=DEFAULT_TOL_ABS, allow_fixture=False):
    """Evaluate every line. Returns (results, rollup)."""
    if sheet.fixture and not allow_fixture:
        raise ps_mod.PriceSheetError(
            "price sheet %s is marked fixture: true. Fixture prices are "
            "synthetic and must never rate a real invoice. Pass "
            "allow_fixture=True only in selftests." % sheet.sheet_id)
    results = [evaluate_line(ln, sheet, evidence, tol_rel, tol_abs)
               for ln in lines]
    rollup = aggregate([r["verdict"] for r in results])
    return results, rollup


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Recompute a single usage-based invoice against a "
                    "dated price sheet and buyer-held usage evidence.")
    p.add_argument("invoice_file", help="invoice CSV or JSON")
    p.add_argument("--pricesheet", required=True)
    p.add_argument("--usage", help="usage evidence file (omit for tier 3)")
    p.add_argument("--usage-format", choices=("jsonl", "csv"),
                   help="jsonl = tier 1 request log, csv = tier 2 vendor "
                        "export; required when --usage is given")
    p.add_argument("--tolerance-rel", type=float, default=DEFAULT_TOL_REL)
    p.add_argument("--tolerance-abs", type=float, default=DEFAULT_TOL_ABS)
    p.add_argument("--json-out", help="also write the full report as JSON")
    p.add_argument("--allow-fixture", action="store_true",
                   help="permit a fixture price sheet (selftests only)")
    args = p.parse_args(argv)

    sheet = ps_mod.load_pricesheet(args.pricesheet)
    if args.usage:
        if not args.usage_format:
            p.error("--usage-format is required when --usage is given")
        if args.usage_format == "jsonl":
            evidence = usage_mod.load_request_log_jsonl(args.usage)
        else:
            evidence = usage_mod.load_vendor_export_csv(args.usage)
    else:
        evidence = usage_mod.invoice_only_evidence()

    lines = invoice_mod.load_invoice(args.invoice_file)
    results, rollup = evaluate_invoice(
        lines, sheet, evidence, tol_rel=args.tolerance_rel,
        tol_abs=args.tolerance_abs, allow_fixture=args.allow_fixture)

    import report as report_mod
    doc = report_mod.build_report(
        invoice_path=args.invoice_file, sheet=sheet, evidence=evidence,
        results=results, rollup=rollup, tol_rel=args.tolerance_rel,
        tol_abs=args.tolerance_abs)
    sys.stdout.write(report_mod.render_markdown(doc))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    return 0 if rollup == MATCH else 1


if __name__ == "__main__":
    raise SystemExit(main())
