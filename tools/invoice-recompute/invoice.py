"""Parse a line-itemed invoice from CSV or JSON.

Expected line fields (CSV header names or JSON object keys, matched
case-insensitively):

  line_id        optional; synthesized as L001, L002, ... when absent
  model | sku    the billed model or SKU string, required
  usage_type     one of input, cached_input, output. Optional; when absent
                 the line is parsed but the usage type is recorded as
                 "unknown" and recompute.py cannot rate it (INDETERMINATE).
                 Common vendor phrasings are normalized: "input tokens",
                 "prompt", "prompt tokens" -> input; "cached input",
                 "cached input tokens", "cached" -> cached_input; "output
                 tokens", "completion", "completion tokens" -> output.
  quantity       billed token quantity, integer >= 0, required
  unit_price     billed price per 1M tokens in sheet currency, required
  amount         billed line amount in sheet currency, required

JSON shape: either a top-level list of line objects or {"lines": [...]}.

Discipline: an unparseable line never disappears. It becomes a line record
with parsed=False, the raw text preserved verbatim, and a reason. The engine
gives it NOT_EVALUATED.
"""

import csv
import json

_USAGE_TYPE_MAP = {
    "input": "input",
    "input tokens": "input",
    "prompt": "input",
    "prompt tokens": "input",
    "cached_input": "cached_input",
    "cached input": "cached_input",
    "cached input tokens": "cached_input",
    "cached": "cached_input",
    "output": "output",
    "output tokens": "output",
    "completion": "output",
    "completion tokens": "output",
}


def _norm_usage_type(value):
    if value in (None, ""):
        return "unknown"
    key = str(value).strip().lower()
    return _USAGE_TYPE_MAP.get(key, "unrecognized:" + key)


def _mkline(line_id, model, usage_type, quantity, unit_price, amount, raw):
    reasons = []
    if not model or not str(model).strip():
        reasons.append("missing model/sku")
    try:
        q = int(str(quantity).replace(",", ""))
        if q < 0:
            reasons.append("negative quantity")
    except (TypeError, ValueError):
        q = None
        reasons.append("unreadable quantity %r" % (quantity,))
    try:
        up = float(str(unit_price).replace("$", "").replace(",", ""))
        if up < 0:
            reasons.append("negative unit price")
    except (TypeError, ValueError):
        up = None
        reasons.append("unreadable unit price %r" % (unit_price,))
    try:
        amt = float(str(amount).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        amt = None
        reasons.append("unreadable amount %r" % (amount,))
    ut = _norm_usage_type(usage_type)
    if ut.startswith("unrecognized:"):
        reasons.append("unrecognized usage_type %r" % (usage_type,))
    if reasons:
        return {"line_id": line_id, "parsed": False, "raw": raw,
                "reason": "; ".join(reasons)}
    return {
        "line_id": line_id,
        "parsed": True,
        "model": str(model).strip(),
        "usage_type": ut,
        "quantity": q,
        "unit_price_per_1m": up,
        "billed_amount": amt,
        "raw": raw,
    }


def load_invoice_csv(path):
    lines = []
    with open(path, encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError("%s: empty file, no header row" % path)
        lower = [h.strip().lower() for h in header]

        def col(*names):
            for name in names:
                if name in lower:
                    return lower.index(name)
            return None

        idx = {
            "line_id": col("line_id", "line", "id"),
            "model": col("model", "sku"),
            "usage_type": col("usage_type", "type", "token_type"),
            "quantity": col("quantity", "qty", "tokens"),
            "unit_price": col("unit_price", "unit price",
                              "unit_price_per_1m", "price_per_1m", "rate"),
            "amount": col("amount", "line_amount", "total"),
        }
        required = [k for k in ("model", "quantity", "unit_price", "amount")
                    if idx[k] is None]
        if required:
            raise ValueError(
                "%s: header %r lacks required columns %s (see invoice.py "
                "docstring)" % (path, header, required))

        def cell(row, field):
            i = idx[field]
            if i is None or i >= len(row):
                return None
            return row[i]

        count = 0
        for n, row in enumerate(reader, start=2):
            if not any(c.strip() for c in row):
                continue
            count += 1
            lid = cell(row, "line_id") or ("L%03d" % count)
            lines.append(_mkline(
                lid, cell(row, "model"), cell(row, "usage_type"),
                cell(row, "quantity"), cell(row, "unit_price"),
                cell(row, "amount"), raw=",".join(row)))
    return lines


def load_invoice_json(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    if isinstance(doc, dict):
        raw_lines = doc.get("lines")
        if not isinstance(raw_lines, list):
            raise ValueError("%s: expected a list or {\"lines\": [...]}"
                             % path)
    elif isinstance(doc, list):
        raw_lines = doc
    else:
        raise ValueError("%s: expected a list or {\"lines\": [...]}" % path)

    lines = []
    for i, obj in enumerate(raw_lines, start=1):
        raw = json.dumps(obj, ensure_ascii=False)
        if not isinstance(obj, dict):
            lines.append({"line_id": "L%03d" % i, "parsed": False,
                          "raw": raw, "reason": "line is not an object"})
            continue
        low = {str(k).lower(): v for k, v in obj.items()}
        lid = low.get("line_id") or ("L%03d" % i)
        lines.append(_mkline(
            lid, low.get("model", low.get("sku")), low.get("usage_type"),
            low.get("quantity"), low.get("unit_price",
                                         low.get("unit_price_per_1m")),
            low.get("amount"), raw=raw))
    return lines


def load_invoice(path):
    if str(path).lower().endswith(".json"):
        return load_invoice_json(path)
    return load_invoice_csv(path)
