# Dify Workflow Template: EU AI Act Article 12 Compliance Agent

This template shows how to wire nobulex into a Dify workflow that is
EU AI Act Article 12 compliant out of the box.

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

## Why this satisfies EU AI Act Article 12

The export_article12 package contains:
- All Ed25519-signed receipts for the session
- Chain head hash (auditor recomputes from receipts to verify)
- EU AI Act Article 12 obligation mapping

Any auditor can verify offline  - no vendor dependency, no operator trust required.
The chain breaks if any receipt is altered. EU AI Act Article 12 enforcement: December 2, 2027.
