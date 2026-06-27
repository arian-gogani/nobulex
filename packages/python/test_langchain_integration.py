"""Tests for the LangChain integration."""
import json
import tempfile

from nobulex.integrations.langchain import NobulexAuditHandler
from nobulex.chain import verify_audit_trail


def test_handler_emits_receipts_on_tool_calls():
    handler = NobulexAuditHandler(agent_id="test-agent")
    handler.on_tool_start({"name": "sql_query"}, "SELECT * FROM users")
    handler.on_tool_start({"name": "send_email"}, "to=bob@co.com")
    assert len(handler.chain._chain) == 2


def test_exported_trail_verifies():
    handler = NobulexAuditHandler(agent_id="test-agent")
    handler.on_tool_start({"name": "credit_check"}, "user_id=4821")
    handler.on_tool_start({"name": "approve_loan"}, "amount=50000")

    path = tempfile.mktemp(suffix=".json")
    handler.export(path)

    report = verify_audit_trail(path, authorized_keys=handler.public_key)
    assert report["chain_intact"] is True
    assert report["authenticated"] is True


def test_tool_error_is_recorded():
    handler = NobulexAuditHandler(agent_id="test-agent")
    handler.on_tool_start({"name": "api_call"}, "POST /payments")
    handler.on_tool_error(RuntimeError("connection refused"))
    assert len(handler.chain._chain) == 2
    last = handler.chain._chain[-1]["receipt"]
    assert last.action_type == "tool_error"


def test_verify_rejects_wrong_key():
    handler = NobulexAuditHandler(agent_id="test-agent")
    handler.on_tool_start({"name": "query"}, "data")

    other = NobulexAuditHandler(agent_id="other")
    other.on_tool_start({"name": "x"}, "y")

    path = tempfile.mktemp(suffix=".json")
    handler.export(path)

    report = verify_audit_trail(path, authorized_keys=other.public_key)
    assert report["chain_intact"] is False
