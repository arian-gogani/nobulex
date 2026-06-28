"""Nobulex Haystack integration.

Emits a signed, hash-chained Nobulex receipt for every component call
in a Haystack pipeline. Works with Haystack's component callback system.

Usage:
    from nobulex.integrations.haystack import NobulexHaystackAudit

    audit = NobulexHaystackAudit(agent_id="my-pipeline")
    audit.record_component("Retriever", {"query": "EU AI Act"}, {"documents": [...]})
    audit.export("audit.json")
"""
from __future__ import annotations

from typing import Any, Callable, Optional
from functools import wraps

from nobulex.chain import ReceiptChain


class NobulexHaystackAudit:
    """Haystack pipeline audit wrapper producing Nobulex receipts."""

    def __init__(self, agent_id: str, chain: Optional[ReceiptChain] = None):
        self.chain = chain or ReceiptChain(agent_id=agent_id)

    def record_component(
        self,
        component_name: str,
        inputs: dict[str, Any] | None = None,
        outputs: Any = None,
    ) -> None:
        self.chain.append(
            action_type=f"component:{component_name}",
            scope=str(inputs)[:256] if inputs else "",
        )
        if outputs is not None:
            self.chain.append(
                action_type=f"component_result:{component_name}",
                scope=str(outputs)[:256],
            )

    def wrap_component(self, component_name: str) -> Callable:
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                self.chain.append(
                    action_type=f"component:{component_name}",
                    scope=str(kwargs)[:256] if kwargs else str(args)[:256],
                )
                try:
                    result = func(*args, **kwargs)
                    self.chain.append(
                        action_type=f"component_result:{component_name}",
                        scope=str(result)[:256] if result else "",
                    )
                    return result
                except Exception as e:
                    self.chain.append(
                        action_type=f"component_error:{component_name}",
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
