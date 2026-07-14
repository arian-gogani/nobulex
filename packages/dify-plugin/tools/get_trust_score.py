"""Nobulex - get_trust_score tool. Built on `pip install nobulex`."""

from __future__ import annotations

from typing import Any, Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

try:  # loaded as tools.get_trust_score
    from ._state import chains, get_agent
except Exception:  # pragma: no cover
    try:
        from tools._state import chains, get_agent
    except Exception:
        from _state import chains, get_agent


class GetTrustScoreTool(Tool):
    """Get the current Trust Capital score for this agent."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        agent_id = tool_parameters.get("agent_id") or (
            self.runtime.credentials.get("agent_id") or "dify-agent"
        )

        # Compute score from the local chain if one exists.
        # In production this would query a remote Trust Capital store.
        if agent_id in chains:
            chain = chains[agent_id]
            agent_obj = get_agent(agent_id)
            score = getattr(agent_obj, "trust_score", 50.0)
            receipt_count = chain.length

            if score <= 25:
                tier = "Restricted"
            elif score <= 50:
                tier = "Standard"
            elif score <= 75:
                tier = "Trusted"
            else:
                tier = "Sovereign"
        else:
            score = 50.0
            tier = "Standard"
            receipt_count = 0

        yield self.create_json_message(
            {
                "trust_score": round(score, 2),
                "tier": tier,
                "receipt_count": receipt_count,
                "deny_rate": 0.0,
                "observation_window_days": 30,
            }
        )
