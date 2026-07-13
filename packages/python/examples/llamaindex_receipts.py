"""
Verifiable receipts for LlamaIndex agents.

Credit scores for machines: every tool call produces a signed receipt.

Run:
    pip install nobulex llama-index
    python llamaindex_receipts.py
"""

import json
import os
import tempfile

from nobulex.integrations.llama_index import NobulexLlamaIndexAudit


def main():
    audit = NobulexLlamaIndexAudit(agent_id="llamaindex-agent")

    print("Simulating a LlamaIndex agent with 3 tool calls:\n")

    print("1. vector_search('agent trust mechanisms')")
    audit.on_tool_start("vector_search", {"query": "agent trust mechanisms"})
    audit.on_tool_end("vector_search", result="3 nodes retrieved")

    print("2. summarize('retrieved documents')")
    audit.on_tool_start("summarize", {"docs": "3 nodes"})
    audit.on_tool_end("summarize", result="Trust requires verifiable receipts...")

    print("3. sql_query('SELECT count(*) FROM agents')")
    audit.on_tool_start("sql_query", {"query": "SELECT count(*) FROM agents"})
    audit.on_tool_end("sql_query", result="42")

    path = os.path.join(tempfile.gettempdir(), "llamaindex_receipts.json")
    audit.export(path)
    with open(path) as f:
        data = json.load(f)

    print(f"\nReceipts: {data['chain_length']}")
    for entry in data["entries"]:
        r = entry.get("receipt", entry)
        print(f"  {r.get('action_ref','?')[:16]}...  {r.get('action_type','?')}")

    print(f"\nChain verified: {data['verified']}")


if __name__ == "__main__":
    main()
