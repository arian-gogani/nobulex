from nobulex.integrations.google_adk import NobulexADKCallback
from nobulex.chain import verify_audit_trail
import tempfile

cb = NobulexADKCallback(agent_id="adk-agent")
cb.on_tool_start("web_search", {"query": "EU AI Act"})
cb.on_tool_end("web_search", "found results")

@cb.wrap_tool("calculate")
def calc(x, y):
    return x + y

calc(3, 4)

path = tempfile.mktemp(suffix=".json")
cb.export(path)
report = verify_audit_trail(path, authorized_keys=cb.public_key)

print(f"receipts: {len(cb.chain._chain)}")
print(f"chain_intact: {report['chain_intact']}")
print(f"authenticated: {report['authenticated']}")
print("PASS" if report["chain_intact"] and report["authenticated"] else "FAIL")
