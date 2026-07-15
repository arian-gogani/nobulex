"""
Nobulex - trust score for AI Agents

Tamper-proof receipts for everything your AI agent does.
Credit scores for machines.

Usage:
    from nobulex import Agent, Receipt

    # Create an agent identity
    agent = Agent("my-agent")

    # Generate a receipt for any action
    receipt = agent.act("send_email", scope="user@example.com")

    # Verify any receipt
    assert receipt.verify()

    # Get trust score
    print(agent.trust_score)
"""

from nobulex.agent import Agent
from nobulex.receipt import Receipt
from nobulex.trust import TrustLedger
from nobulex.crypto import KeyPair, ES256KeyPair
from nobulex.decorator import track

__version__ = "0.1.1"
__all__ = ["Agent", "Receipt", "TrustLedger", "KeyPair", "ES256KeyPair", "track"]
