"""
Nobulex + AgentAudit AI Integration Example

Demonstrates the end-to-end flow:
1. Agent generates a tamper-proof receipt (Nobulex)
2. Receipt is prepared for on-chain anchoring (AgentAudit)
3. The action_ref serves as the primary binding key

Prerequisites:
    pip install cryptography rfc8785
"""

from nobulex import Agent
from nobulex.chain import ReceiptChain
import json
import hashlib


def demo_single_receipt():
    """Generate a single receipt ready for on-chain anchoring."""
    agent = Agent("payment-bot")
    receipt = agent.act("transfer_funds", scope="100_USDC_to_vendor")
    
    print("=== NOBULEX RECEIPT ===")
    print(f"action_ref:  {receipt.action_ref}")
    print(f"agent_id:    {receipt.agent_id}")
    print(f"action_type: {receipt.action_type}")
    print(f"scope:       {receipt.scope}")
    print(f"verdict:     {receipt.verdict}")
    print(f"verified:    {receipt.verify()}")
    
    # The action_ref is what AgentAudit anchors on-chain
    # It maps to bytes32 logHash in AuditVault.verifyLog()
    action_ref_bytes32 = bytes.fromhex(receipt.action_ref)
    print(f"\n=== FOR AGENTAUDIT ===")
    print(f"logHash (bytes32): 0x{receipt.action_ref}")
    print(f"contentURI:        ipfs://... (receipt JSON)")
    
    return receipt


def demo_batch_anchoring():
    """Generate a batch of receipts for efficient on-chain anchoring."""
    chain = ReceiptChain("compliance-agent")
    
    actions = [
        ("authenticate", "api.stripe.com"),
        ("fetch_balance", "account_123"),
        ("check_compliance", "aml_screening_vendor_xyz"),
        ("create_payment", "100_USDC_to_vendor"),
        ("verify_payment", "tx_hash_abc123"),
    ]
    
    for action_type, scope in actions:
        chain.append(action_type, scope)
    
    print("\n=== RECEIPT CHAIN (5 actions) ===")
    print(f"Chain verified: {chain.verify()}")
    print(f"Head hash:      {chain.head_hash[:32]}...")
    
    # Export for AgentAudit batch anchoring
    chain.export("/tmp/batch_anchor.json")
    
    with open("/tmp/batch_anchor.json") as f:
        batch = json.load(f)
    
    print(f"\n=== BATCH FOR AGENTAUDIT ===")
    print(f"Entries:    {batch['chain_length']}")
    print(f"All valid:  {batch['verified']}")
    
    # Each entry's action_ref can be anchored individually
    # Or the head_hash can anchor the entire chain at once
    print(f"\nPer-receipt anchoring (5 tx):")
    for entry in batch['entries']:
        print(f"  [{entry['index']}] {entry['action_type']:20s} logHash=0x{entry['action_ref'][:16]}...")
    
    print(f"\nBatch anchoring (1 tx):")
    print(f"  chainHash=0x{batch['head_hash'][:32]}...")
    
    return batch


def demo_tamper_detection():
    """Show that tampering breaks verification."""
    agent = Agent("test-agent")
    receipt = agent.act("transfer_funds", scope="100_USDC")
    
    print("\n=== TAMPER DETECTION ===")
    print(f"Original: scope='{receipt.scope}', verified={receipt.verify()}")
    
    # Tamper with the receipt
    receipt.scope = "10000_USDC"  # Changed amount
    print(f"Tampered: scope='{receipt.scope}', verified={receipt.verify()}")
    print("→ Signature breaks. On-chain anchor would reject this receipt.")


if __name__ == "__main__":
    demo_single_receipt()
    demo_batch_anchoring()
    demo_tamper_detection()
