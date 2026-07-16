"""Agent identity and receipt management for Nobulex."""

import time
from typing import List, Optional

from nobulex.crypto import KeyPair
from nobulex.receipt import Receipt
from nobulex.trust import TrustLedger


class Agent:
    """
    An AI agent with a cryptographic identity and trust history.

    Usage:
        agent = Agent("my-agent")
        receipt = agent.act("send_email", scope="user@example.com")
        assert receipt.verify()
        print(agent.trust_score)
    """

    def __init__(self, agent_id: str, keys: Optional[KeyPair] = None, publish: bool = False):
        self.agent_id = agent_id
        self.keys = keys or KeyPair()
        self._ledger = TrustLedger()
        self._receipts: List[Receipt] = []
        self._publish = publish
        self._api_url = "https://nobulex.com/api/verify"

    @property
    def public_key(self) -> str:
        return self.keys.public_hex

    @property
    def trust_score(self) -> float:
        return self._ledger.score(self.agent_id)

    @property
    def receipts(self) -> List[Receipt]:
        return list(self._receipts)

    def act(
        self,
        action_type: str,
        scope: str,
        verdict: str = "ALLOW",
        metadata: Optional[dict] = None,
    ) -> Receipt:
        """
        Record an agent action and generate a signed receipt.

        Args:
            action_type: What the agent did (e.g., "send_email")
            scope: What resource was acted on
            verdict: "ALLOW" or "DENY"
            metadata: Optional extra data

        Returns:
            A signed, verifiable Receipt
        """
        receipt = Receipt.create(
            agent_id=self.agent_id,
            action_type=action_type,
            scope=scope,
            keys=self.keys,
            verdict=verdict,
            metadata=metadata,
        )
        self._receipts.append(receipt)
        self._ledger.record(receipt)
        if self._publish:
            self._publish_receipt(receipt)
        return receipt

    def deny(
        self, action_type: str, scope: str, metadata: Optional[dict] = None
    ) -> Receipt:
        """Record a denied action. Proves the system caught a violation."""
        return self.act(action_type, scope, verdict="DENY", metadata=metadata)

    def verify_receipt(self, receipt: Receipt) -> bool:
        """Verify a receipt was signed by this agent."""
        return (
            receipt.verify()
            and receipt.signer_public_key == self.public_key
        )

    def __repr__(self) -> str:
        n = len(self._receipts)
        return (
            f"Agent(id={self.agent_id!r}, "
            f"receipts={n}, "
            f"trust_score={self.trust_score:.2f})"
        )

    def _publish_receipt(self, receipt: Receipt) -> None:
        """Publish a receipt to the hosted API (best-effort, non-blocking)."""
        import json
        import urllib.request
        try:
            data = json.dumps(receipt.to_dict()).encode()
            req = urllib.request.Request(
                self._api_url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass  # best-effort: never block the agent on a publish failure
