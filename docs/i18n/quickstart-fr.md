# Démarrage rapide Nobulex

Générez votre premier reçu infalsifiable en 60 secondes.

## Installation

```bash
# en attendant la publication sur PyPI, installez depuis les sources :
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python && pip install -e .
```

## Générer un reçu

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")

print(receipt.action_ref)    # empreinte SHA-256 de l'action
print(receipt.verify())      # True, la signature est valide
print(receipt.to_json())     # le reçu complet en JSON
```

## Détection d'altération

```python
receipt.scope = "TAMPERED"
print(receipt.verify())      # False, la signature est rompue
```

## Chaînes de reçus

```python
from nobulex.chain import ReceiptChain

chain = ReceiptChain("my-agent")
chain.append("authenticate", scope="api.stripe.com")
chain.append("create_payment", scope="100_USD")
chain.append("send_notification", scope="user@co.com")

print(chain.verify())        # True, la chaîne entière est intacte
chain.export("audit.json")   # export destiné aux auditeurs
```

## Intégration LangChain

```python
from nobulex.langchain import NobuReceipts

tracker = NobuReceipts(agent_id="langchain-bot")

# À utiliser comme callback sur n'importe quel agent LangChain
agent.invoke(input, config={"callbacks": [tracker]})

print(tracker.receipts)      # un reçu signé par appel d'outil
print(tracker.trust_score)
```

## Vecteurs de test

Validés de façon croisée sur 4 implémentations JCS (Python, JS, Go, Java) :

```
fixtures/bilateral-receipt/v0/vectors.json
```

## Liens

- [GitHub](https://github.com/arian-gogani/nobulex)
- [Site web](https://nobulex.com)
- [Documentation](https://nobulex.com/docs)
