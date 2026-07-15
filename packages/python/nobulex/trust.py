"""trust score scoring for Nobulex agents."""

from collections import defaultdict
from typing import Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from nobulex.receipt import Receipt


class TrustLedger:
    """
    Computes trust score scores from receipt history.

    trust score is the credit score for machines.
    It's earned through verified behavior, not granted.
    You can copy the code, but you can't copy the score.

    Scoring rules:
    - Each ALLOW receipt adds trust (+1.0)
    - Each DENY receipt proves the system caught a
      violation, slight trust boost (+0.2)
    - Score decays over time without new receipts
    - Score is bounded [0.0, 100.0]
    """

    def __init__(self):
        self._receipts: Dict[str, list] = defaultdict(list)

    def record(self, receipt: "Receipt") -> None:
        """Record a receipt in the ledger."""
        self._receipts[receipt.agent_id].append(receipt)

    def score(self, agent_id: str) -> float:
        """
        Compute trust score score for an agent.

        Returns a score between 0.0 and 100.0.
        """
        receipts = self._receipts.get(agent_id, [])
        if not receipts:
            return 0.0

        raw = 0.0
        for r in receipts:
            if r.verdict == "ALLOW":
                raw += 1.0
            elif r.verdict == "DENY":
                raw += 0.2  # Caught violation = slight trust

        # Logarithmic scaling: diminishing returns
        import math
        scaled = 20.0 * math.log1p(raw)

        return min(100.0, round(scaled, 2))

    def history(self, agent_id: str) -> List["Receipt"]:
        """Get all receipts for an agent."""
        return list(self._receipts.get(agent_id, []))

    def agent_count(self) -> int:
        """Number of agents tracked."""
        return len(self._receipts)

    def receipt_count(self, agent_id: str = "") -> int:
        """Total receipts, or receipts for a specific agent."""
        if agent_id:
            return len(self._receipts.get(agent_id, []))
        return sum(len(r) for r in self._receipts.values())
