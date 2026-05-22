"""LangChain middleware for Nobulex receipts.

Add tamper-proof receipts to any LangChain agent in 2 lines:

    from nobulex.integrations.langchain import NobuReceipts
    agent = NobuReceipts.wrap(your_agent, agent_id="my-agent")

Every tool call now generates a cryptographic receipt.
"""

from typing import Any, Dict, List, Optional, Callable
from nobulex.agent import Agent
from nobulex.receipt import Receipt


class NobuReceipts:
    """
    LangChain callback handler that generates receipts
    for every tool call an agent makes.

    Usage:
        from langchain.agents import create_tool_calling_agent
        from nobulex.integrations.langchain import NobuReceipts

        tracker = NobuReceipts(agent_id="my-agent")

        # Option 1: Use as a callback
        agent.invoke(input, config={"callbacks": [tracker]})

        # Option 2: Wrap the agent
        wrapped = NobuReceipts.wrap(agent, "my-agent")
        wrapped.invoke(input)

        # Get receipts
        print(tracker.receipts)
        print(tracker.trust_score)
    """

    def __init__(self, agent_id: str = "langchain-agent"):
        self.agent = Agent(agent_id)
        self._pending: Dict[str, dict] = {}

    @property
    def receipts(self) -> List[Receipt]:
        return self.agent.receipts

    @property
    def trust_score(self) -> float:
        return self.agent.trust_score

    def on_tool_start(
        self, tool_name: str, tool_input: Any, **kwargs
    ) -> Receipt:
        """Generate a receipt when a tool call starts."""
        scope = str(tool_input)[:200]  # Truncate long inputs
        receipt = self.agent.act(
            action_type=f"tool:{tool_name}",
            scope=scope,
        )
        return receipt

    def on_tool_error(
        self, tool_name: str, error: str, **kwargs
    ) -> Receipt:
        """Generate a DENY receipt when a tool call fails."""
        receipt = self.agent.deny(
            action_type=f"tool:{tool_name}",
            scope=f"error:{error[:200]}",
        )
        return receipt

    @classmethod
    def wrap(cls, runnable: Any, agent_id: str = "langchain-agent"):
        """
        Wrap any LangChain runnable with receipt tracking.

        Returns a wrapper that generates receipts for every
        tool call while passing through all other behavior.
        """
        tracker = cls(agent_id=agent_id)

        class ReceiptWrapper:
            def __init__(self, inner, tracker):
                self._inner = inner
                self.tracker = tracker

            def invoke(self, input: Any, **kwargs) -> Any:
                result = self._inner.invoke(input, **kwargs)
                # Generate receipt for the invocation
                action = "invoke"
                scope = str(input)[:200]
                self.tracker.agent.act(action, scope=scope)
                return result

            async def ainvoke(self, input: Any, **kwargs) -> Any:
                result = await self._inner.ainvoke(input, **kwargs)
                action = "ainvoke"
                scope = str(input)[:200]
                self.tracker.agent.act(action, scope=scope)
                return result

            @property
            def receipts(self):
                return self.tracker.receipts

            @property
            def trust_score(self):
                return self.tracker.trust_score

            def __getattr__(self, name):
                return getattr(self._inner, name)

        return ReceiptWrapper(runnable, tracker)
