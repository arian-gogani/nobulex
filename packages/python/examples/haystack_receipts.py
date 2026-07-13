"""
Verifiable receipts for Haystack pipelines.

Credit scores for machines: every pipeline component run produces a receipt.

Run:
    pip install nobulex haystack-ai
    python haystack_receipts.py
"""

import json
import os
import tempfile

from nobulex.integrations.haystack import NobulexHaystackAudit


def main():
    audit = NobulexHaystackAudit(agent_id="haystack-rag-pipeline")

    print("Simulating a Haystack RAG pipeline with 4 components:\n")

    print("1. text_embedder")
    audit.record_component("text_embedder",
        inputs={"text": "What is agent trust?"},
        outputs={"embedding": [0.1, 0.2, 0.3]})

    print("2. retriever")
    audit.record_component("retriever",
        inputs={"query_embedding": [0.1, 0.2, 0.3]},
        outputs={"documents": ["doc_1", "doc_2", "doc_3"]})

    print("3. prompt_builder")
    audit.record_component("prompt_builder",
        inputs={"documents": ["doc_1", "doc_2"], "query": "What is agent trust?"},
        outputs={"prompt": "Based on docs, answer: What is agent trust?"})

    print("4. llm_generator")
    audit.record_component("llm_generator",
        inputs={"prompt": "Based on docs, answer: What is agent trust?"},
        outputs={"reply": "Agent trust is a verified track record..."})

    path = os.path.join(tempfile.gettempdir(), "haystack_receipts.json")
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
