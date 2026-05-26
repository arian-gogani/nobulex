"""
Cross-implementation validation test.
Proves the Python SDK produces action_ref values that match
the published test vectors in fixtures/bilateral-receipt/v0/vectors.json
"""

import json
import sys
sys.path.insert(0, '.')
from nobulex.crypto import compute_action_ref

# Load test vectors
with open('../../fixtures/bilateral-receipt/v0/vectors.json') as f:
    data = json.load(f)

passed = 0
failed = 0

for v in data['vectors']:
    fields = v['preimage_fields']
    expected = v['expected_action_ref']
    
    actual = compute_action_ref(
        fields['agent_id'],
        fields['action_type'],
        fields['scope'],
        fields['timestamp_ms']
    )
    
    if actual == expected:
        print(f"  PASS  {v['id']}")
        print(f"         {actual[:32]}...")
        passed += 1
    else:
        print(f"  FAIL  {v['id']}")
        print(f"         expected: {expected[:32]}...")
        print(f"         got:      {actual[:32]}...")
        failed += 1

print(f"\n{passed + failed} vectors, {passed} passed, {failed} failed.")
if failed == 0:
    print("Cross-implementation validation: PASS")
