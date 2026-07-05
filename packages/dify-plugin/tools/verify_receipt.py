"""Nobulex — verify_receipt tool. Built on `pip install nobulex`."""

from __future__ import annotations

import json
from typing import Any, Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage


class VerifyReceiptTool(Tool):
    """Verify a receipt's signature and chain integrity."""

    def _invoke(
        self,
        tool_parameters: dict[str, Any],
    ) -> Generator[ToolInvokeMessage, None, None]:
        receipt_json: str = tool_parameters["receipt_json"]

        try:
            from nobulex.receipt import Receipt

            receipt_dict = json.loads(receipt_json)
            receipt = Receipt.from_dict(receipt_dict)
            valid = receipt.verify()
            reason = None if valid else "signature_invalid"
        except json.JSONDecodeError:
            valid = False
            reason = "malformed"
        except Exception as exc:
            valid = False
            reason = f"error: {exc}"

        yield self.create_json_message({"valid": valid, "reason": reason})
