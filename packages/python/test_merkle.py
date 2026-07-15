"""Tests for RFC 6962 Merkle batching."""
import hashlib

import pytest

from nobulex.merkle import (
    MerkleBatch,
    verify_inclusion,
    leaf_hash,
    node_hash,
    anchoring_cost,
)


def refs(n, prefix="action"):
    return [hashlib.sha256(f"{prefix}-{i}".encode()).hexdigest() for i in range(n)]


# --- RFC 6962 structural conformance ---

def test_empty_tree_is_sha256_of_empty():
    assert MerkleBatch().root() == hashlib.sha256(b"").hexdigest()


def test_single_leaf_root_is_leaf_hash():
    r = refs(1)
    assert MerkleBatch(r).root() == leaf_hash(r[0])


def test_domain_separation_leaf_vs_node():
    """0x00 leaf prefix and 0x01 node prefix must differ (2nd-preimage defense)."""
    a, b = "aa" * 32, "bb" * 32
    assert leaf_hash(a) != node_hash(a, b)


def test_three_leaf_split_follows_rfc6962():
    """n=3 must split at k=2: node(node(L0,L1), L2), not node(L0, node(L1,L2))."""
    r = refs(3)
    expected = node_hash(
        node_hash(leaf_hash(r[0]), leaf_hash(r[1])), leaf_hash(r[2])
    )
    naive = node_hash(
        leaf_hash(r[0]), node_hash(leaf_hash(r[1]), leaf_hash(r[2]))
    )
    assert MerkleBatch(r).root() == expected
    assert MerkleBatch(r).root() != naive


def test_root_is_deterministic():
    r = refs(500)
    assert MerkleBatch(r).root() == MerkleBatch(r).root()


def test_order_matters():
    r = refs(10)
    assert MerkleBatch(r).root() != MerkleBatch(list(reversed(r))).root()


# --- inclusion proofs ---

@pytest.mark.parametrize("n", list(range(1, 34)) + [64, 100, 1000])
def test_every_leaf_verifies_at_size(n):
    r = refs(n)
    b = MerkleBatch(r)
    root = b.root()
    for i in range(n):
        assert verify_inclusion(r[i], i, n, b.inclusion_proof(i), root)


def test_proof_size_is_logarithmic():
    b = MerkleBatch(refs(10_000))
    assert len(b.inclusion_proof(0)) <= 14


# --- tamper detection (the entire point) ---

def test_tampered_action_ref_rejected():
    r = refs(1000)
    b = MerkleBatch(r)
    evil = hashlib.sha256(b"evil").hexdigest()
    assert not verify_inclusion(evil, 500, 1000, b.inclusion_proof(500), b.root())


def test_wrong_index_rejected():
    r = refs(1000)
    b = MerkleBatch(r)
    assert not verify_inclusion(r[500], 501, 1000, b.inclusion_proof(500), b.root())


def test_wrong_root_rejected():
    r = refs(1000)
    b = MerkleBatch(r)
    assert not verify_inclusion(
        r[500], 500, 1000, b.inclusion_proof(500), "00" * 32
    )


def test_truncated_proof_rejected():
    r = refs(1000)
    b = MerkleBatch(r)
    assert not verify_inclusion(
        r[500], 500, 1000, b.inclusion_proof(500)[:-1], b.root()
    )


def test_index_out_of_range_rejected():
    r = refs(10)
    b = MerkleBatch(r)
    assert not verify_inclusion(r[0], 10, 10, [], b.root())
    assert not verify_inclusion(r[0], -1, 10, [], b.root())


def test_proof_from_other_batch_rejected():
    """A valid proof from a different batch must not verify here."""
    b1 = MerkleBatch(refs(100, "one"))
    b2 = MerkleBatch(refs(100, "two"))
    r1 = refs(100, "one")
    assert not verify_inclusion(r1[5], 5, 100, b2.inclusion_proof(5), b1.root())


def test_inclusion_proof_index_error():
    b = MerkleBatch(refs(5))
    with pytest.raises(IndexError):
        b.inclusion_proof(5)


# --- economics ---

def test_batching_reduces_anchor_count_by_batch_size():
    c = anchoring_cost(10_000_000, batch_size=10_000)
    assert c["anchors_batched"] == 1_000
    assert c["reduction_factor"] == 10_000
    assert c["cost_batched_usd"] < 1.0
