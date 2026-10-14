"""Selftest: a synthetic fixture where everything MATCHes, then planted
defects, each asserted to yield exactly its verdict, then a mutation test
that disables the rating comparison in a temp copy of the engine and
requires this selftest to go red there.

Every number in the fixture is computed from the fixture's own rates and
token counts at build time. No expected dollar value is hardcoded; the
assertions are on verdicts and on the SIGN of computed deltas.

Run:  python3 selftest.py
      (--inner runs only the assertions; the mutation test uses it)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import invoice as invoice_mod
import pricesheet as ps_mod
import recompute as rc
import report as report_mod
import usage as usage_mod

RATES = {
    "fx-alpha": {"input_per_1m": 2.0, "cached_input_per_1m": 0.5,
                 "output_per_1m": 8.0, "table": "fixture"},
    "fx-beta": {"input_per_1m": 1.0, "cached_input_per_1m": None,
                "output_per_1m": 4.0, "table": "fixture"},
    "fx-gamma": {"input_per_1m": 3.0, "cached_input_per_1m": 0.3,
                 "output_per_1m": 9.0, "table": "fixture"},
}

EVENTS = [
    {"model": "fx-alpha", "input_tokens": 120000,
     "cached_input_tokens": 30000, "output_tokens": 45000,
     "timestamp": "2026-10-01T10:00:00Z"},
    {"model": "fx-alpha", "input_tokens": 200000,
     "cached_input_tokens": 50000, "output_tokens": 80000,
     "timestamp": "2026-10-02T11:00:00Z"},
    {"model": "fx-alpha", "input_tokens": 80000,
     "cached_input_tokens": 20000, "output_tokens": 35000,
     "timestamp": "2026-10-03T12:00:00Z"},
    {"model": "fx-beta", "input_tokens": 1000000,
     "cached_input_tokens": 0, "output_tokens": 250000,
     "timestamp": "2026-10-04T13:00:00Z"},
    {"model": "fx-beta", "input_tokens": 500000,
     "cached_input_tokens": 0, "output_tokens": 125000,
     "timestamp": "2026-10-05T14:00:00Z"},
]


def _fixture_sheet():
    return ps_mod.PriceSheet({
        "schema": ps_mod.SCHEMA,
        "vendor": "fixture-vendor",
        "sheet_id": "fixture-selftest",
        "fixture": True,
        "currency": "USD",
        "unit": "usd_per_1m_tokens",
        "service_tier": "standard",
        "retrieved": "2026-10-13",
        "valid_from": "2026-10-01",
        "valid_to": "2026-10-31",
        "source_url": "fixture://selftest",
        "caveats": ["fixture sheet; synthetic rates; selftest only"],
        "models": RATES,
        "unencodable": {
            "fx-unpriced": "fixture: rate deliberately marked unreadable "
                           "at source",
        },
    })


def _totals(model, usage_type):
    inp = sum(e["input_tokens"] for e in EVENTS if e["model"] == model)
    cached = sum(e["cached_input_tokens"] for e in EVENTS
                 if e["model"] == model)
    out = sum(e["output_tokens"] for e in EVENTS if e["model"] == model)
    return {"input": inp - cached, "cached_input": cached,
            "output": out}[usage_type]


def _amount(model, usage_type, qty):
    key = {"input": "input_per_1m", "cached_input": "cached_input_per_1m",
           "output": "output_per_1m"}[usage_type]
    return qty * RATES[model][key] / 1_000_000.0


def _clean_lines():
    lines = []
    n = 0
    for model, ut in (("fx-alpha", "input"), ("fx-alpha", "cached_input"),
                      ("fx-alpha", "output"), ("fx-beta", "input"),
                      ("fx-beta", "output")):
        n += 1
        qty = _totals(model, ut)
        key = {"input": "input_per_1m",
               "cached_input": "cached_input_per_1m",
               "output": "output_per_1m"}[ut]
        lines.append({
            "line_id": "L%03d" % n, "model": model, "usage_type": ut,
            "quantity": qty, "unit_price": RATES[model][key],
            "amount": _amount(model, ut, qty),
        })
    return lines


def _write_usage(tmp):
    path = os.path.join(tmp, "usage.jsonl")
    with open(path, "w", encoding="utf-8") as fh:
        for e in EVENTS:
            fh.write(json.dumps(e) + "\n")
    return path


def _write_invoice_json(tmp, name, lines):
    path = os.path.join(tmp, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"lines": lines}, fh, indent=1)
    return path


def _run(tmp, lines, sheet, evidence):
    path = _write_invoice_json(tmp, "inv-%d.json" % len(lines), lines)
    parsed = invoice_mod.load_invoice(path)
    return rc.evaluate_invoice(parsed, sheet, evidence, allow_fixture=True)


def _say(label, ok, detail):
    print("  [%s] %s: %s" % ("ok" if ok else "FAILED", label, detail))
    assert ok, "%s: %s" % (label, detail)


def inner():
    tmp = tempfile.mkdtemp(prefix="invoice-recompute-selftest-")
    sheet = _fixture_sheet()
    evidence = usage_mod.load_request_log_jsonl(_write_usage(tmp))
    _say("usage loads clean", len(evidence.events) == len(EVENTS)
         and not evidence.unreadable,
         "%d events, %d unreadable" % (len(evidence.events),
                                       len(evidence.unreadable)))
    _say("evidence tier", evidence.tier == usage_mod.TIER_REQUEST_LOG,
         "tier %d" % evidence.tier)

    print("\nCLEAN FIXTURE (every amount computed as qty x rate / 1e6):")
    clean = _clean_lines()
    for ln in clean:
        print("   %(line_id)s %(model)s %(usage_type)s qty=%(quantity)d "
              "unit=%(unit_price)s amount=%(amount).6f" % ln)
    results, rollup = _run(tmp, clean, sheet, evidence)
    for r in results:
        _say("clean %s" % r["line_id"], r["verdict"] == rc.MATCH,
             "verdict %s" % r["verdict"])
    _say("clean rollup", rollup == rc.MATCH, rollup)

    print("\nPLANTED (a): one line billed ABOVE logged usage:")
    qty = _totals("fx-alpha", "output")
    bad_qty = int(qty * 1.07)
    planted = dict(line_id="L900", model="fx-alpha", usage_type="output",
                   quantity=bad_qty,
                   unit_price=RATES["fx-alpha"]["output_per_1m"],
                   amount=_amount("fx-alpha", "output", bad_qty))
    results, rollup = _run(tmp, clean + [planted], sheet, evidence)
    r = [x for x in results if x["line_id"] == "L900"][0]
    delta = r["billed_amount"] - r["recomputed_amount"]
    print("   billed qty=%d logged qty=%d billed=%.6f recomputed=%.6f "
          "delta billed-recomputed=%+.6f"
          % (bad_qty, r["logged_quantity"], r["billed_amount"],
             r["recomputed_amount"], delta))
    _say("(a) verdict", r["verdict"] == rc.MISMATCH, r["verdict"])
    _say("(a) delta sign positive", delta > 0, "%+.6f" % delta)
    _say("(a) rollup dominated by MISMATCH", rollup == rc.MISMATCH, rollup)
    _say("(a) no forbidden vocabulary",
         all("overbill" not in rs.lower() and "recover" not in rs.lower()
             for rs in r["reasons"]), "; ".join(r["reasons"]))

    print("\nPLANTED (b): one line billed BELOW logged usage:")
    bad_qty = int(qty * 0.93)
    planted = dict(line_id="L901", model="fx-alpha", usage_type="output",
                   quantity=bad_qty,
                   unit_price=RATES["fx-alpha"]["output_per_1m"],
                   amount=_amount("fx-alpha", "output", bad_qty))
    results, rollup = _run(tmp, clean + [planted], sheet, evidence)
    r = [x for x in results if x["line_id"] == "L901"][0]
    delta = r["billed_amount"] - r["recomputed_amount"]
    print("   billed qty=%d logged qty=%d delta billed-recomputed=%+.6f"
          % (bad_qty, r["logged_quantity"], delta))
    _say("(b) verdict", r["verdict"] == rc.MISMATCH, r["verdict"])
    _say("(b) delta sign negative", delta < 0, "%+.6f" % delta)

    print("\nPLANTED (c): models the sheet cannot rate:")
    ghost = dict(line_id="L902", model="fx-ghost", usage_type="input",
                 quantity=1000, unit_price=1.0,
                 amount=1000 * 1.0 / 1_000_000.0)
    unpriced = dict(line_id="L903", model="fx-unpriced",
                    usage_type="input", quantity=1000, unit_price=1.0,
                    amount=1000 * 1.0 / 1_000_000.0)
    results, rollup = _run(tmp, clean + [ghost, unpriced], sheet, evidence)
    r = [x for x in results if x["line_id"] == "L902"][0]
    _say("(c) absent model verdict", r["verdict"] == rc.NOT_EVALUATED,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(c) absent reason states absence",
         any("absent" in rs for rs in r["reasons"]), r["reasons"])
    r = [x for x in results if x["line_id"] == "L903"][0]
    _say("(c) unencodable verdict", r["verdict"] == rc.NOT_EVALUATED,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(c) unencodable reason carried",
         any("UNENCODABLE" in rs for rs in r["reasons"]), r["reasons"])
    _say("(c) rollup NOT_EVALUATED dominates MATCH",
         rollup == rc.NOT_EVALUATED, rollup)

    print("\nPLANTED (d): usage gap, sheet knows the model, logs do not:")
    gap_qty = 50000
    gap = dict(line_id="L904", model="fx-gamma", usage_type="input",
               quantity=gap_qty,
               unit_price=RATES["fx-gamma"]["input_per_1m"],
               amount=_amount("fx-gamma", "input", gap_qty))
    results, rollup = _run(tmp, clean + [gap], sheet, evidence)
    r = [x for x in results if x["line_id"] == "L904"][0]
    _say("(d) verdict", r["verdict"] == rc.INDETERMINATE,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(d) rollup INDETERMINATE dominates MATCH",
         rollup == rc.INDETERMINATE, rollup)

    print("\nPLANTED (e): unparseable line in a CSV invoice:")
    csv_path = os.path.join(tmp, "inv-garbage.csv")
    good = clean[0]
    with open(csv_path, "w", encoding="utf-8") as fh:
        fh.write("line_id,model,usage_type,quantity,unit_price,amount\n")
        fh.write("%s,%s,%s,%d,%s,%.6f\n" % (
            good["line_id"], good["model"], good["usage_type"],
            good["quantity"], good["unit_price"], good["amount"]))
        fh.write("L905,fx-alpha,output,not_a_number,8.0,oops\n")
    parsed = invoice_mod.load_invoice(csv_path)
    results, rollup = rc.evaluate_invoice(parsed, sheet, evidence,
                                          allow_fixture=True)
    r = [x for x in results if x["line_id"] == "L905"][0]
    _say("(e) verdict", r["verdict"] == rc.NOT_EVALUATED,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(e) raw line preserved",
         r.get("raw") == "L905,fx-alpha,output,not_a_number,8.0,oops",
         repr(r.get("raw")))

    print("\nPLANTED (f): usage dated outside the sheet validity window:")
    oow_event = {"model": "fx-alpha", "input_tokens": 100000,
                 "cached_input_tokens": 0, "output_tokens": 45000,
                 "timestamp": "2026-09-15T09:00:00Z"}
    oow_path = os.path.join(tmp, "usage-oow.jsonl")
    with open(oow_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(oow_event) + "\n")
    oow_evidence = usage_mod.load_request_log_jsonl(oow_path)
    oow_qty = oow_event["output_tokens"]
    # This line would MATCH on every check if the date were in-window: the
    # amount is built straight from the logged quantity and the sheet rate.
    # Only the coverage gate can make it INDETERMINATE.
    f_line = dict(line_id="L906", model="fx-alpha", usage_type="output",
                  quantity=oow_qty,
                  unit_price=RATES["fx-alpha"]["output_per_1m"],
                  amount=_amount("fx-alpha", "output", oow_qty))
    results, rollup = _run(tmp, [f_line], sheet, oow_evidence)
    r = [x for x in results if x["line_id"] == "L906"][0]
    print("   event dated %s; window %s..%s; verdict %s"
          % (oow_event["timestamp"], sheet.valid_from, sheet.valid_to,
             r["verdict"]))
    _say("(f) verdict", r["verdict"] == rc.INDETERMINATE,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(f) reason names the validity window",
         any("validity window" in rs for rs in r["reasons"]), r["reasons"])

    print("\nCOVERAGE GUARD (red-then-green): the window check must be")
    print("load-bearing, not decoration.")
    results, _ = _run(tmp, [f_line], sheet, oow_evidence)
    normal = [x for x in results if x["line_id"] == "L906"][0]["verdict"]
    print("   with coverage gate active:   %s" % normal)
    _say("coverage guard GREEN (gate active -> INDETERMINATE)",
         normal == rc.INDETERMINATE, normal)
    # Defeat the gate: force every timestamp to read as in-window. The line
    # must then WRONGLY lose its INDETERMINATE verdict, proving the gate
    # alone produced it.
    sheet.coverage = lambda ts: ("IN", None)
    try:
        results, _ = _run(tmp, [f_line], sheet, oow_evidence)
        defeated = [x for x in results
                    if x["line_id"] == "L906"][0]["verdict"]
    finally:
        del sheet.coverage
    print("   with coverage gate defeated: %s" % defeated)
    _say("coverage guard RED (gate defeated -> non-INDETERMINATE)",
         defeated != rc.INDETERMINATE, defeated)
    _say("coverage guard is load-bearing (verdict flipped on defeat)",
         normal == rc.INDETERMINATE and defeated != rc.INDETERMINATE,
         "active=%s defeated=%s" % (normal, defeated))

    print("\nPLANTED (g): usage ON the window boundary days (date-granular")
    print("binning could mis-bin into an adjacent billing period):")
    # Two events, one on valid_from (2026-10-01) and one on valid_to
    # (2026-10-31), both at UTC times that a billing-timezone offset could
    # push into the adjacent month. Amount is built straight from the logged
    # quantity and sheet rate, so every numeric check MATCHes; only the
    # boundary caveat should be added, and the verdict must stay MATCH.
    g_events = [
        {"model": "fx-alpha", "input_tokens": 100000,
         "cached_input_tokens": 0, "output_tokens": 0,
         "timestamp": "2026-10-01T00:30:00Z"},
        {"model": "fx-alpha", "input_tokens": 100000,
         "cached_input_tokens": 0, "output_tokens": 0,
         "timestamp": "2026-10-31T23:30:00Z"},
    ]
    g_path = os.path.join(tmp, "usage-boundary.jsonl")
    with open(g_path, "w", encoding="utf-8") as fh:
        for e in g_events:
            fh.write(json.dumps(e) + "\n")
    g_evidence = usage_mod.load_request_log_jsonl(g_path)
    g_qty = sum(e["input_tokens"] for e in g_events)
    g_line = dict(line_id="L907", model="fx-alpha", usage_type="input",
                  quantity=g_qty,
                  unit_price=RATES["fx-alpha"]["input_per_1m"],
                  amount=_amount("fx-alpha", "input", g_qty))
    results_g, rollup_g = _run(tmp, [g_line], sheet, g_evidence)
    r = [x for x in results_g if x["line_id"] == "L907"][0]
    print("   events dated %s and %s; window %s..%s; verdict %s"
          % (g_events[0]["timestamp"], g_events[1]["timestamp"],
             sheet.valid_from, sheet.valid_to, r["verdict"]))
    _say("(g) verdict stays MATCH", r["verdict"] == rc.MATCH,
         "%s / %s" % (r["verdict"], r["reasons"]))
    _say("(g) boundary caveat attached",
         any(str(rs).startswith("date-granularity caveat")
             for rs in r["reasons"]), r["reasons"])
    _say("(g) caveat names the billing-date assumption",
         any("assumes the timestamp date is the billing date" in str(rs)
             for rs in r["reasons"]), r["reasons"])
    _say("(g) no forbidden vocabulary in caveat",
         all("overbill" not in str(rs).lower()
             and "recover" not in str(rs).lower() for rs in r["reasons"]),
         "; ".join(r["reasons"]))
    doc_g = report_mod.build_report(
        invoice_path=g_path, sheet=sheet, evidence=g_evidence,
        results=results_g, rollup=rollup_g, tol_rel=rc.DEFAULT_TOL_REL,
        tol_abs=rc.DEFAULT_TOL_ABS)
    md_g = report_mod.render_markdown(doc_g)
    _say("(g) MATCH-line caveat surfaced in markdown",
         "## Date-granularity caveats on MATCH lines" in md_g
         and "L907" in md_g.split(
             "## Date-granularity caveats on MATCH lines")[1],
         "section present and names the line")
    _say("(g) standing limits state date-granular windowing",
         "checked date-granularly" in md_g, "limit text present")
    _say("(g) stale 'not windowed' claim is gone",
         "not windowed" not in md_g, "stale claim absent")
    # Interior event (not a boundary day) must NOT get the caveat, or the
    # flag would be decoration that always fires.
    int_path = os.path.join(tmp, "usage-interior.jsonl")
    with open(int_path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(
            {"model": "fx-alpha", "input_tokens": 100000,
             "cached_input_tokens": 0, "output_tokens": 0,
             "timestamp": "2026-10-15T10:00:00Z"}) + "\n")
    int_evidence = usage_mod.load_request_log_jsonl(int_path)
    int_line = dict(line_id="L908", model="fx-alpha", usage_type="input",
                    quantity=100000,
                    unit_price=RATES["fx-alpha"]["input_per_1m"],
                    amount=_amount("fx-alpha", "input", 100000))
    results_i, _ = _run(tmp, [int_line], sheet, int_evidence)
    ri = [x for x in results_i if x["line_id"] == "L908"][0]
    _say("(g) interior event gets NO boundary caveat (flag is selective)",
         ri["verdict"] == rc.MATCH
         and not any(str(rs).startswith("date-granularity caveat")
                     for rs in ri["reasons"]),
         "%s / %s" % (ri["verdict"], ri["reasons"]))

    print("\nREPORT: builds, limits first, digest present:")
    doc = report_mod.build_report(
        invoice_path=csv_path, sheet=sheet, evidence=evidence,
        results=results, rollup=rollup, tol_rel=rc.DEFAULT_TOL_REL,
        tol_abs=rc.DEFAULT_TOL_ABS)
    md = report_mod.render_markdown(doc)
    _say("report digest shape",
         len(doc["digest"]["value"]) == 64
         and all(c in "0123456789abcdef" for c in doc["digest"]["value"]),
         doc["digest"]["value"])
    _say("limits precede line table",
         md.index("## Limits") < md.index("## Line table"), "order check")
    _say("fixture warning rendered", "FIXTURE" in md, "present")
    print("   canonicalization: %s" % doc["digest"]["canonicalization"])
    print("   digest: %s" % doc["digest"]["value"])

    print("\nFIXTURE GUARD: fixture sheet refused without allow_fixture:")
    try:
        rc.evaluate_invoice(parsed, sheet, evidence, allow_fixture=False)
        _say("fixture guard", False, "no exception raised")
    except ps_mod.PriceSheetError as exc:
        _say("fixture guard", "fixture" in str(exc), str(exc)[:70])

    shutil.rmtree(tmp, ignore_errors=True)
    print("\nINNER SELFTEST: all assertions passed.")


MUTANT_TARGET = "return delta <= tol_abs + tol_rel * abs(recomputed)"


def mutation_test():
    print("\n" + "=" * 70)
    print("MUTATION TEST: disable the rating comparison in a temp copy and")
    print("require this selftest to go red there.")
    tmp = tempfile.mkdtemp(prefix="invoice-recompute-mutant-")
    dst = os.path.join(tmp, "tool")
    shutil.copytree(HERE, dst,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    path = os.path.join(dst, "recompute.py")
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    count = src.count(MUTANT_TARGET)
    assert count == 1, ("expected exactly one MUTATION-POINT comparison, "
                        "found %d" % count)
    src = src.replace(MUTANT_TARGET,
                      "return True  # MUTATED: comparison disabled")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(src)
    print("mutated %s: comparison replaced with 'return True'" % path)

    proc = subprocess.run(
        [sys.executable, os.path.join(dst, "selftest.py"), "--inner"],
        capture_output=True, text=True, cwd=dst)
    print("\n--- mutated selftest output (verbatim) ---")
    sys.stdout.write(proc.stdout)
    sys.stdout.write(proc.stderr)
    print("--- end mutated selftest output ---")
    print("mutated selftest exit code: %d" % proc.returncode)
    assert proc.returncode != 0, (
        "MUTATION TEST FAILED: the selftest still passes with the rating "
        "comparison disabled. The engine proves nothing by silence.")
    print("MUTATION TEST PASSED: selftest went red with comparison "
          "disabled, as required.")
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    if "--inner" in sys.argv[1:]:
        inner()
        return 0
    inner()
    mutation_test()
    print("\nSELFTEST COMPLETE: clean fixture all-MATCH, seven planted "
          "defect classes each yield exactly their verdict (including a "
          "window-boundary line that stays MATCH but carries a stated "
          "date-granularity caveat), the coverage gate is load-bearing "
          "(red-then-green), and the engine fails its own control when "
          "comparison is disabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
