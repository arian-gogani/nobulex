# nobulex-langchain-example.py
# Article 12-grade audit trail for LangChain agents in 5 lines.
# pip install nobulex langchain-core

from nobulex.integrations.langchain import NobulexAuditHandler

handler = NobulexAuditHandler(agent_id="my-agent")
# pass handler as a callback to any LangChain agent:
# agent.invoke({"input": "..."}, config={"callbacks": [handler]})

# after the run, export the signed audit trail:
handler.export("audit.json")

# any third party can verify it, trusting no operator:
from nobulex.chain import verify_audit_trail
report = verify_audit_trail("audit.json", authorized_keys=handler.public_key)
assert report["chain_intact"] and report["authenticated"]
