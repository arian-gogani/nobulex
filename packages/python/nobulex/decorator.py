"""Universal decorator for adding receipts to any function.

Works with any Python function, any framework, any agent:

    from nobulex.decorator import track

    @track(agent_id="my-agent")
    def send_email(to, subject, body):
        # your code here
        return "sent"

    # Every call now generates a tamper-proof receipt
    result = send_email("user@example.com", "Hello", "World")
    
    # Access receipts
    print(send_email.receipts)
    print(send_email.trust_score)
"""

import functools
from typing import Optional, Callable, Any
from nobulex.agent import Agent
from nobulex.receipt import Receipt


def track(
    agent_id: str = "tracked-agent",
    action_type: Optional[str] = None,
) -> Callable:
    """
    Decorator that generates a receipt for every function call.

    Args:
        agent_id: Identifier for the agent
        action_type: Override action name (defaults to function name)

    The decorated function gains these attributes:
        .receipts: List of all receipts
        .trust_score: Current trust score score
        .agent: The underlying Agent object
        .last_receipt: Most recent receipt

    Usage:
        @track("my-bot")
        def process_order(order_id):
            return do_something(order_id)

        result = process_order("ORD-123")
        print(process_order.last_receipt)  # Receipt(...)
        print(process_order.trust_score)   # 13.86
    """
    agent = Agent(agent_id)

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            action = action_type or func.__name__
            scope = f"args:{str(args)[:100]}"

            try:
                result = func(*args, **kwargs)
                receipt = agent.act(action, scope=scope)
                wrapper.last_receipt = receipt
                return result
            except Exception as e:
                receipt = agent.deny(
                    action, scope=f"error:{str(e)[:100]}"
                )
                wrapper.last_receipt = receipt
                raise

        wrapper.agent = agent
        wrapper.receipts = agent.receipts
        wrapper.trust_score = property(lambda self: agent.trust_score)

        # Make trust_score accessible as attribute
        class TrackedFunc:
            def __call__(self, *args, **kwargs):
                return wrapper(*args, **kwargs)

            @property
            def receipts(self):
                return agent.receipts

            @property
            def trust_score(self):
                return agent.trust_score

            @property
            def agent(self):
                return agent

            @property
            def last_receipt(self):
                return getattr(wrapper, 'last_receipt', None)

            def __getattr__(self, name):
                return getattr(func, name)

        tracked = TrackedFunc()
        tracked.__name__ = func.__name__
        tracked.__doc__ = func.__doc__
        return tracked

    return decorator
