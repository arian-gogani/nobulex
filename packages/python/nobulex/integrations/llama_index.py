"""Nobulex LlamaIndex integration.

Emits a signed, hash-chained Nobulex receipt for every tool call in a
LlamaIndex agent. Works with LlamaIndex's CallbackManager.

Usage:
    from nobulex.integrations.llama_index import NobulexLlamaIndexAudit

    audit = NobulexLlamaIndexAudit(agent_id="my-agent")
    audit.record_tool("web_search", {"query": "test"}, {"results": 5})
    audit.export("audit.json")
"""
from __future__ import annotations

from typing import Any, Callable, Optional
from functools import wraps

from nobulex.chain import ReceiptChain


class NobulexLlamaIndexAudit:
    """LlamaIndex audit wrapper producing Nobulex receipts per tool call."""

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def on_tool_start(self, tool_name: str, args: dict[str, Any] | None = None) -> None:
        self.chain.append(
            action_type=f"tool_call:{tool_name}",
            scope=str(args)[:256] if args else "",
        )

    def on_tool_end(self, tool_name: str, result: Any = None) -> None:
        self.chain.append(
            action_type=f"tool_result:{tool_name}",
            scope=str(result)[:256] if result else "",
        )

    def record_tool(
        self,
        tool_name: str,
        args: dict[str, Any] | None = None,
        result: Any = None,
    ) -> None:
        self.on_tool_start(tool_name, args)
        if result is not None:
            self.on_tool_end(tool_name, result)

    def wrap_tool(self, tool_name: str) -> Callable:
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                self.on_tool_start(tool_name, kwargs or {})
                try:
                    result = func(*args, **kwargs)
                    self.on_tool_end(tool_name, result)
                    return result
                except Exception as e:
                    self.chain.append(
                        action_type=f"tool_error:{tool_name}",
                        scope=str(e)[:256],
                    )
                    raise
            return wrapper
        return decorator

    def export(self, path: str) -> None:
        self.chain.export(path)

    @property
    def public_key(self) -> str:
        if self.chain._chain:
            return self.chain._chain[0]["receipt"].signer_public_key
        return ""

    def verify(self, authorized_keys: Optional[str] = None) -> bool:
        return self.chain.verify(authorized_keys)
