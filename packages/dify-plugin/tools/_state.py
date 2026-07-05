"""
Shared, session-scoped state for the Nobulex Dify tools.

All four tools live in their own module (the marketplace loader requires exactly
one Tool subclass per source file), but they must share one set of receipt
chains so that sign_receipt / export_article12 / get_trust_score all see the
same history. That shared state lives here and is imported by each tool.
"""

from __future__ import annotations

from nobulex.agent import Agent
from nobulex.chain import ReceiptChain

# Keyed by agent_id. One plugin process serves one session, so an in-memory
# store is sufficient for session-scoped chains.
agents: dict[str, Agent] = {}
chains: dict[str, ReceiptChain] = {}


def get_agent(agent_id: str) -> Agent:
    if agent_id not in agents:
        agents[agent_id] = Agent(agent_id)
    return agents[agent_id]


def get_chain(agent_id: str) -> ReceiptChain:
    if agent_id not in chains:
        chains[agent_id] = ReceiptChain(agent_id=agent_id)
    return chains[agent_id]
