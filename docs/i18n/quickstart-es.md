# Guía rápida de Nobulex

Genera tu primer recibo a prueba de manipulaciones en 60 segundos.

## Instalación

```bash
# hasta que se publique en PyPI, instala desde el código fuente:
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python && pip install -e .
```

## Generar un recibo

```python
from nobulex import Agent

agent = Agent("my-agent")
receipt = agent.act("send_email", scope="user@example.com")

print(receipt.action_ref)    # hash SHA-256 de la acción
print(receipt.verify())      # True, la firma es válida
print(receipt.to_json())     # el recibo completo en JSON
```

## Detección de manipulación

```python
receipt.scope = "TAMPERED"
print(receipt.verify())      # False, la firma se rompe
```

## Cadenas de recibos

```python
from nobulex.chain import ReceiptChain

chain = ReceiptChain("my-agent")
chain.append("authenticate", scope="api.stripe.com")
chain.append("create_payment", scope="100_USD")
chain.append("send_notification", scope="user@co.com")

print(chain.verify())        # True, la cadena entera está intacta
chain.export("audit.json")   # exportación para auditores
```

## Integración con LangChain

```python
from nobulex.langchain import NobuReceipts

tracker = NobuReceipts(agent_id="langchain-bot")

# Úsalo como callback en cualquier agente de LangChain
agent.invoke(input, config={"callbacks": [tracker]})

print(tracker.receipts)      # un recibo firmado por cada llamada a herramienta
print(tracker.trust_score)
```

## Vectores de prueba

Validados de forma cruzada en 4 implementaciones de JCS (Python, JS, Go, Java):

```
fixtures/bilateral-receipt/v0/vectors.json
```

## Enlaces

- [GitHub](https://github.com/arian-gogani/nobulex)
- [Sitio web](https://nobulex.com)
- [Documentación](https://nobulex.com/docs)
