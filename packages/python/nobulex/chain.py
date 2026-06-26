"""Receipt chain for tamper-evident audit trails.

Links receipts together with hash pointers so tampering
with any single receipt breaks the entire chain.

    from nobulex.chain import ReceiptChain

    chain = ReceiptChain(agent_id="my-agent")
    chain.append("send_email", scope="user@example.com")
    chain.append("api_call", scope="stripe.com")
    
    assert chain.verify()  # Verify entire chain
    
    # Export the audit trail
    chain.export("audit-trail.json")
"""

import json
from typing import List, Optional
from nobulex.agent import Agent
from nobulex.receipt import Receipt
from nobulex.crypto import sha256_hex, jcs_canonicalize


class ReceiptChain:
    """
    A hash-linked chain of receipts.
    Tampering with any receipt breaks the chain.
    """

    def __init__(self, agent_id: str = "chain-agent"):
        self.agent = Agent(agent_id)
        self._chain: List[dict] = []

    @property
    def length(self) -> int:
        return len(self._chain)

    @property
    def head_hash(self) -> Optional[str]:
        if not self._chain:
            return None
        return self._chain[-1]["chain_hash"]

    def append(
        self,
        action_type: str,
        scope: str,
        verdict: str = "ALLOW",
        metadata: Optional[dict] = None,
    ) -> Receipt:
        """Add an action to the chain."""
        if verdict == "ALLOW":
            receipt = self.agent.act(action_type, scope=scope, metadata=metadata)
        else:
            receipt = self.agent.deny(action_type, scope=scope, metadata=metadata)

        # Compute chain hash: SHA-256(prev_hash + receipt.action_ref)
        prev_hash = self.head_hash or "0" * 64
        chain_input = prev_hash + receipt.action_ref
        chain_hash = sha256_hex(chain_input)

        self._chain.append({
            "index": len(self._chain),
            "receipt": receipt,
            "prev_hash": prev_hash,
            "chain_hash": chain_hash,
        })
        return receipt

    def verify(self, authorized_keys=None) -> bool:
        """Verify the entire chain is intact.

        If authorized_keys is supplied, each receipt's signature is verified
        against those pinned keys (trust-root check). Without it, only signature
        self-consistency and hash-chain linkage are checked.
        """
        if not self._chain:
            return True

        for i, entry in enumerate(self._chain):
            # Verify receipt signature
            if not entry["receipt"].verify(authorized_keys):
                return False

            # Verify chain hash
            prev = self._chain[i - 1]["chain_hash"] if i > 0 else "0" * 64
            expected = sha256_hex(prev + entry["receipt"].action_ref)
            if entry["chain_hash"] != expected:
                return False

        return True

    def export(self, filepath: str) -> None:
        """Export the chain as a JSON audit trail."""
        data = {
            "agent_id": self.agent.agent_id,
            "chain_length": len(self._chain),
            "head_hash": self.head_hash,
            "verified": self.verify(),
            "entries": [
                {
                    "index": e["index"],
                    "receipt": e["receipt"].to_dict(),
                    "prev_hash": e["prev_hash"],
                    "chain_hash": e["chain_hash"],
                }
                for e in self._chain
            ],
        }
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    def __repr__(self) -> str:
        v = "verified" if self.verify() else "BROKEN"
        return f"ReceiptChain(agent={self.agent.agent_id!r}, length={self.length}, status={v})"


def verify_audit_trail(filepath: str, authorized_keys=None) -> dict:
    """Verify an exported audit trail JSON file offline.

    Performs full verification from the bytes alone:
      - reconstructs each receipt,
      - verifies its Ed25519 signature against an AUTHORIZED key (not the key
        embedded in the receipt),
      - recomputes action_ref from the receipt fields,
      - recomputes the hash-chain linkage, never trusting the self-reported
        chain_hash.

    Without authorized_keys, signer authority cannot be established, so the
    trail is reported as not authenticated (fail closed): chain_intact is False.

    Args:
        filepath: path to the exported audit trail JSON.
        authorized_keys: hex public key, or list of hex public keys, authorized
            to sign for this agent. Required to authenticate the trail.
    """
    import json
    from nobulex.receipt import Receipt
    from nobulex.crypto import sha256_hex, compute_action_ref, KeyPair

    if isinstance(authorized_keys, str):
        authorized = {authorized_keys}
    elif authorized_keys:
        authorized = set(authorized_keys)
    else:
        authorized = set()

    with open(filepath) as f:
        data = json.load(f)

    entries = data.get("entries", [])
    results = []
    all_valid = True
    prev = "0" * 64

    for raw in entries:
        reasons = []
        rdict = raw.get("receipt")
        receipt = Receipt.from_dict(rdict) if rdict else None

        # 1. Signature authority: verify against a pinned authorized key, never
        #    the key carried inside the receipt.
        sig_ok = False
        if receipt is None:
            reasons.append("missing receipt (legacy export without signature)")
        elif not authorized:
            reasons.append("no trust anchor supplied; signature unauthenticated")
        elif receipt.signer_public_key not in authorized:
            reasons.append("signer key is not authorized")
        elif not receipt.signature:
            reasons.append("receipt is unsigned")
        else:
            try:
                sig_ok = KeyPair.verify_signature(
                    bytes.fromhex(receipt.signer_public_key),
                    bytes.fromhex(receipt.signature),
                    receipt.to_canonical().encode("utf-8"),
                )
            except Exception:
                sig_ok = False
            if not sig_ok:
                reasons.append("signature does not verify under authorized key")

        # 2. action_ref must match its own fields (catch fabricated refs).
        if receipt is not None:
            expected_ref = compute_action_ref(
                receipt.agent_id,
                receipt.action_type,
                receipt.scope,
                receipt.timestamp_ms,
            )
            if receipt.action_ref != expected_ref:
                reasons.append("action_ref does not match its fields")
            ref_for_chain = receipt.action_ref
        else:
            ref_for_chain = raw.get("action_ref", "")

        # 3. Chain linkage: recompute, never trust the self-reported chain_hash.
        prev_ok = raw.get("prev_hash") == prev
        expected_chain = sha256_hex(prev + ref_for_chain)
        chain_ok = prev_ok and raw.get("chain_hash") == expected_chain
        if not prev_ok:
            reasons.append("prev_hash does not link to previous entry")
        elif raw.get("chain_hash") != expected_chain:
            reasons.append("chain_hash does not match recomputed value")

        entry_ok = sig_ok and chain_ok and not any(
            r.startswith("action_ref") for r in reasons
        )
        if not entry_ok:
            all_valid = False

        results.append({
            "index": raw.get("index", len(results)),
            "action_type": getattr(receipt, "action_type", ""),
            "verdict": getattr(receipt, "verdict", ""),
            "signature_valid": sig_ok,
            "chain_valid": chain_ok,
            "entry_valid": entry_ok,
            "reasons": reasons,
        })
        # Advance using the RECOMPUTED hash, not the self-reported one.
        prev = expected_chain

    return {
        "file": filepath,
        "total_receipts": len(results),
        "chain_intact": all_valid,
        "authenticated": bool(authorized) and all_valid,
        "head_hash": data.get("head_hash", ""),
        "receipts": results,
    }
