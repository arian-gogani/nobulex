"""Dated, source-cited price sheet loading and lookup.

A price sheet is a JSON document (see pricesheets/openai-2026-10.json) with:

  schema          "invoice-recompute/pricesheet-v1"
  vendor          vendor slug, e.g. "openai"
  sheet_id        stable identifier, e.g. "openai-2026-10"
  fixture         bool. True means the prices are synthetic test values and
                  the sheet must never be used against a real invoice. The
                  engine refuses fixture sheets unless explicitly allowed.
  currency        ISO currency code the rates are stated in
  unit            "usd_per_1m_tokens" is the only unit this version rates
  service_tier    the single service tier the rates apply to
  retrieved       YYYY-MM-DD retrieval date of the source page
  source_url      exact URL the rates were read from
  caveats         list of sheet-level limits, printed into every report
  models          model name -> {input_per_1m, cached_input_per_1m,
                  output_per_1m, table}. A null rate means the source printed
                  no rate for that component; usage billed against a null
                  rate is INDETERMINATE, never rated at zero.
  unencodable     model name -> reason string. Models the source publishes
                  but whose rates could not be read unambiguously. Lines for
                  these models are NOT_EVALUATED with the reason attached.

Discipline: a model absent from both maps is simply absent; the engine
reports it NOT_EVALUATED ("model absent from price sheet"). Nothing in this
module ever invents a rate.
"""

import datetime
import json

SCHEMA = "invoice-recompute/pricesheet-v1"

# Lookup outcomes. These are not verdicts; recompute.py turns them into
# verdicts. They exist so the reason for a non-answer is never dropped.
ENCODED = "ENCODED"
UNENCODABLE = "UNENCODABLE"
ABSENT = "ABSENT"

_RATE_KEYS = ("input_per_1m", "cached_input_per_1m", "output_per_1m")


class PriceSheetError(ValueError):
    pass


class PriceSheet:
    def __init__(self, doc, path=None):
        self.doc = doc
        self.path = path
        _validate(doc, path)

    @property
    def fixture(self):
        return bool(self.doc.get("fixture", False))

    @property
    def sheet_id(self):
        return self.doc["sheet_id"]

    @property
    def service_tier(self):
        return self.doc["service_tier"]

    @property
    def retrieved(self):
        return self.doc["retrieved"]

    @property
    def source_url(self):
        return self.doc["source_url"]

    @property
    def caveats(self):
        return list(self.doc.get("caveats", []))

    @property
    def valid_from(self):
        v = self.doc.get("valid_from")
        return v if v else None

    @property
    def valid_to(self):
        v = self.doc.get("valid_to")
        return v if v else None

    def coverage(self, timestamp_raw):
        """Return (status, reason) for one usage timestamp against the sheet
        validity window.

        UNKNOWN_NO_WINDOW     the sheet declares no window, so a rate change
                              inside the usage period cannot be excluded.
        UNKNOWN_UNPARSEABLE   the usage record carries no parseable timestamp.
        OUT                   the usage date falls outside the window.
        IN                    the usage date falls inside the window.
        """
        vf = self.valid_from
        vt = self.valid_to
        if vf is None or vt is None:
            return ("UNKNOWN_NO_WINDOW",
                    "price sheet declares no validity window, so a rate "
                    "change inside the usage period cannot be excluded")
        d = _parse_usage_date(timestamp_raw)
        if d is None:
            return ("UNKNOWN_UNPARSEABLE",
                    "usage record carries no parseable timestamp; cannot "
                    "confirm it falls within the sheet validity window")
        vf_d = datetime.date.fromisoformat(vf)
        vt_d = datetime.date.fromisoformat(vt)
        if d < vf_d or d > vt_d:
            return ("OUT",
                    "usage dated %s falls outside the price sheet validity "
                    "window %s..%s" % (d.isoformat(), vf, vt))
        return ("IN", None)

    def on_window_edge(self, timestamp_raw):
        """True if the usage date equals valid_from or valid_to.

        Window membership is compared date-only (see coverage), so an event
        on the first or last day of the window is the only case a billing
        timezone offset of less than a day could push into the adjacent
        billing period. No timezone math is attempted; this flags the event
        so the verdict can carry a date-granularity caveat. Returns False
        when the sheet declares no window or the timestamp will not parse.
        """
        vf = self.valid_from
        vt = self.valid_to
        if vf is None or vt is None:
            return False
        d = _parse_usage_date(timestamp_raw)
        if d is None:
            return False
        return d.isoformat() == vf or d.isoformat() == vt

    def lookup(self, model):
        """Return (status, rates_or_reason).

        ENCODED      -> (ENCODED, {input_per_1m, cached_input_per_1m,
                                   output_per_1m})
        UNENCODABLE  -> (UNENCODABLE, reason string from the sheet)
        ABSENT       -> (ABSENT, None)
        """
        models = self.doc.get("models", {})
        if model in models:
            entry = models[model]
            return ENCODED, {k: entry.get(k) for k in _RATE_KEYS}
        unenc = self.doc.get("unencodable", {})
        if model in unenc:
            return UNENCODABLE, unenc[model]
        return ABSENT, None

    def rate_for(self, model, usage_type):
        """Rate in currency units per 1M tokens for one usage type, or a
        (status, reason) explanation when no numeric rate exists.

        Returns (rate_float, None) on success, (None, reason) otherwise.
        """
        status, data = self.lookup(model)
        if status == ABSENT:
            return None, "model absent from price sheet"
        if status == UNENCODABLE:
            return None, "price UNENCODABLE: " + data
        key = {
            "input": "input_per_1m",
            "cached_input": "cached_input_per_1m",
            "output": "output_per_1m",
        }.get(usage_type)
        if key is None:
            return None, "unknown usage type %r" % (usage_type,)
        rate = data.get(key)
        if rate is None:
            return None, ("sheet prints no %s rate for this model; "
                          "billed %s usage cannot be rated" %
                          (usage_type, usage_type))
        return float(rate), None


def _validate(doc, path):
    where = path or "<in-memory sheet>"
    if doc.get("schema") != SCHEMA:
        raise PriceSheetError(
            "%s: schema is %r, expected %r" % (where, doc.get("schema"),
                                               SCHEMA))
    for field in ("vendor", "sheet_id", "currency", "unit", "service_tier",
                  "retrieved", "source_url"):
        if not doc.get(field):
            raise PriceSheetError("%s: missing required field %r"
                                  % (where, field))
    if doc["unit"] != "usd_per_1m_tokens":
        raise PriceSheetError(
            "%s: unit %r is not rateable by this version"
            % (where, doc["unit"]))
    if "fixture" not in doc:
        raise PriceSheetError(
            "%s: fixture flag must be stated explicitly, true or false"
            % where)
    models = doc.get("models")
    if not isinstance(models, dict):
        raise PriceSheetError("%s: models must be an object" % where)
    for name, entry in models.items():
        for k in _RATE_KEYS:
            if k not in entry:
                raise PriceSheetError(
                    "%s: model %r lacks %r (use null for 'not printed', "
                    "never omit)" % (where, name, k))
            v = entry[k]
            if v is not None and (not isinstance(v, (int, float))
                                  or isinstance(v, bool) or v < 0):
                raise PriceSheetError(
                    "%s: model %r has non-numeric or negative %s: %r"
                    % (where, name, k, v))
    vf = doc.get("valid_from")
    vt = doc.get("valid_to")
    vf_present = isinstance(vf, str) and vf.strip()
    vt_present = isinstance(vt, str) and vt.strip()
    if vf_present or vt_present:
        if not (vf_present and vt_present):
            raise PriceSheetError(
                "%s: valid_from and valid_to must both be set or both "
                "null; one alone does not define a window" % where)
        try:
            vf_d = datetime.date.fromisoformat(vf)
            vt_d = datetime.date.fromisoformat(vt)
        except ValueError as exc:
            raise PriceSheetError(
                "%s: valid_from/valid_to must be YYYY-MM-DD dates: %s"
                % (where, exc))
        if vf_d > vt_d:
            raise PriceSheetError(
                "%s: valid_from %s is after valid_to %s" % (where, vf, vt))

    unenc = doc.get("unencodable", {})
    if not isinstance(unenc, dict):
        raise PriceSheetError("%s: unencodable must be an object" % where)
    for name, reason in unenc.items():
        if name in models:
            raise PriceSheetError(
                "%s: %r is both encoded and unencodable" % (where, name))
        if not isinstance(reason, str) or not reason.strip():
            raise PriceSheetError(
                "%s: unencodable %r needs a non-empty reason" % (where, name))


def _parse_usage_date(timestamp_raw):
    """Parse a usage timestamp to a date, or None if unparseable.

    Accepts "YYYY-MM-DD" and ISO forms like "2026-10-01T10:00:00Z": strip a
    trailing Z, try datetime.fromisoformat (via '+00:00') then fall back to
    date.fromisoformat on the first 10 characters.
    """
    if timestamp_raw is None:
        return None
    s = str(timestamp_raw).strip()
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(
            s.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    try:
        return datetime.date.fromisoformat(s[:10])
    except ValueError:
        return None


def load_pricesheet(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return PriceSheet(doc, path=path)
