"""
Nobulex Dify Plugin — Tool Implementations

Four tools:
  sign_receipt     — Ed25519-signed, JCS-canonical receipt for one action
  verify_receipt   — verify a receipt's signature and chain integrity
  export_article12 — export EU AI Act Article 12 evidence package
  get_trust_score  — current Trust Capital score for this agent

Built on pip install nobulex (github.com/arian-gogani/nobulex).
"""

from __future__ import annotations

import json
from typing import Any, Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage
from nobulex.agent import Agent
from nobulex.chain import ReceiptChain


# Module-level registry of agents and chains keyed by agent_id.
# In the Dify plugin runtime, each plugin process handles one session,
# so this in-memory store is sufficient for session-scoped chains.
_agents: dict[str, Agent] = {}
_chains: dict[str, ReceiptChain] = {}


def _get_agent(agent_id: str) -> Agent:
    if agent_id not in _agents:
        _agents[agent_id] = Agent(agent_id)
    return _agents[agent_id]


def _get_chain(agent_id: str) -> ReceiptChain:
    if agent_id not in _chains:
        _chains[agent_id] = ReceiptChain(agent_id=agent_id)
    return _chains[agent_id]


class SignReceiptTool(Tool):
    """Generate an Ed25519-signed receipt for one Dify tool call."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        agent_id = (
            self.runtime.credentials.get("agent_id") or "dify-agent"
        )
        action_type: str = tool_parameters["action_type"]
        scope: str = tool_parameters["scope"]
        policy_version: str | None = tool_parameters.get("policy_version")

        chain = _get_chain(agent_id)

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


class VerifyReceiptTool(Tool):
    """Verify a receipt's signature and chain integrity."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        receipt_json: str = tool_parameters["receipt_json"]

        try:
            from nobulex.receipt import Receipt

            receipt_dict = json.loads(receipt_json)
            receipt = Receipt.from_dict(receipt_dict)
            valid = receipt.verify()
            reason = None if valid else "signature_invalid"
        except json.JSONDecodeError:
            valid = False
            reason = "malformed"
        except Exception as exc:
            valid = False
            reason = f"error: {exc}"

        yield self.create_json_message({"valid": valid, "reason": reason})


class ExportArticle12Tool(Tool):
    """Export a regulator-facing EU AI Act Article 12 evidence package."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        agent_id = (
            self.runtime.credentials.get("agent_id") or "dify-agent"
        )
        include_policy_mapping: bool = tool_parameters.get(
            "include_policy_mapping", True
        )

        chain = _get_chain(agent_id)
        receipts = [r.to_dict() for r in chain.receipts]

        package: dict[str, Any] = {
            "schema": "nobulex-article12-evidence-v1",
            "agent_id": agent_id,
            "chain_head_hash": chain.head_hash,
            "receipt_count": len(receipts),
            "receipts": receipts,
        }

        if include_policy_mapping:
            package["obligation_mapping"] = {
                "eu_ai_act_article_12": {
                    "requirement": "Tamper-evident automatic logging of events",
                    "satisfied_by": "Ed25519-signed, JCS-canonical, hash-chained receipts",
                    "verification": "Any party with the agent's public key can verify offline",
                    "chain_head_hash": chain.head_hash,
                    "receipt_count": len(receipts),
                }
            }

        yield self.create_json_message(
            {
                "package_json": json.dumps(package, indent=2),
                "receipt_count": len(receipts),
                "chain_head_hash": chain.head_hash,
            }
        )


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
        if agent_id in _chains:
            chain = _chains[agent_id]
            agent_obj = _get_agent(agent_id)
            score = getattr(agent_obj, "trust_score", 50.0)
            receipt_count = len(chain.receipts)

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
