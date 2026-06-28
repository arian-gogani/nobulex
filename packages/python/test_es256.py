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
