"""Nobulex tool provider."""

from __future__ import annotations

from typing import Any

from dify_plugin import ToolProvider


class NobulexProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        # agent_id is optional free-text used to key the receipt chain;
        # there is nothing to validate against a remote service.
        return
