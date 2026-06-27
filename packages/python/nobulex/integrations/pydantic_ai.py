"""Nobulex PydanticAI integration.

Emits a signed, hash-chained Nobulex receipt for every tool call in a
PydanticAI agent. Works with PydanticAI's typed tool system.

Usage:
    from nobulex.integrations.pydantic_ai import NobulexPydanticAIAudit

    audit = NobulexPydanticAIAudit(agent_id="my-agent")
    audit.record_tool("get_weather", {"city": "Berlin"}, {"temp": 22})
    audit.export("audit.json")
"""
from __future__ import annotations

from typing import Any, Callable, Optional
from functools import wraps

from nobulex.chain import ReceiptChain


class NobulexPydanticAIAudit:
    """PydanticAI audit wrapper producing Nobulex receipts per tool call."""

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def record_tool(
        self,
        tool_name: str,
        args: dict[str, Any] | None = None,
        result: Any = None,
    ) -> None:
        """Record a tool call and its result as a signed receipt."""
        self.chain.append(
            action_type=f"tool_call:{tool_name}",
            scope=str(args)[:256] if args else "",
        )
        if result is not None:
            self.chain.append(
                action_type=f"tool_result:{tool_name}",
                scope=str(result)[:256],
            )

    def wrap_tool(self, tool_name: str) -> Callable:
        """Decorator that wraps a PydanticAI tool with receipt emission."""
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                self.chain.append(
                    action_type=f"tool_call:{tool_name}",
                    scope=str(kwargs)[:256] if kwargs else str(args)[:256],
                )
                try:
                    result = func(*args, **kwargs)
                    self.chain.append(
                        action_type=f"tool_result:{tool_name}",
                        scope=str(result)[:256] if result else "",
                    )
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
