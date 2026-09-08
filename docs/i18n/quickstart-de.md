# Nobulex Schnellstart

Erzeugen Sie Ihre erste fälschungssichere Quittung in 60 Sekunden.

## Installation

```bash
# bis die PyPI-Veröffentlichung erfolgt ist, aus dem Quellcode installieren:
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python && pip install -e .
```

## Eine Quittung erzeugen

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")

print(receipt.action_ref)    # SHA-256-Hash der Aktion
print(receipt.verify())      # True, die Signatur ist gültig
print(receipt.to_json())     # die vollständige Quittung als JSON
```

## Manipulationserkennung

```python
receipt.scope = "TAMPERED"
print(receipt.verify())      # False, die Signatur bricht
```

## Quittungsketten

```python
from nobulex.chain import ReceiptChain

chain = ReceiptChain("my-agent")
chain.append("authenticate", scope="api.stripe.com")
chain.append("create_payment", scope="100_USD")
chain.append("send_notification", scope="user@co.com")

print(chain.verify())        # True, die gesamte Kette ist unversehrt
chain.export("audit.json")   # Export für Prüferinnen und Prüfer
```

## LangChain-Integration

```python
from nobulex.langchain import NobuReceipts

tracker = NobuReceipts(agent_id="langchain-bot")

# Als Callback für einen beliebigen LangChain-Agenten verwenden
agent.invoke(input, config={"callbacks": [tracker]})

print(tracker.receipts)      # eine signierte Quittung pro Werkzeugaufruf
print(tracker.trust_score)
```

## Testvektoren

Kreuzweise validiert über 4 JCS-Implementierungen (Python, JS, Go, Java):

```
fixtures/bilateral-receipt/v0/vectors.json
```

## Links

- [GitHub](https://github.com/arian-gogani/nobulex)
- [Website](https://nobulex.com)
- [Dokumentation](https://nobulex.com/docs)
