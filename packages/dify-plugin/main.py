from dify_plugin import DifyPluginEnv, Plugin

from tools.nobulex import (
    SignReceiptTool,
    VerifyReceiptTool,
    ExportArticle12Tool,
    GetTrustScoreTool,
)

plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=120))

plugin.tool("sign_receipt")(SignReceiptTool)
plugin.tool("verify_receipt")(VerifyReceiptTool)
plugin.tool("export_article12")(ExportArticle12Tool)
plugin.tool("get_trust_score")(GetTrustScoreTool)

if __name__ == "__main__":
    plugin.run()
