# nobulex-crewai-example.py
# Article 12-grade audit trail for CrewAI crews.
# pip install nobulex

from nobulex.integrations.crewai import NobulexCrewAudit

audit = NobulexCrewAudit(agent_id="my-crew")

# record tasks as they execute
audit.record_task("credit_check", "loan-app-4821")
audit.record_tool_call("db_query", "SELECT credit_score FROM users WHERE id=4821")
audit.record_task("approve_loan", "amount=50000 currency=EUR")

# or use the decorator
@audit.on_task
def generate_report():
    return "compliance report for Q3"

generate_report()

# export signed audit trail
audit.export("audit.json")

# any third party can verify, trusting no operator
from nobulex.chain import verify_audit_trail
report = verify_audit_trail("audit.json", authorized_keys=audit.public_key)
assert report["chain_intact"] and report["authenticated"]
