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

    def verify(self) -> bool:
        """Verify the entire chain is intact."""
        if not self._chain:
            return True

        for i, entry in enumerate(self._chain):
            # Verify receipt signature
            if not entry["receipt"].verify():
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
                    "action_type": e["receipt"].action_type,
                    "scope": e["receipt"].scope,
                    "verdict": e["receipt"].verdict,
                    "action_ref": e["receipt"].action_ref,
                    "timestamp_ms": e["receipt"].timestamp_ms,
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


def verify_audit_trail(filepath: str) -> dict:
    """Verify an exported audit trail JSON file.
    
    Checks hash chain integrity (prev_hash linkage).
    Returns a verification report.
    """
    import json
    import hashlib
    
    with open(filepath) as f:
        data = json.load(f)
    
    entries = data.get("entries", [])
    results = []
    all_valid = True
    prev = "0" * 64
    
    for entry in entries:
        # Verify chain linkage
        chain_ok = entry.get("prev_hash") == prev
        if not chain_ok:
            all_valid = False
        
        results.append({
            "index": entry.get("index", len(results)),
            "action_type": entry.get("action_type", ""),
            "verdict": entry.get("verdict", ""),
            "action_ref": entry.get("action_ref", "")[:32] + "...",
            "chain_valid": chain_ok,
        })
        prev = entry.get("chain_hash", "")
    
    return {
        "file": filepath,
        "total_receipts": len(results),
        "chain_intact": all_valid,
        "head_hash": data.get("head_hash", ""),
        "receipts": results,
    }
