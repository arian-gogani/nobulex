# Nobulex Quickstart

Generate your first tamper-proof receipt in 60 seconds.

## Install

```bash
# until the PyPI release lands, install from source:
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python && pip install -e .
```

## Generate a Receipt

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")

print(receipt.action_ref)    # SHA-256 hash of the action
print(receipt.verify())      # True  - signature is valid
print(receipt.to_json())     # Full receipt as JSON
```

## Tamper Detection

```python
receipt.scope = "TAMPERED"
print(receipt.verify())      # False  - signature breaks
```

## Receipt Chains

```python
from nobulex.chain import ReceiptChain

chain = ReceiptChain("my-agent")
chain.append("authenticate", scope="api.stripe.com")
chain.append("create_payment", scope="100_USD")
chain.append("send_notification", scope="user@co.com")

print(chain.verify())        # True  - entire chain intact
chain.export("audit.json")   # Export for auditors
```

## LangChain Integration

```python
from nobulex.langchain import NobuReceipts

tracker = NobuReceipts(agent_id="langchain-bot")

# Use as a callback on any LangChain agent
agent.invoke(input, config={"callbacks": [tracker]})

print(tracker.receipts)      # signed receipt per tool call
print(tracker.trust_score)
```

## Test Vectors

Cross-validated across 4 JCS implementations (Python, JS, Go, Java):

```
fixtures/bilateral-receipt/v0/vectors.json
```

## Links

- [GitHub](https://github.com/arian-gogani/nobulex)
- [Website](https://nobulex.com)
- [Docs](https://nobulex.com/docs)
