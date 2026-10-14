"""Normalize buyer-held usage evidence into one event schema, with the
evidence tier labelled on the result.

Evidence tiers (from the buyer-side design, CHEAP-TEST-buyer-side-20261013):

  tier 1   the buyer's own request logs (JSONL). Independent of the vendor's
           reporting pipeline to the extent the logged usage fields are the
           ones the API returned per response.
  tier 2   the vendor's own usage export (CSV). A self-consistency artifact:
           it checks vendor-against-vendor, not vendor-against-buyer, and
           every report must say so.
  tier 3   invoice only, no usage files. Only arithmetic-internal checks are
           possible; every quantity verdict is INDETERMINATE or
           NOT_EVALUATED.

Normalized event fields:

  model                 string, required
  input_tokens          int >= 0, required. Total input (prompt) tokens as
                        the API reported them, INCLUDING any cached subset.
  output_tokens         int >= 0, required
  cached_input_tokens   int >= 0, optional, default 0. Subset of
                        input_tokens served from cache. An event where
                        cached_input_tokens > input_tokens is incoherent and
                        is routed to unreadable, not silently clamped.
  timestamp_raw         string or None. Carried through verbatim; this
                        version does not window-filter and says so.

Accepted input formats:

(a) OpenAI-style usage export CSV (tier 2). Header names are matched
    case-insensitively against these alias sets; the first present alias
    wins:
      model:                model, model_id
      input_tokens:         input_tokens, prompt_tokens,
                            n_context_tokens_total
      output_tokens:        output_tokens, completion_tokens,
                            n_generated_tokens_total
      cached_input_tokens:  cached_input_tokens, cached_tokens (optional)
      timestamp:            timestamp, date, start_time, aggregation_timestamp
                            (optional)

(b) Generic JSONL request log (tier 1). One JSON object per line with keys
    model, input_tokens, output_tokens, and optionally cached_input_tokens
    and timestamp.

Discipline: a row or line that cannot be read becomes an entry in
`unreadable` with its line number, the raw text, and the reason. It is never
dropped and never guessed at. recompute.py degrades every quantity verdict
to INDETERMINATE while unreadable entries exist, because a sum over evidence
with holes is a lower bound, not a total.
"""

import csv
import json

TIER_REQUEST_LOG = 1
TIER_VENDOR_EXPORT = 2
TIER_INVOICE_ONLY = 3

_ALIASES = {
    "model": ("model", "model_id"),
    "input_tokens": ("input_tokens", "prompt_tokens",
                     "n_context_tokens_total"),
    "output_tokens": ("output_tokens", "completion_tokens",
                      "n_generated_tokens_total"),
    "cached_input_tokens": ("cached_input_tokens", "cached_tokens"),
    "timestamp": ("timestamp", "date", "start_time",
                  "aggregation_timestamp"),
}


class UsageEvidence:
    def __init__(self, tier, source, events=None, unreadable=None):
        self.tier = tier
        self.source = source
        self.events = events if events is not None else []
        self.unreadable = unreadable if unreadable is not None else []

    def totals_for(self, model):
        """Summed tokens for one model: dict with input_tokens,
        output_tokens, cached_input_tokens, event_count."""
        t = {"input_tokens": 0, "output_tokens": 0,
             "cached_input_tokens": 0, "event_count": 0}
        for e in self.events:
            if e["model"] != model:
                continue
            t["input_tokens"] += e["input_tokens"]
            t["output_tokens"] += e["output_tokens"]
            t["cached_input_tokens"] += e["cached_input_tokens"]
            t["event_count"] += 1
        return t

    def timestamps_for(self, model):
        """The timestamp_raw value (including None) of every event whose
        model matches. Mirrors totals_for."""
        out = []
        for e in self.events:
            if e["model"] != model:
                continue
            out.append(e["timestamp_raw"])
        return out


def invoice_only_evidence():
    """Tier 3: the buyer handed over nothing but the invoice."""
    return UsageEvidence(TIER_INVOICE_ONLY, source="(no usage files)")


def _coerce_event(model, inp, out, cached, ts):
    if not model or not str(model).strip():
        return None, "missing model"
    try:
        inp_i = int(inp)
        out_i = int(out)
        cached_i = int(cached) if cached not in (None, "", "-") else 0
    except (TypeError, ValueError):
        return None, "non-integer token count"
    if inp_i < 0 or out_i < 0 or cached_i < 0:
        return None, "negative token count"
    if cached_i > inp_i:
        return None, ("cached_input_tokens (%d) exceeds input_tokens (%d); "
                      "incoherent record" % (cached_i, inp_i))
    return {
        "model": str(model).strip(),
        "input_tokens": inp_i,
        "output_tokens": out_i,
        "cached_input_tokens": cached_i,
        "timestamp_raw": str(ts) if ts not in (None, "") else None,
    }, None


def load_vendor_export_csv(path):
    """Tier 2: vendor usage export CSV. See module docstring for columns."""
    events, unreadable = [], []
    with open(path, encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError("%s: empty file, no header row" % path)
        lower = [h.strip().lower() for h in header]

        def col(field):
            for alias in _ALIASES[field]:
                if alias in lower:
                    return lower.index(alias)
            return None

        idx = {f: col(f) for f in _ALIASES}
        missing = [f for f in ("model", "input_tokens", "output_tokens")
                   if idx[f] is None]
        if missing:
            raise ValueError(
                "%s: header %r lacks required columns %s (see usage.py "
                "docstring for accepted aliases)" % (path, header, missing))

        def cell(row, field):
            i = idx[field]
            if i is None or i >= len(row):
                return None
            return row[i]

        for n, row in enumerate(reader, start=2):
            if not any(c.strip() for c in row):
                continue
            ev, why = _coerce_event(
                cell(row, "model"), cell(row, "input_tokens"),
                cell(row, "output_tokens"), cell(row, "cached_input_tokens"),
                cell(row, "timestamp"))
            if ev is None:
                unreadable.append({"line": n, "raw": ",".join(row),
                                   "reason": why})
            else:
                events.append(ev)
    return UsageEvidence(TIER_VENDOR_EXPORT, source=path,
                         events=events, unreadable=unreadable)


def load_request_log_jsonl(path):
    """Tier 1: buyer's own JSONL request log. See module docstring."""
    events, unreadable = [], []
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, start=1):
            raw = line.rstrip("\n")
            if not raw.strip():
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError as exc:
                unreadable.append({"line": n, "raw": raw,
                                   "reason": "not JSON: %s" % exc})
                continue
            if not isinstance(obj, dict):
                unreadable.append({"line": n, "raw": raw,
                                   "reason": "JSON line is not an object"})
                continue
            ev, why = _coerce_event(
                obj.get("model"), obj.get("input_tokens"),
                obj.get("output_tokens"), obj.get("cached_input_tokens", 0),
                obj.get("timestamp"))
            if ev is None:
                unreadable.append({"line": n, "raw": raw, "reason": why})
            else:
                events.append(ev)
    return UsageEvidence(TIER_REQUEST_LOG, source=path,
                         events=events, unreadable=unreadable)
