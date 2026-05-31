#!/usr/bin/env python3
"""
Generate a specimen signed receipt for AgentAudit integration.

Produces:
- One real signed receipt (Ed25519, JCS-canonical)
- A 3-receipt hash-chain showing the linking
- Cross-validation digests from the existing fixture set

Used as the golden fixture for action-ref-v1 conformance testing.
"""

import json
import os
import sys
from pathlib import Path

# Add the local package to path so we use the live code
sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "python"))

from nobulex.agent import Agent
from nobulex.chain import ReceiptChain
from nobulex.crypto import (
    KeyPair,
    jcs_canonicalize,
    sha256_hex,
    compute_action_ref,
)


def main():
    # 1. Deterministic key for the specimen (so the fixture is reproducible).
    #    NOT for production use; this is a public test key.
    SPECIMEN_SEED = bytes.fromhex(
        "0001020304050607080910111213141516171819202122232425262728293031"
    )
    kp = KeyPair.from_seed(SPECIMEN_SEED) if hasattr(KeyPair, "from_seed") else KeyPair()

    agent = Agent("specimen-agent-001")
    # Pin agent's key to the deterministic specimen key so the receipt is reproducible
    if hasattr(agent, "_key"):
        agent._key = kp
    elif hasattr(agent, "key"):
        agent.key = kp

    # 2. Single specimen receipt
    specimen = agent.act(
        action_type="transfer_funds",
        scope="500_USDC_to_vendor_acme",
        metadata={
            "purpose": "agentaudit_integration_specimen",
            "policy_version": "risk-policy-v2.1",
        },
    )

    # 3. 3-receipt chain to show hash-linking
    chain = ReceiptChain(agent_id="specimen-chain-001")
    if hasattr(chain.agent, "_key"):
        chain.agent._key = kp
    elif hasattr(chain.agent, "key"):
        chain.agent.key = kp

    chain.append("read_kyc_record", scope="customer:CUST-92481")
    chain.append("compute_risk_score", scope="model:risk-v3.2:CUST-92481")
    chain.append("transfer_funds", scope="500_USDC_to_vendor_acme")

    # 4. Cross-validation digests we already publish in vectors.json
    vectors_path = (
        Path(__file__).parent.parent
        / "fixtures"
        / "bilateral-receipt"
        / "v0"
        / "vectors.json"
    )
    vectors = json.loads(vectors_path.read_text())

    # 5. Build the package
    package = {
        "schema": "agentaudit-integration-specimen-v1",
        "generated_at_ms": specimen.timestamp_ms,
        "spec_reference": "action-ref-v1.0",
        "canonicalization": "RFC 8785 (JCS)",
        "signature_alg": "Ed25519",
        "public_key_hex": specimen.signer_public_key,
        "single_receipt": {
            "description": "One signed receipt. Verify by:"
                           " 1) recompute JCS of preimage, "
                           "2) compute sha256 = action_ref, "
                           "3) verify Ed25519 signature over to_canonical().",
            "preimage_fields_used_for_action_ref": {
                "agent_id": specimen.agent_id,
                "action_type": specimen.action_type,
                "scope": specimen.scope,
                "timestamp_ms": specimen.timestamp_ms,
            },
            "action_ref": specimen.action_ref,
            "verdict": specimen.verdict,
            "signature": specimen.signature,
            "receipt": specimen.to_dict(),
        },
        "chain_3_receipts": {
            "description": "Three receipts hash-linked. "
                           "chain_hash[n] = SHA-256(chain_hash[n-1] || action_ref[n]), "
                           "genesis_prev_hash = '0' * 64.",
            "head_hash": chain.head_hash,
            "length": chain.length,
            "receipts": [
                {
                    k: (v.to_dict() if hasattr(v, "to_dict") else v)
                    for k, v in entry.items()
                }
                for entry in chain._chain
            ],
        },
        "cross_validation_digests": {
            "description": "Validated cross-implementation. "
                           "Python + JS produce byte-identical action_refs "
                           "for these preimages.",
            "fixture_source": "fixtures/bilateral-receipt/v0/vectors.json",
            "vector_count": len(vectors.get("vectors", [])),
            "vectors": [
                {
                    "id": v["id"],
                    "preimage_fields": v["preimage_fields"],
                    "expected_canonical_preimage": v.get("expected_canonical_preimage"),
                    "expected_action_ref": v["expected_action_ref"],
                    "verdict": v.get("verdict"),
                }
                for v in vectors.get("vectors", [])
            ],
        },
        "verification_recipe_python": [
            "import json, hashlib",
            "from rfc8785 import dumps as jcs_dumps  # pip install rfc8785",
            "preimage = {",
            "  'agent_id': r['preimage_fields_used_for_action_ref']['agent_id'],",
            "  'action_type': r['preimage_fields_used_for_action_ref']['action_type'],",
            "  'scope': r['preimage_fields_used_for_action_ref']['scope'],",
            "  'timestamp_ms': r['preimage_fields_used_for_action_ref']['timestamp_ms'],",
            "}",
            "canonical = jcs_dumps(preimage)  # bytes",
            "expected = hashlib.sha256(canonical).hexdigest()",
            "assert expected == r['action_ref']  # action_ref matches",
        ],
        "notes_for_integrator": [
            "agent_id, action_type, scope, timestamp_ms are the ONLY four fields in the preimage.",
            "policy_version, attempt_id, authority_verified_at_ms are siblings, not inside preimage.",
            "Empty result payload convention: result_hash = sha256('') = e3b0c442...855",
            "data_read scope convention: parse last two ':'-segments as version+hash; everything else is endpoint.",
            "Verifier recomputes action_ref from preimage. Match = receipt is what it claims.",
        ],
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "agentaudit-specimen-v1.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(package, indent=2, sort_keys=True))
    print(f"WROTE: {out_path}")
    print(f"single receipt action_ref: {specimen.action_ref}")
    print(f"chain head_hash: {chain.head_hash}")
    print(f"chain length: {chain.length}")
    print(f"cross-validation vectors: {len(vectors.get('vectors', []))}")


if __name__ == "__main__":
    main()
