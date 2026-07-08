"""
Verifiable tool-call receipts for PydanticAI agents.

Credit scores for AI agents: every tool call an agent makes produces a
signed, hash-chained receipt. The verified track record becomes a trust
score any third party can recompute and verify, without trusting the
operator that produced it.

Success and error paths both emit receipts, so the chain has no silent gaps.

Run:
    pip install nobulex pydantic-ai
    python pydantic_ai_receipts.py
"""

from __future__ import annotations

from nobulex import Agent as ReceiptAgent

try:
    from pydantic_ai import Agent as PydanticAgent
    from pydantic_ai.tools import RunContext

    HAS_PYDANTIC_AI = True
except ImportError:
    HAS_PYDANTIC_AI = False


receipts = ReceiptAgent("pydantic-ai-demo-agent")


def record_tool_call(tool_name: str, args: dict, ok: bool, result: str = "") -> None:
    """Emit a signed receipt for one tool call.

    ALLOW receipts record successful actions. DENY receipts record failures
    and blocked actions, so a failed tool call is still evidence in the chain
    rather than a silent gap.
    """
    scope = ",".join(f"{k}={v}" for k, v in args.items())
    if ok:
        receipt = receipts.act(
            action_type=f"tool:{tool_name}",
            scope=scope,
            metadata={"result_len": len(result)},
        )
    else:
        receipt = receipts.deny(
            action_type=f"tool:{tool_name}",
            scope=scope,
            metadata={"terminal_state": "ERROR"},
        )
    verdict = "ALLOW" if ok else "DENY"
    print(f"  receipt {receipt.action_ref[:16]}...  verdict={verdict}")


def demo_standalone() -> None:
    """Runnable without PydanticAI installed: simulates three tool calls."""
    print("Simulating an agent that makes three tool calls:\n")

    print("1. search(query='weather in SF')")
    record_tool_call("search", {"query": "weather in SF"}, ok=True, result="65F, clear")

    print("2. send_email(to='user@example.com')")
    record_tool_call("send_email", {"to": "user@example.com"}, ok=True, result="sent")

    print("3. delete_records(scope='all')  -- blocked by policy")
    record_tool_call("delete_records", {"scope": "all"}, ok=False)

    print("\nEvery receipt is Ed25519-signed and hash-chained. Verify them:\n")
    for r in receipts.receipts:
        valid = receipts.verify_receipt(r)
        print(f"  {r.action_ref[:16]}...  signature_valid={valid}")

    print(f"\nTrust score (verified track record): {receipts.trust_score}")
    print(
        "\nThis score is content-derived and independently recomputable. A third "
        "party with the agent's public key and receipt corpus can verify the same "
        "score without trusting this process."
    )


def demo_pydantic_ai() -> None:
    """Wrap a real PydanticAI agent's tools with receipt recording."""
    agent = PydanticAgent("openai:gpt-4o-mini")

    @agent.tool
    def search(ctx: RunContext, query: str) -> str:
        try:
            result = f"results for {query}"
            record_tool_call("search", {"query": query}, ok=True, result=result)
            return result
        except Exception:
            record_tool_call("search", {"query": query}, ok=False)
            raise

    print("PydanticAI agent wired with receipt recording on every tool call.")
    print("Run the agent, then inspect receipts.receipts and receipts.trust_score.")


if __name__ == "__main__":
    if HAS_PYDANTIC_AI:
        demo_pydantic_ai()
    else:
        demo_standalone()
