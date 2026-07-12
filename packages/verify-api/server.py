"""
Nobulex Verify API — hosted receipt verification service.

This is the thing that makes money. The SDK is free and open.
The verification layer is the paid product.

Endpoints:
  POST /verify           — verify a single receipt
  POST /verify/chain     — verify a receipt chain (integrity + order)
  POST /verify/bundle    — verify a bundle and return compliance report
  GET  /health           — health check
  GET  /agent/:id/score  — get an agent's trust score from verified receipts

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

    # Simple scoring: base + allow bonus - deny penalty, capped
    score = min(100, max(0, 50 + (allow_count * 5) - (deny_count * 10)))

    return jsonify({
        "agent_id": agent_id,
        "score": score,
        "grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D" if score >= 20 else "F",
        "receipts_verified": total,
        "allow_count": allow_count,
        "deny_count": deny_count,
    })


if __name__ == "__main__":
    print("Nobulex Verify API")
    print("  POST /verify         - verify a single receipt")
    print("  POST /verify/chain   - verify a receipt chain")
    print("  GET  /agent/:id/score - agent trust score")
    print("  GET  /health         - health check")
    print()
    app.run(host="127.0.0.1", port=7749, debug=True)
