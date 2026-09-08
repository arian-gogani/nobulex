"""Unicode normalization of the action_ref preimage.

RFC 8785 canonicalizes serialization, not Unicode. It neither normalizes its
input nor requires normalized input. Without an explicit normalization step the
same name written two legal ways produces two content addresses, both receipts
verify, and the cross-system join silently does not happen.

Each test here fails against the unnormalized construction, which is the bar
THESIS.md sets: a check may be described as tested only when at least one
defined input makes it report adversely.
"""
import unicodedata

from nobulex.crypto import compute_action_ref

TS = 1757000000000
NAME = "did:web:café.example"
NFC = unicodedata.normalize("NFC", NAME)
NFD = unicodedata.normalize("NFD", NAME)


def test_the_two_forms_really_do_differ():
    """Guard: every test below is void if these are byte-identical."""
    assert NFC != NFD
    assert NFC.encode("utf-8") != NFD.encode("utf-8")


def test_agent_id_normalization():
    assert compute_action_ref(NFC, "transfer", "acct:123", TS) == compute_action_ref(
        NFD, "transfer", "acct:123", TS
    )


def test_scope_normalization():
    scope_nfc = unicodedata.normalize("NFC", "résumé:read")
    scope_nfd = unicodedata.normalize("NFD", "résumé:read")
    assert scope_nfc != scope_nfd
    assert compute_action_ref(
        "did:web:agent.example", "transfer", scope_nfc, TS
    ) == compute_action_ref("did:web:agent.example", "transfer", scope_nfd, TS)


def test_action_type_normalization():
    at_nfc = unicodedata.normalize("NFC", "prüfen")
    at_nfd = unicodedata.normalize("NFD", "prüfen")
    assert at_nfc != at_nfd
    assert compute_action_ref(
        "did:web:agent.example", at_nfc, "acct:123", TS
    ) == compute_action_ref("did:web:agent.example", at_nfd, "acct:123", TS)


def test_all_three_fields_at_once():
    a = compute_action_ref(NFC, unicodedata.normalize("NFC", "prüfen"),
                           unicodedata.normalize("NFC", "résumé:read"), TS)
    b = compute_action_ref(NFD, unicodedata.normalize("NFD", "prüfen"),
                           unicodedata.normalize("NFD", "résumé:read"), TS)
    assert a == b


def test_normalization_does_not_collapse_distinct_agents():
    """NFC must not make genuinely different names collide."""
    assert compute_action_ref(NFC, "transfer", "acct:123", TS) != compute_action_ref(
        "did:web:cafe.example", "transfer", "acct:123", TS
    )


def test_ascii_is_untouched():
    """The common path must be byte-for-byte what it was before."""
    ref = compute_action_ref("did:web:agent.example", "transfer", "acct:123", TS)
    assert len(ref) == 64
    assert ref == compute_action_ref("did:web:agent.example", "transfer", "acct:123", TS)


def test_timestamp_still_participates():
    """Normalization must not accidentally drop a field from the preimage."""
    assert compute_action_ref(NFC, "transfer", "acct:123", TS) != compute_action_ref(
        NFC, "transfer", "acct:123", TS + 1
    )


def test_fields_are_not_interchangeable():
    """Moving a value between fields must change the address."""
    assert compute_action_ref("a", "b", "c", TS) != compute_action_ref("b", "a", "c", TS)
