"""Merkle batching for receipt anchoring (RFC 6962).

Anchoring every receipt individually is economically impossible: at
~$0.0005/tx on Base, 10M receipts/month costs $5,000/month in gas.

Batching 10,000 receipts into one Merkle root and anchoring only the root
costs $0.0005 for the batch: a 10,000x reduction. Tamper-evidence is
identical. Any individual receipt still proves membership in the anchored
batch with ~log2(n) hashes, verifiable offline, with no call to Nobulex.

This is the same construction Certificate Transparency uses (RFC 6962),
chosen deliberately: the hash structure is already reviewed, already
standard, and already implemented in every language.

    from nobulex.merkle import MerkleBatch, verify_inclusion

    batch = MerkleBatch()
    for receipt in receipts:
        batch.add(receipt.action_ref)

    root = batch.root()             # anchor this, once
    proof = batch.inclusion_proof(0)

    # Any third party, offline, with no Nobulex dependency:
    verify_inclusion(receipts[0].action_ref, 0, batch.size, proof, root)
"""

import hashlib
from typing import List, Optional


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def leaf_hash(action_ref: str) -> str:
    """RFC 6962 leaf hash: SHA-256(0x00 || data).

    The 0x00 prefix domain-separates leaves from internal nodes, which
    prevents second-preimage attacks where a crafted internal node is
    presented as a leaf.
    """
    return _sha256(b"\x00" + action_ref.encode("utf-8"))


def node_hash(left: str, right: str) -> str:
    """RFC 6962 internal node hash: SHA-256(0x01 || left || right)."""
    return _sha256(b"\x01" + bytes.fromhex(left) + bytes.fromhex(right))


def _largest_power_of_two_less_than(n: int) -> int:
    """Largest k such that k is a power of 2 and k < n. Requires n > 1."""
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def _mth(hashes: List[str]) -> str:
    """Merkle Tree Hash over a list of already-leaf-hashed values."""
    n = len(hashes)
    if n == 0:
        return _sha256(b"")
    if n == 1:
        return hashes[0]
    k = _largest_power_of_two_less_than(n)
    return node_hash(_mth(hashes[:k]), _mth(hashes[k:]))


def _path(hashes: List[str], index: int) -> List[str]:
    """Audit path for the leaf at `index` within `hashes`."""
    n = len(hashes)
    if n <= 1:
        return []
    k = _largest_power_of_two_less_than(n)
    if index < k:
        return _path(hashes[:k], index) + [_mth(hashes[k:])]
    return _path(hashes[k:], index - k) + [_mth(hashes[:k])]


class MerkleBatch:
    """An append-only batch of receipts, summarized by one Merkle root.

    Anchor the root. Prove any member with an inclusion proof.
    """

    def __init__(self, action_refs: Optional[List[str]] = None):
        self._leaves: List[str] = []
        self._refs: List[str] = []
        for ref in action_refs or []:
            self.add(ref)

    def add(self, action_ref: str) -> int:
        """Add a receipt's action_ref to the batch. Returns its index."""
        self._refs.append(action_ref)
        self._leaves.append(leaf_hash(action_ref))
        return len(self._leaves) - 1

    @property
    def size(self) -> int:
        return len(self._leaves)

    def root(self) -> str:
        """The Merkle root. This is the only value that needs anchoring."""
        return _mth(self._leaves)

    def inclusion_proof(self, index: int) -> List[str]:
        """Audit path proving the leaf at `index` is in this batch."""
        if index < 0 or index >= self.size:
            raise IndexError(f"index {index} out of range for size {self.size}")
        return _path(self._leaves, index)

    def __repr__(self) -> str:
        return f"MerkleBatch(size={self.size}, root={self.root()[:16]}...)"


def verify_inclusion(
    action_ref: str,
    index: int,
    tree_size: int,
    proof: List[str],
    root: str,
) -> bool:
    """Verify a receipt is in an anchored batch. Offline, no Nobulex needed.

    This is the whole point: a regulator holding one receipt, one proof, and
    the anchored root can confirm membership without trusting the operator,
    the platform, or us. Implements the RFC 6962 audit path algorithm.
    """
    if index >= tree_size or index < 0 or tree_size <= 0:
        return False

    fn = index
    sn = tree_size - 1
    r = leaf_hash(action_ref)

    for p in proof:
        if sn == 0:
            return False
        if (fn & 1) or (fn == sn):
            r = node_hash(p, r)
            while not (fn & 1) and fn != 0:
                fn >>= 1
                sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1

    return sn == 0 and r == root


def anchoring_cost(receipt_count: int, batch_size: int = 10_000,
                   cost_per_anchor: float = 0.0005) -> dict:
    """Cost of anchoring individually vs batched. Sanity-check the economics."""
    individual = receipt_count * cost_per_anchor
    batches = (receipt_count + batch_size - 1) // batch_size
    batched = batches * cost_per_anchor
    return {
        "receipts": receipt_count,
        "batch_size": batch_size,
        "anchors_individual": receipt_count,
        "anchors_batched": batches,
        "cost_individual_usd": round(individual, 4),
        "cost_batched_usd": round(batched, 4),
        "savings_usd": round(individual - batched, 4),
        "reduction_factor": round(individual / batched, 1) if batched else 0,
        "proof_size_hashes": max(1, (batch_size - 1).bit_length()),
    }
