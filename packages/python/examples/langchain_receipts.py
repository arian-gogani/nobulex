"""
Verifiable receipts for LangChain agents.

Credit scores for machines: every tool call produces a signed receipt.
The track record becomes a trust score any third party can verify.

Run:
    pip install nobulex langchain
    python langchain_receipts.py
"""

from nobulex.langchain import NobuReceipts


def main():
    tracker = NobuReceipts(agent_id="langchain-demo")

    print("Simulating a LangChain agent with 4 tool calls:\n")

    # Tool 1: search (success)
    print("1. search('AI agent market size')")
    tracker.on_tool_start("search", {"query": "AI agent market size"})

    # Tool 2: calculator (success)
    print("2. calculator('7.6 * 1.4')")
    tracker.on_tool_start("calculator", {"expression": "7.6 * 1.4"})

    # Tool 3: web scrape (fails)
    print("3. web_scrape('restricted.com') - blocked")
    tracker.on_tool_error("web_scrape", error="403 Forbidden: domain not in allowlist")

    # Tool 4: write report (success)
    print("4. write_report('market_analysis.md')")
    tracker.on_tool_start("write_report", {"path": "market_analysis.md"})

    print(f"\nReceipts: {len(tracker.receipts)}")
    for r in tracker.receipts:
        print(f"  {r.action_ref[:16]}...  {r.action_type}")

    print(f"\nTrust score: {tracker.trust_score}")


if __name__ == "__main__":
    main()
