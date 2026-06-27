"""Nobulex LangChain callback handler.

Emits a signed, hash-chained Nobulex receipt for every tool call in a
LangChain agent run. Produces Article 12-grade audit evidence.

Usage:
    from nobulex.integrations.langchain import NobulexAuditHandler

    handler = NobulexAuditHandler(agent_id="my-agent")
    agent.invoke({"input": "..."}, config={"callbacks": [handler]})
    handler.export("audit.json")

    # verify the trail
    from nobulex.chain import verify_audit_trail
    report = verify_audit_trail("audit.json", authorized_keys=handler.public_key)
"""
from __future__ import annotations

from typing import Any, Optional

try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:
    raise ImportError(
        "langchain-core is required for this integration. "
        "Install it with: pip install langchain-core"
    )

from nobulex.chain import ReceiptChain


class NobulexAuditHandler(BaseCallbackHandler):
    """LangChain callback that produces Nobulex receipts per tool call.

    Each tool invocation generates a signed, content-addressed receipt.
    The receipts form a hash-chained audit trail that can be exported
    and independently verified without trusting the operator.
    """

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        super().__init__()
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        tool_name = serialized.get("name", kwargs.get("name", "unknown_tool"))
        self.chain.append(
            action_type=f"tool_call:{tool_name}",
            scope=str(input_str)[:256],
        )

    def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
        self.chain.append(
            action_type="tool_error",
            scope=str(error)[:256],
        )

    def export(self, path: str) -> None:
        """Export the signed, hash-chained audit trail to JSON."""
        self.chain.export(path)

    @property
    def public_key(self) -> str:
        """The Ed25519 public key for this agent's receipts."""
        if self.chain._chain:
            return self.chain._chain[0]["receipt"].signer_public_key
        return ""

    def verify(self, authorized_keys: Optional[str] = None) -> bool:
        """Verify the in-memory chain."""
        return self.chain.verify(authorized_keys)
