# nobulex-google-adk-example.py
# Article 12-grade audit trail for Google ADK agents.
# pip install nobulex

from nobulex.integrations.google_adk import NobulexADKCallback

cb = NobulexADKCallback(agent_id="my-agent")

# wrap any tool function with receipt emission
@cb.wrap_tool("credit_check")
def check_credit(user_id: str):
    return {"score": 720, "risk": "low"}

# or record manually
cb.on_tool_start("web_search", {"query": "EU AI Act Article 12"})
cb.on_tool_end("web_search", "found 5 results")

# run the wrapped tool
check_credit(user_id="4821")

# export signed audit trail
cb.export("audit.json")

# any third party can verify, trusting no operator
from nobulex.chain import verify_audit_trail
report = verify_audit_trail("audit.json", authorized_keys=cb.public_key)
assert report["chain_intact"] and report["authenticated"]
