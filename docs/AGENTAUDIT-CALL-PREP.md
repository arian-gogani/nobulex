# AgentAudit AI Integration Call - Wednesday 10am PT

## Attendees
- Arian Gogani (Nobulex)
- Piotr (AgentAudit AI / RunLockAI, UTC+0 Iceland)

## Agenda
1. MCP server anchoring endpoint spec
2. ERC-XHRON IComplianceEvaluator mapping
3. Distribution model - receipts from any MCP-compatible agent
4. Receipt schema version contract

## What we know works
- action_ref reproduces correctly as bytes32 logHash in verifyLog
- Merkle pipeline works end to end
- DENY receipts anchor identically to ALLOW
- Test file: test/AuditVaultActionRef.t.sol (commit f538c13)

## Three structural gaps (none blocking)
1. agent_id string -> address: off-chain registry bridge
2. timestamp_ms vs block.timestamp: reconcile via contentURI (both meaningful)
3. SHA-256/keccak256 hybrid: receipt uses SHA-256, contract uses keccak256. contentURI bridges.

## Receipt format (STABLE)
Preimage fields (locked):
- agent_id: string
- action_type: string
- scope: string
- timestamp_ms: integer

Optional siblings (outside preimage):
- policy_version: string
- attempt_id: string
- authority_verified_at_ms: integer
- revocation_check_at_ms: integer
- revocation_status: string

## Key questions to resolve
1. Which optional fields should the MCP server expose?
2. How does the MCP server discovery work? (agent finds anchoring endpoint)
3. What's the gas cost model for anchoring?
4. Batch anchoring vs per-receipt anchoring?
5. Privacy: when should ZK proofs be used over full receipt?

## Integration flow
```
Agent -> nobulex SDK -> receipt JSON
                          |
                          v
              AgentAudit MCP Server
                          |
                          v
              AuditVault contract (Base/Arb/OP/Poly/Mantle)
                          |
                          v
              ZKAuditProof.sol (optional privacy layer)
```

## What to ship after the call
- Integration spec document (GitHub issue or PR)
- Working proof of concept
- Demo: generate receipt -> anchor on-chain -> verify
