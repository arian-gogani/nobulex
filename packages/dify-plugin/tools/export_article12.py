"""Nobulex - export_article12 tool. Built on `pip install nobulex`."""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

try:  # loaded as tools.export_article12
    from ._state import get_chain
except Exception:  # pragma: no cover
    try:
        from tools._state import get_chain
    except Exception:
        from _state import get_chain


class ExportArticle12Tool(Tool):
    """Export technical evidence for an EU AI Act Article 12 review."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        agent_id = self.runtime.credentials.get("agent_id") or "dify-agent"
        include_policy_mapping: bool = tool_parameters.get(
            "include_policy_mapping", True
        )

        chain = get_chain(agent_id)

        # ReceiptChain.export() writes the verified evidence package to a file;
        # read it back to obtain the receipt entries.
        fd, tmp = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            chain.export(tmp)
            with open(tmp, encoding="utf-8") as f:
                exported = json.load(f)
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass

        receipts = exported.get("entries", [])
        receipt_count = chain.length

        package: dict[str, Any] = {
            "schema": "nobulex-article12-evidence-v1",
            "agent_id": agent_id,
            "chain_head_hash": chain.head_hash,
            "verified": exported.get("verified"),
            "receipt_count": receipt_count,
            "receipts": receipts,
        }

        if include_policy_mapping:
            package["article_12_context"] = {
                "eu_ai_act_article_12": {
                    "requirement": "Automatic event logging for in-scope high-risk AI systems",
                    "evidence_provided": "Ed25519-signed, JCS-canonical, hash-chained records",
                    "verification": "A party with the agent's public key can check the exported records offline for later changes",
                    "legal_effect": "This export does not by itself establish Article 12 compliance",
                    "chain_head_hash": chain.head_hash,
                    "receipt_count": receipt_count,
                }
            }

        yield self.create_json_message(
            {
                "package_json": json.dumps(package, indent=2),
                "receipt_count": receipt_count,
                "chain_head_hash": chain.head_hash,
            }
        )
