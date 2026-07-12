"""
Verifiable receipts for CrewAI crews.

Credit scores for machines: every task a CrewAI agent completes produces a
signed receipt. The verified track record becomes a trust score that any
third party can recompute and verify.

Run:
    pip install nobulex crewai
    python crewai_receipts.py
"""

from nobulex.crewai import NobuCrewTracker


def main():
    tracker = NobuCrewTracker(crew_id="demo-crew")

    print("Simulating a CrewAI crew with 3 tasks:\n")

    # Task 1: successful research
    print("1. researcher: market analysis")
    tracker.on_task_start("researcher", "market_analysis", {"topic": "AI agents"})
    tracker.on_task_complete(
        "researcher", "market_analysis",
        result="Found 47 companies in the agent trust space"
    )

    # Task 2: successful writing
    print("2. writer: draft report")
    tracker.on_task_start("writer", "draft_report", {"format": "pdf"})
    tracker.on_task_complete(
        "writer", "draft_report",
        result="12-page report generated"
    )

    # Task 3: failed deployment (policy violation)
    print("3. deployer: push to production - blocked by policy")
    tracker.on_task_start("deployer", "push_production", {"target": "main"})
    tracker.on_task_fail(
        "deployer", "push_production",
        error="Unauthorized: no approval receipt for production deployment"
    )

    # Show results
    print("\nReceipts:")
    for r in tracker.receipts:
        print(f"  {r.action_ref[:16]}...  type={r.action_type}")

    print("\nTrust scores per agent:")
    scores = tracker.trust_scores
    for agent, score in scores.items():
        print(f"  {agent}: {score}")

    print(f"\nSummary: {tracker.summary()}")


if __name__ == "__main__":
    main()
