#!/usr/bin/env python3
"""Fictional hash-chain examples, not a production verifier or signature test."""
import hashlib
import json
from copy import deepcopy


def digest(event, previous):
    # This example fixes its JSON encoding. It is not an RFC 8785 implementation.
    data = json.dumps({"event": event, "previous": previous},
                      sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode()).hexdigest()


def chain(events):
    records = []
    previous = None
    for event in events:
        value = digest(event, previous)
        records.append({"event": event, "previous": previous, "hash": value})
        previous = value
    return records


def consistent(records):
    if not records:
        return False  # Nothing supplied is not successful verification.
    previous = None
    for record in records:
        if record["previous"] != previous:
            return False
        if record["hash"] != digest(record["event"], previous):
            return False
        previous = record["hash"]
    return True


def matches_checkpoint(records, checkpoint):
    if checkpoint is None:
        return None  # No retained reference: the comparison did not happen.
    return consistent(records) and records[-1]["hash"] == checkpoint


def scenarios():
    original = chain(["request", "authorize", "execute"])
    retained_head = original[-1]["hash"]
    edited = deepcopy(original)
    edited[1]["event"] = "different authorization"
    omitted_before_recording = chain(["request", "execute"])
    return [
        ("Original sequence", original, retained_head, (True, True)),
        ("Edited content, hashes unchanged", edited, retained_head, (False, False)),
        ("Interior entry removed", [original[0], original[2]], retained_head, (False, False)),
        ("Tail removed", original[:-1], retained_head, (True, False)),
        ("Replacement history relinked", chain(["request", "different execution"]), retained_head, (True, False)),
        ("No records supplied", [], retained_head, (False, False)),
        ("No retained checkpoint", original, None, (True, None)),
        ("Event omitted before recording", omitted_before_recording,
         omitted_before_recording[-1]["hash"], (True, True)),
    ]


def main():
    failed = 0
    print("Fictional inputs. No network, signature verification, or live financial action.")
    print("checkpoint_match=None means comparison unavailable, not success.\n")
    for label, records, checkpoint, expected in scenarios():
        actual = consistent(records), matches_checkpoint(records, checkpoint)
        print(f"{label}: links={actual[0]}, checkpoint_match={actual[1]}")
        if actual != expected:
            failed += 1
            print(f"  FAILED: expected {expected}, got {actual}")
    print(f"\n{8-failed}/8 expected outcomes reproduced.")
    print("A matching checkpoint does not establish that every real event was recorded.")
    return int(failed != 0)


if __name__ == "__main__":
    raise SystemExit(main())
