"""Nobulex Google ADK integration.

Emits a signed, hash-chained Nobulex receipt for every tool call in a
Google ADK agent. Produces Article 12-grade audit evidence.

Usage:
    from nobulex.integrations.google_adk import NobulexADKCallback

    callback = NobulexADKCallback(agent_id="my-agent")

    # register as a before/after tool callback
    # callback records each tool invocation as a signed receipt

    callback.export("audit.json")
"""
from __future__ import annotations

from typing import Any, Callable, Optional
from functools import wraps

from nobulex.chain import ReceiptChain


class NobulexADKCallback:
    """Google ADK callback that produces Nobulex receipts per tool call.

    Works with ADK's callback mechanism. Register on_tool_start and
    on_tool_end to capture each tool invocation as a signed receipt.
    """

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def on_tool_start(self, tool_name: str, args: dict[str, Any] | None = None) -> None:
        """Record a tool invocation as a signed receipt."""
        scope = str(args)[:256] if args else ""
        self.chain.append(
            action_type=f"tool_call:{tool_name}",
            scope=scope,
        )

    def on_tool_end(self, tool_name: str, result: Any = None) -> None:
        """Record a tool completion."""
        self.chain.append(
            action_type=f"tool_result:{tool_name}",
            scope=str(result)[:256] if result else "",
        )

    def wrap_tool(self, tool_name: str) -> Callable:
        """Decorator that wraps an ADK tool function with receipt emission."""
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
        """Export the signed, hash-chained audit trail to JSON."""
        self.chain.export(path)

    @property
    def public_key(self) -> str:
        if self.chain._chain:
            return self.chain._chain[0]["receipt"].signer_public_key
        return ""

    def verify(self, authorized_keys: Optional[str] = None) -> bool:
        return self.chain.verify(authorized_keys)
