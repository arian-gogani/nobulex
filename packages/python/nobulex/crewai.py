"""CrewAI integration for Nobulex receipts.

Add tamper-proof receipts to any CrewAI crew:

    from nobulex.crewai import NobuCrewTracker
    tracker = NobuCrewTracker("my-crew")
    
    # Track agent actions
    tracker.on_task_start(agent_name="researcher", task="find data")
    tracker.on_task_complete(agent_name="researcher", task="find data", result="found 10 results")
    tracker.on_task_fail(agent_name="writer", task="write report", error="timeout")
    
    print(tracker.trust_scores)  # Per-agent trust scores
"""

from typing import Dict, List, Optional
from nobulex.agent import Agent
from nobulex.receipt import Receipt
from nobulex.trust import TrustLedger


class NobuCrewTracker:
    """Track trust across a crew of AI agents."""

    def __init__(self, crew_id: str = "crewai-crew"):
        self.crew_id = crew_id
        self._agents: Dict[str, Agent] = {}
        self._all_receipts: List[Receipt] = []

    def _get_agent(self, agent_name: str) -> Agent:
        if agent_name not in self._agents:
            agent_id = f"{self.crew_id}:{agent_name}"
            self._agents[agent_name] = Agent(agent_id)
        return self._agents[agent_name]

    def on_task_start(
        self, agent_name: str, task: str, metadata: Optional[dict] = None
    ) -> Receipt:
        agent = self._get_agent(agent_name)
        receipt = agent.act(
            action_type=f"task:{task}",
            scope=f"crew:{self.crew_id}",
            metadata=metadata or {},
        )
        self._all_receipts.append(receipt)
        return receipt

    def on_task_complete(
        self, agent_name: str, task: str, result: str = "", metadata: Optional[dict] = None
    ) -> Receipt:
        agent = self._get_agent(agent_name)
        meta = metadata or {}
        meta["result_preview"] = result[:200]
        receipt = agent.act(
            action_type=f"complete:{task}",
            scope=f"crew:{self.crew_id}",
            metadata=meta,
        )
        self._all_receipts.append(receipt)
        return receipt

    def on_task_fail(
        self, agent_name: str, task: str, error: str = "", metadata: Optional[dict] = None
    ) -> Receipt:
        agent = self._get_agent(agent_name)
        meta = metadata or {}
        meta["error"] = error[:200]
        receipt = agent.deny(
            action_type=f"fail:{task}",
            scope=f"crew:{self.crew_id}",
            metadata=meta,
        )
        self._all_receipts.append(receipt)
        return receipt

    @property
    def trust_scores(self) -> Dict[str, float]:
        return {name: a.trust_score for name, a in self._agents.items()}

    @property
    def receipts(self) -> List[Receipt]:
        return list(self._all_receipts)

    @property
    def agent_names(self) -> List[str]:
        return list(self._agents.keys())

    def summary(self) -> str:
        lines = [f"Crew: {self.crew_id}", f"Agents: {len(self._agents)}", f"Total receipts: {len(self._all_receipts)}", ""]
        for name, agent in self._agents.items():
            n = len(agent.receipts)
            lines.append(f"  {name}: {n} receipts, trust={agent.trust_score:.1f}")
        return "\n".join(lines)
