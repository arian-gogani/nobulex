"""Nobulex CrewAI integration.

Emits a signed, hash-chained Nobulex receipt for every task execution
in a CrewAI crew. Produces Article 12-grade audit evidence.

Usage:
    from nobulex.integrations.crewai import NobulexCrewAudit

    audit = NobulexCrewAudit(agent_id="my-crew")

    @audit.on_task
    def my_task_callback(task_output):
        # called after each task completes
        pass

    # or manually:
    audit.record_task("research", "competitor analysis for Q3")
    audit.export("audit.json")
"""
from __future__ import annotations

from typing import Any, Callable, Optional
from functools import wraps

from nobulex.chain import ReceiptChain


class NobulexCrewAudit:
    """CrewAI audit wrapper that produces Nobulex receipts per task."""

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def record_task(self, task_name: str, scope: str) -> None:
        """Record a task execution as a signed receipt."""
        self.chain.append(
            action_type=f"task:{task_name}",
            scope=str(scope)[:256],
        )

    def record_tool_call(self, tool_name: str, scope: str) -> None:
        """Record a tool call within a task."""
        self.chain.append(
            action_type=f"tool_call:{tool_name}",
            scope=str(scope)[:256],
        )

    def on_task(self, func: Callable) -> Callable:
        """Decorator that records a receipt after the wrapped function runs."""
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = func(*args, **kwargs)
            self.chain.append(
                action_type=f"task:{func.__name__}",
                scope=str(result)[:256] if result else "",
            )
            return result
        return wrapper

    def export(self, path: str) -> None:
        """Export the signed, hash-chained audit trail to JSON."""
        self.chain.export(path)

    @property
    def public_key(self) -> str:
        """The Ed25519 public key for this crew's receipts."""
        if self.chain._chain:
            return self.chain._chain[0]["receipt"].signer_public_key
        return ""

    def verify(self, authorized_keys: Optional[str] = None) -> bool:
        """Verify the in-memory chain."""
        return self.chain.verify(authorized_keys)
