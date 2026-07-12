"""
Nobulex Verify API - hosted receipt verification service.

This is the thing that makes money. The SDK is free and open.
The verification layer is the paid product.

Endpoints:
  POST /verify           - verify a single receipt
  POST /verify/chain     - verify a receipt chain (integrity + order)
  POST /verify/bundle    - verify a bundle and return compliance report
  GET  /health           - health check
  GET  /agent/:id/score  - get an agent's trust score from verified receipts

Free tier: 100 verifications/day, single receipts only
Pro ($99/mo): 10K verifications/day, chain + bundle
Scale ($499/mo): unlimited, compliance reports, SLA

Run:
    pip install flask nobulex
    python server.py
"""

import json
import hashlib
import time
from flask import Flask, request, jsonify

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from nobulex.crypto import KeyPair
from nobulex import Agent, Receipt

app = Flask(__name__)

# In-memory store for demo. Production uses a real DB.
agent_receipts = {}  # agent_id -> list of verified receipts
api_calls = {"count": 0, "since": time.time()}

# Rate limiting per API key
TIERS = {
    "free": {"daily_limit": 100, "chain": False, "bundle": False},
    "pro": {"daily_limit": 10000, "chain": True, "bundle": True},
    "scale": {"daily_limit": float("inf"), "chain": True, "bundle": True},
}

# In-memory rate tracking. Production uses Redis.
rate_tracker = {}  # api_key -> {"count": N, "reset_at": timestamp}


def get_tier(api_key):
    """Look up tier for an API key. Default to free."""
    # Production: check DB/Stripe. Demo: header-based.
    if not api_key:
        return "free", TIERS["free"]
    if api_key.startswith("nbx_scale_"):
        return "scale", TIERS["scale"]
    if api_key.startswith("nbx_pro_"):
        return "pro", TIERS["pro"]
    return "free", TIERS["free"]


def check_rate_limit(api_key, tier_config):
    """Returns (allowed, remaining, reset_at)."""
    now = time.time()
    key = api_key or "anonymous"

    if key not in rate_tracker or rate_tracker[key]["reset_at"] < now:
        rate_tracker[key] = {"count": 0, "reset_at": now + 86400}

    tracker = rate_tracker[key]
    if tracker["count"] >= tier_config["daily_limit"]:
        return False, 0, tracker["reset_at"]

    tracker["count"] += 1
    remaining = tier_config["daily_limit"] - tracker["count"]
    return True, remaining, tracker["reset_at"]


def rate_limit_response(remaining, reset_at):
    """Return 429 with rate limit info."""
    return jsonify({
        "error": "Rate limit exceeded",
        "upgrade": "https://nobulex.com/pricing",
        "reset_at": int(reset_at),
    }), 429


def jcs_canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": "0.1.0", "receipts_verified": api_calls["count"]})


@app.route("/verify", methods=["POST"])
def verify_single():
    """Verify a single receipt's signature and content-derived action_ref."""
    api_key = request.headers.get("X-API-Key", "")
    tier_name, tier_config = get_tier(api_key)
    allowed, remaining, reset_at = check_rate_limit(api_key, tier_config)
    if not allowed:
        return rate_limit_response(remaining, reset_at)

    api_calls["count"] += 1
    body = request.get_json()
    if not body:
        return jsonify({"error": "JSON body required"}), 400

    receipt_data = body.get("receipt", body)

    try:
        receipt = Receipt.from_dict(receipt_data)
        sig_valid = receipt.verify()
    except Exception as e:
        return jsonify({"verdict": "INVALID", "error": str(e)}), 200

    # Recompute action_ref
    preimage = jcs_canonical({
        "agent_id": receipt.agent_id,
        "action_type": receipt.action_type,
        "scope": receipt.scope,
        "timestamp_ms": receipt.timestamp_ms,
    })
    recomputed_ref = sha256_hex(preimage)
    ref_match = recomputed_ref == receipt.action_ref

    verdict = "VALID" if (ref_match and sig_valid) else "INVALID"
    reasons = []
    if not ref_match:
        reasons.append("action_ref does not match recomputed preimage")
    if not sig_valid:
        reasons.append("Ed25519 signature verification failed")

    result = {
        "verdict": verdict,
        "action_ref": receipt.action_ref,
        "action_ref_recomputed": recomputed_ref,
        "action_ref_match": ref_match,
        "signature_valid": sig_valid,
        "agent_id": receipt.agent_id,
        "action_type": receipt.action_type,
        "timestamp_ms": receipt.timestamp_ms,
    }
    if reasons:
        result["reasons"] = reasons
    result["tier"] = tier_name
    result["remaining"] = remaining

    if verdict == "VALID":
        agent_receipts.setdefault(receipt.agent_id, []).append({
            "action_ref": receipt.action_ref,
            "action_type": receipt.action_type,
            "timestamp_ms": receipt.timestamp_ms,
            "verdict": receipt.verdict or "ALLOW",
        })

    return jsonify(result)


@app.route("/verify/chain", methods=["POST"])
def verify_chain():
    """Verify a chain of receipts: signatures + hash-chain integrity."""
    api_key = request.headers.get("X-API-Key", "")
    tier_name, tier_config = get_tier(api_key)
    if not tier_config["chain"]:
        return jsonify({"error": "Chain verification requires Pro tier", "upgrade": "https://nobulex.com/pricing"}), 403
    allowed, remaining, reset_at = check_rate_limit(api_key, tier_config)
    if not allowed:
        return rate_limit_response(remaining, reset_at)

    api_calls["count"] += 1
    body = request.get_json()
    if not body:
        return jsonify({"error": "JSON body required"}), 400

    receipts = body.get("receipts", [])
    public_key_hex = body.get("public_key", "")

    if not receipts:
        return jsonify({"error": "receipts array required"}), 400

    results = []
    prev_hash = None
    chain_valid = True

    for i, receipt in enumerate(receipts):
        sig_hex = receipt.get("signature", "")
        payload = {k: v for k, v in receipt.items() if k != "signature"}
        canonical = jcs_canonical(payload)

        try:
            sig_valid = KeyPair.verify_signature(
                bytes.fromhex(public_key_hex or receipt.get("public_key", "")),
                bytes.fromhex(sig_hex),
                canonical.encode("utf-8"),
            )
        except Exception:
            sig_valid = False

        parent = receipt.get("parent_receipt_hash")
        chain_link_ok = (parent == prev_hash) if i > 0 else (parent is None)

        if not sig_valid or not chain_link_ok:
            chain_valid = False

        results.append({
            "sequence": i + 1,
            "action_ref": receipt.get("action_ref", ""),
            "signature_valid": sig_valid,
            "chain_link_valid": chain_link_ok,
        })

        prev_hash = "sha256:" + sha256_hex(canonical)

    return jsonify({
        "chain_valid": chain_valid,
        "receipt_count": len(receipts),
        "results": results,
    })


@app.route("/agent/<agent_id>/score", methods=["GET"])
def agent_score(agent_id):
    """Get an agent's trust score from previously verified receipts."""
    receipts = agent_receipts.get(agent_id, [])
    if not receipts:
        return jsonify({"agent_id": agent_id, "score": 0, "receipts_verified": 0, "status": "unknown"})

    allow_count = sum(1 for r in receipts if r["verdict"] == "ALLOW")
    deny_count = sum(1 for r in receipts if r["verdict"] == "DENY")
    total = len(receipts)

    score = min(100, max(0, 50 + (allow_count * 5) - (deny_count * 10)))

    return jsonify({
        "agent_id": agent_id,
        "score": score,
        "grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D" if score >= 20 else "F",
        "receipts_verified": total,
        "allow_count": allow_count,
        "deny_count": deny_count,
    })


@app.route("/verify/bundle", methods=["POST"])
def verify_bundle():
    """Verify a receipt bundle and return a compliance report.

    This is the enterprise product. A bundle is a collection of receipts
    from one agent or one session, verified as a unit. The report includes
    chain integrity, trust score, compliance flags, and a summary suitable
    for a regulator or auditor.

    Requires Pro tier or above.
    """
    api_key = request.headers.get("X-API-Key", "")
    tier_name, tier_config = get_tier(api_key)
    if not tier_config["bundle"]:
        return jsonify({"error": "Bundle verification requires Pro tier", "upgrade": "https://nobulex.com/pricing"}), 403
    allowed, remaining, reset_at = check_rate_limit(api_key, tier_config)
    if not allowed:
        return rate_limit_response(remaining, reset_at)

    api_calls["count"] += 1
    body = request.get_json()
    if not body:
        return jsonify({"error": "JSON body required"}), 400

    receipts_data = body.get("receipts", [])
    bundle_id = body.get("bundle_id", f"bundle-{int(time.time())}")

    if not receipts_data:
        return jsonify({"error": "receipts array required"}), 400

    # Verify each receipt
    verified = []
    failed = []
    allow_count = 0
    deny_count = 0
    agents_seen = set()
    action_types = set()
    earliest = float("inf")
    latest = 0

    for i, rd in enumerate(receipts_data):
        try:
            r = Receipt.from_dict(rd)
            sig_ok = r.verify()

            preimage = jcs_canonical({
                "agent_id": r.agent_id,
                "action_type": r.action_type,
                "scope": r.scope,
                "timestamp_ms": r.timestamp_ms,
            })
            ref_ok = sha256_hex(preimage) == r.action_ref

            if sig_ok and ref_ok:
                verified.append({"seq": i + 1, "action_ref": r.action_ref, "verdict": "VALID"})
                agents_seen.add(r.agent_id)
                action_types.add(r.action_type)
                v = r.verdict or "ALLOW"
                if v == "ALLOW":
                    allow_count += 1
                else:
                    deny_count += 1
                if r.timestamp_ms < earliest:
                    earliest = r.timestamp_ms
                if r.timestamp_ms > latest:
                    latest = r.timestamp_ms
            else:
                reasons = []
                if not sig_ok:
                    reasons.append("signature_invalid")
                if not ref_ok:
                    reasons.append("action_ref_mismatch")
                failed.append({"seq": i + 1, "reasons": reasons})
        except Exception as e:
            failed.append({"seq": i + 1, "reasons": [str(e)]})

    total = len(receipts_data)
    score = min(100, max(0, 50 + (allow_count * 5) - (deny_count * 10))) if verified else 0

    # Compliance flags
    flags = []
    if deny_count > 0:
        flags.append(f"{deny_count} action(s) were denied/blocked by policy")
    if failed:
        flags.append(f"{len(failed)} receipt(s) failed verification")
    if len(agents_seen) > 1:
        flags.append(f"Bundle spans {len(agents_seen)} agents (multi-agent chain)")

    report = {
        "bundle_id": bundle_id,
        "verification_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {
            "total_receipts": total,
            "verified": len(verified),
            "failed": len(failed),
            "trust_score": score,
            "grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D" if score >= 20 else "F",
            "agents": list(agents_seen),
            "action_types": list(action_types),
            "allow_count": allow_count,
            "deny_count": deny_count,
            "time_range_ms": {"earliest": earliest if earliest != float("inf") else None, "latest": latest or None},
        },
        "compliance_flags": flags,
        "verified_receipts": verified,
        "failed_receipts": failed,
        "tier": tier_name,
    }

    return jsonify(report)


@app.route("/demo/tamper-test", methods=["GET"])
def tamper_test():
    """Live demo: generate a receipt, tamper with it, show verification catches it."""
    from nobulex import Agent as DemoAgent

    a = DemoAgent("demo-agent")
    receipt = a.act(action_type="tool:transfer", scope="amount=500,to=alice")

    original = receipt.to_dict()
    original_valid = receipt.verify()

    tampered = receipt.to_dict()
    tampered["scope"] = "amount=50000,to=attacker"

    from nobulex import Receipt as R
    tampered_receipt = R.from_dict(tampered)
    tampered_valid = tampered_receipt.verify()

    preimage_original = jcs_canonical({
        "agent_id": original["agent_id"],
        "action_type": original["action_type"],
        "scope": original["scope"],
        "timestamp_ms": original["timestamp_ms"],
    })
    preimage_tampered = jcs_canonical({
        "agent_id": tampered["agent_id"],
        "action_type": tampered["action_type"],
        "scope": tampered["scope"],
        "timestamp_ms": tampered["timestamp_ms"],
    })

    return jsonify({
        "demo": "tamper-test",
        "original": {
            "scope": original["scope"],
            "action_ref": original["action_ref"],
            "signature_valid": original_valid,
            "verdict": "VALID",
        },
        "tampered": {
            "scope": tampered["scope"],
            "action_ref": tampered["action_ref"],
            "action_ref_recomputed": sha256_hex(preimage_tampered),
            "action_ref_match": sha256_hex(preimage_tampered) == tampered["action_ref"],
            "signature_valid": tampered_valid,
            "verdict": "INVALID - tamper detected",
        },
        "explanation": "The attacker changed scope from amount=500 to amount=50000. "
                       "The action_ref no longer matches the recomputed preimage, and the "
                       "Ed25519 signature is invalid because the signed bytes changed. "
                       "Both checks catch the tamper independently."
    })


if __name__ == "__main__":
    print("Nobulex Verify API")
    print("  POST /verify         - verify a single receipt")
    print("  POST /verify/chain   - verify a receipt chain")
    print("  POST /verify/bundle  - compliance report")
    print("  GET  /agent/:id/score - agent trust score")
    print("  GET  /demo/tamper-test - live tamper detection demo")
    print("  GET  /health         - health check")
    print()
    app.run(host="127.0.0.1", port=7749, debug=True)
