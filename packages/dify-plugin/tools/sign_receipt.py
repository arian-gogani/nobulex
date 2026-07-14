"""Nobulex - sign_receipt tool. Built on `pip install nobulex`."""

from __future__ import annotations

import json
from typing import Any, Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

try:  # loaded as tools.sign_receipt
    from ._state import get_chain
except Exception:  # pragma: no cover - fallbacks for alternate load paths
    try:
        from tools._state import get_chain
    except Exception:
        from _state import get_chain


class SignReceiptTool(Tool):
    """Generate an Ed25519-signed receipt for one Dify tool call."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        agent_id = self.runtime.credentials.get("agent_id") or "dify-agent"
        action_type: str = tool_parameters["action_type"]
        scope: str = tool_parameters["scope"]
        policy_version: str | None = tool_parameters.get("policy_version")

        chain = get_chain(agent_id)

        metadata: dict[str, str] = {}
        if policy_version:
            metadata["policy_version"] = policy_version

        receipt = chain.append(
            action_type=action_type,
            scope=scope,
            metadata=metadata or None,
        )

        result = {
            "action_ref": receipt.action_ref,
            "signature": receipt.signature,
            "chain_hash": chain.head_hash,
            "timestamp_ms": receipt.timestamp_ms,
            "receipt_json": json.dumps(receipt.to_dict()),
        }

        yield self.create_json_message(result)
