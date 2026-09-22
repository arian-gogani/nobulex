# Dify Workflow Template: Article 12 Evidence Collection

This template shows how to wire nobulex into a Dify workflow that is
collecting signed technical records for an Article 12 review.

## Node structure

```
Input Node
  └── Tool Call Node (e.g. web_search)
        └── nobulex/sign_receipt (action_type, scope, policy_version)
  └── Tool Call Node (next tool)
        └── nobulex/sign_receipt (action_type, scope, policy_version)
  └── nobulex/export_article12 (include_policy_mapping: true)
  └── Output Node
        ├── task_result
        └── compliance_package (store to immutable storage)
```

## Each sign_receipt node

- `action_type`: what the agent did (match your tool name)
- `scope`: what resource it touched (URL, email, DB table, etc.)
- `policy_version`: which policy governed this (optional but recommended)

## What this contributes to an Article 12 review

The export_article12 package contains:
- All Ed25519-signed receipts for the session
- Chain head hash (auditor recomputes from receipts to verify)
- Technical context about Article 12 logging capabilities

A reviewer can check the exported chain offline with the agent's public key.
The chain breaks if an included receipt is altered. This does not prove that
every event was captured, that an external action occurred, or that the system
complies with Article 12.
