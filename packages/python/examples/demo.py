#!/usr/bin/env python3
"""
Nobulex Demo: trust score for AI Agents

This script demonstrates the core concepts:
1. Agent identity with cryptographic keys
2. Receipt generation for every action
3. Tamper detection (modify a receipt, signature breaks)
4. trust score scoring
5. Multi-agent crew tracking
"""

from nobulex import Agent, Receipt, KeyPair
from nobulex.crewai import NobuCrewTracker

print("=" * 60)
print("  NOBULEX DEMO: trust score for AI Agents")
print("=" * 60)

# --- 1. Create an Agent ---
print("\n1. CREATE AN AGENT")
print("-" * 40)
agent = Agent("trading-bot-001")
print(f"   Agent ID:    {agent.agent_id}")
print(f"   Public key:  {agent.public_key[:32]}...")
print(f"   Trust score: {agent.trust_score}")

# --- 2. Generate Receipts ---
print("\n2. GENERATE RECEIPTS")
print("-" * 40)
r1 = agent.act("market_scan", scope="NYSE:AAPL")
print(f"   Action: {r1.action_type}")
print(f"   Verdict: {r1.verdict}")
print(f"   Verified: {r1.verify()}")
print(f"   Action ref: {r1.action_ref[:40]}...")

r2 = agent.act("place_order", scope="BUY 100 AAPL @ 195.50")
r3 = agent.act("risk_check", scope="portfolio_exposure < 5%")
print(f"\n   3 receipts generated. Trust score: {agent.trust_score}")

# --- 3. Tamper Detection ---
print("\n3. TAMPER DETECTION")
print("-" * 40)
keys = KeyPair()
receipt = Receipt.create(
    agent_id="test-agent",
    action_type="transfer_funds",
    scope="$10,000 to account XYZ",
    keys=keys,
)
print(f"   Original receipt verified: {receipt.verify()}")
receipt.scope = "$1,000,000 to attacker_account"
print(f"   Tampered receipt verified: {receipt.verify()}")
print("   Tampering detected. Signature no longer matches.")

# --- 4. Denied Actions ---
print("\n4. DENIED ACTIONS (caught violations)")
print("-" * 40)
denied = agent.deny(
    "unauthorized_withdrawal",
    scope="$50,000 from restricted_fund",
    metadata={"reason": "exceeds daily limit", "policy": "risk-001"},
)
print(f"   Action: {denied.action_type}")
print(f"   Verdict: {denied.verdict}")
print(f"   Verified: {denied.verify()}")
print(f"   Trust score after denial: {agent.trust_score}")
print("   (Catching violations proves the system works)")

# --- 5. Multi-Agent Crew Tracking ---
print("\n5. MULTI-AGENT CREW TRACKING")
print("-" * 40)
crew = NobuCrewTracker("research-crew")

crew.on_task_start("researcher", "find market data")
crew.on_task_complete("researcher", "find market data", result="Found 247 data points")
crew.on_task_start("analyst", "analyze trends")
crew.on_task_complete("analyst", "analyze trends", result="3 buy signals detected")
crew.on_task_start("writer", "generate report")
crew.on_task_fail("writer", "generate report", error="API rate limit exceeded")
crew.on_task_start("writer", "generate report")
crew.on_task_complete("writer", "generate report", result="Report generated: 2400 words")

print(crew.summary())
print(f"\n   Total crew receipts: {len(crew.receipts)}")

# --- 6. Receipt JSON ---
print("\n6. RECEIPT JSON FORMAT")
print("-" * 40)
print(r1.to_json())

# --- Summary ---
print("\n" + "=" * 60)
print("  SUMMARY")
print("=" * 60)
print(f"  Agent: {agent.agent_id}")
print(f"  Total receipts: {len(agent.receipts)}")
print(f"  trust score: {agent.trust_score}")
print(f"  Public key: {agent.public_key[:32]}...")
print()
print("  Credit scores exist for people.")
print("  Now they exist for machines.")
print("=" * 60)
