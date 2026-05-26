"""
Real-world nobulex integration examples.

Shows how to add tamper-evident receipts to common AI agent patterns.
"""
import sys
sys.path.insert(0, 'packages/python')
from nobulex import Agent
from nobulex.chain import ReceiptChain


def payment_agent():
    """Payment processing agent with full audit trail."""
    agent = Agent("payment-bot")
    chain = ReceiptChain("payment-bot")
    
    # Each step is receipted
    chain.append("authenticate", scope="api.stripe.com")
    chain.append("fetch_balance", scope="account_xyz:balance_check")
    chain.append("compliance_check", scope="aml_screening:vendor_abc")
    chain.append("create_payment", scope="100_USDC:vendor_abc")
    chain.append("confirm_settlement", scope="tx_hash_0xabc123")
    
    print("Payment agent audit trail:")
    print(f"  Actions: {chain.chain_length}")
    print(f"  Chain valid: {chain.verify()}")
    print(f"  Head hash: {chain.head_hash[:32]}...")
    
    # Export for auditors
    chain.export("/tmp/payment_audit.json")
    print("  Exported to /tmp/payment_audit.json")
    return chain


def browser_agent():
    """Browser automation agent with page-level receipts."""
    agent = Agent("browser-agent")
    
    actions = [
        ("navigate", "https://example.com/dashboard"),
        ("extract_data", "table:quarterly_revenue"),
        ("screenshot", "dashboard_2026q2.png"),
        ("fill_form", "search:competitor_analysis"),
        ("download", "report_q2_2026.pdf"),
    ]
    
    receipts = []
    for action_type, scope in actions:
        r = agent.act(action_type, scope=scope)
        receipts.append(r)
        print(f"  [{r.verdict}] {action_type}: {scope}")
        print(f"         ref={r.action_ref[:24]}... verified={r.verify()}")
    
    return receipts


def multi_agent_handoff():
    """Multi-agent system with cryptographic handoff receipts."""
    triage = Agent("triage-agent")
    sales = Agent("sales-agent")
    support = Agent("support-agent")
    
    # Triage agent receives request
    r1 = triage.act("receive_request", scope="customer_123:billing_issue")
    print(f"  Triage received: {r1.action_ref[:24]}...")
    
    # Triage hands off to support
    r2 = triage.act("handoff", scope=f"to_support:{r1.action_ref[:16]}")
    print(f"  Handoff to support: {r2.action_ref[:24]}...")
    
    # Support resolves
    r3 = support.act("resolve_issue", scope=f"billing_credit:$50:{r2.action_ref[:16]}")
    print(f"  Support resolved: {r3.action_ref[:24]}...")
    
    # All receipts independently verifiable
    print(f"\n  All verified: {all(r.verify() for r in [r1, r2, r3])}")
    print(f"  Each agent has independent keys")
    print(f"  Handoff chain is traceable via action_ref references")


def deny_receipt():
    """Agent that denies an action and receipts the denial."""
    agent = Agent("compliance-agent")
    
    # Agent receives a request that violates policy
    receipt = agent.act(
        "transfer_funds",
        scope="10000_USDC:sanctioned_entity",
        verdict="DENY"
    )
    
    print(f"  Action: {receipt.action_type}")
    print(f"  Scope: {receipt.scope}")
    print(f"  Verdict: {receipt.verdict}")
    print(f"  Verified: {receipt.verify()}")
    print(f"  The DENY decision is signed and tamper-evident")


if __name__ == "__main__":
    print("=== Payment Agent ===")
    payment_agent()
    print("\n=== Browser Agent ===")
    browser_agent()
    print("\n=== Multi-Agent Handoff ===")
    multi_agent_handoff()
    print("\n=== Deny Receipt ===")
    deny_receipt()
