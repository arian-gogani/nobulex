from nobulex.integrations.crewai import NobulexCrewAudit
from nobulex.chain import verify_audit_trail
import tempfile

audit = NobulexCrewAudit(agent_id="research-crew")
audit.record_task("market_research", "competitor analysis EU fintech")
audit.record_tool_call("web_search", "EU AI Act Article 12")
audit.record_task("report_gen", "quarterly compliance report")

@audit.on_task
def analyze_data():
    return "found 3 compliance gaps"

analyze_data()

path = tempfile.mktemp(suffix=".json")
audit.export(path)
report = verify_audit_trail(path, authorized_keys=audit.public_key)

p = 0
f = 0
def c(label, cond):
    global p, f
    if cond:
        p += 1
        print("PASS", label)
    else:
        f += 1
        print("FAIL", label)

c("4 receipts", len(audit.chain._chain) == 4)
c("chain_intact", report["chain_intact"] is True)
c("authenticated", report["authenticated"] is True)
c("decorator recorded", audit.chain._chain[-1]["receipt"].action_type == "task:analyze_data")
other = NobulexCrewAudit(agent_id="attacker")
other.record_task("fake", "forged")
c("wrong key rejected", not other.verify(audit.public_key))
print(f"\nRESULT: {p} passed, {f} failed")
