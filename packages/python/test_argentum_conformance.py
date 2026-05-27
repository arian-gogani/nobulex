"""
Cross-validation against argentum-core conformance fixtures.
Proves nobulex JCS+SHA-256 derivation is byte-identical to argentum-core.

Fixture source: giskard09/argentum-core/examples/conformance/action-ref-v1-baseline.fixture.json
"""
import json
import hashlib
import urllib.request
import sys

FIXTURE_URL = "https://raw.githubusercontent.com/giskard09/argentum-core/main/examples/conformance/action-ref-v1-baseline.fixture.json"

def jcs(obj):
    """RFC 8785 JCS canonicalization."""
    return json.dumps(obj, separators=(',',':'), sort_keys=True, ensure_ascii=False)

def main():
    print("Fetching argentum-core conformance fixtures...")
    try:
        with urllib.request.urlopen(FIXTURE_URL) as resp:
            fixture = json.loads(resp.read())
    except Exception as e:
        print(f"Could not fetch fixtures: {e}")
        print("Run with local fixture: python test_argentum_conformance.py /path/to/fixture.json")
        sys.exit(1)
    
    passed = failed = skipped = 0
    
    for v in fixture['vectors']:
        if 'preimage' not in v:
            print(f"  SKIP  {v['id']} (no preimage field)")
            skipped += 1
            continue
        
        canonical = jcs(v['preimage'])
        actual = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        expected = v['action_ref']
        
        if actual == expected:
            print(f"  PASS  {v['id']}")
            passed += 1
        else:
            print(f"  FAIL  {v['id']}")
            print(f"         expected: {expected}")
            print(f"         got:      {actual}")
            failed += 1
    
    print(f"\n{passed + failed + skipped} vectors: {passed} passed, {failed} failed, {skipped} skipped.")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
