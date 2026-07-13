"""
Verifiable receipts for Google ADK agents.

Credit scores for machines: every tool call produces a signed receipt.

Run:
    pip install nobulex google-adk
    python google_adk_receipts.py
"""

import json
import os
import tempfile

from nobulex.integrations.google_adk import NobulexADKCallback


def main():
    tracker = NobulexADKCallback(agent_id="adk-demo-agent")

    print("Simulating a Google ADK agent with 4 tool calls:\n")

    print("1. google_search('AI agent market')")
    tracker.on_tool_start("google_search", {"query": "AI agent market"})
    tracker.on_tool_end("google_search", result="47 results found")

    print("2. code_exec('print(2+2)')")
    tracker.on_tool_start("code_exec", {"code": "print(2+2)"})
    tracker.on_tool_end("code_exec", result="4")

    print("3. grounding_check('claim about AI safety')")
    tracker.on_tool_start("grounding_check", {"claim": "AI safety"})
    tracker.on_tool_end("grounding_check", result="partially_supported")

    print("4. send_email('ceo@company.com')")
    tracker.on_tool_start("send_email", {"to": "ceo@company.com"})
    tracker.on_tool_end("send_email", result="sent")

    # Export and display
    path = os.path.join(tempfile.gettempdir(), "adk_receipts.json")
    tracker.export(path)
    with open(path) as f:
        data = json.load(f)

    print(f"\nReceipts: {data['chain_length']}")
    for entry in data["entries"]:
        r = entry.get("receipt", entry)
        ref = r.get("action_ref", "?")
        atype = r.get("action_type", "?")
        print(f"  {str(ref)[:16]}...  {atype}")

    print(f"\nChain verified: {data['verified']}")
    print(f"Head hash: {data['head_hash'][:24]}...")


if __name__ == "__main__":
    main()
