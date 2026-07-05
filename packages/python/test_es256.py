"""Tests for ES256 (ECDSA P-256) signing support."""

from nobulex.crypto import ES256KeyPair, KeyPair, compute_action_ref


def test_es256_keygen():
    kp = ES256KeyPair()
    assert kp.algorithm == "es256"
    assert len(kp.public_bytes) == 65
    assert kp.public_hex.startswith("04")


def test_es256_sign_verify():
    kp = ES256KeyPair()
    data = b"test payload"
    sig = kp.sign(data)
    assert ES256KeyPair.verify_signature(kp.public_bytes, sig, data)


def test_es256_verify_wrong_data():
    kp = ES256KeyPair()
    sig = kp.sign(b"correct")
    assert not ES256KeyPair.verify_signature(kp.public_bytes, sig, b"wrong")


def test_es256_verify_wrong_key():
    kp1 = ES256KeyPair()
    kp2 = ES256KeyPair()
    sig = kp1.sign(b"test")
    assert not ES256KeyPair.verify_signature(kp2.public_bytes, sig, b"test")


def test_es256_sign_hex():
    kp = ES256KeyPair()
    sig_hex = kp.sign_hex(b"hex test")
    sig_bytes = bytes.fromhex(sig_hex)
    assert ES256KeyPair.verify_signature(kp.public_bytes, sig_bytes, b"hex test")


def test_ed25519_backward_compat():
    kp = KeyPair()
    assert kp.algorithm == "ed25519"
    sig = kp.sign(b"backward compat")
    assert KeyPair.verify_signature(kp.public_bytes, sig, b"backward compat")


def test_cross_algorithm_independence():
    ed = KeyPair()
    es = ES256KeyPair()
    data = b"cross-algo"
    assert KeyPair.verify_signature(ed.public_bytes, ed.sign(data), data)
    assert ES256KeyPair.verify_signature(es.public_bytes, es.sign(data), data)


def test_receipt_roundtrip_es256_verifies():
    """Regression: Receipt.verify hardcoded Ed25519, so ES256 receipts were
    unverifiable through the Receipt API (create -> to_dict -> from_dict ->
    verify returned False even with the correct key pinned)."""
    from nobulex import Receipt, ES256KeyPair

    es = ES256KeyPair()
    pub = es.public_hex if isinstance(es.public_hex, str) else es.public_hex()
    r = Receipt.create(
        "agent:t", "file.read", "s:/x", es,
        verdict="ALLOW", timestamp_ms=1751700002000,
    )
    d = Receipt.from_dict(r.to_dict())
    assert d.verify() is True
    assert d.verify(authorized_keys=[pub]) is True

    bad = r.to_dict()
    bad["scope"] = "s:/TAMPERED"
    assert Receipt.from_dict(bad).verify() is False
