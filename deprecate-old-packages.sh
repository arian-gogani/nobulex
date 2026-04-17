#!/bin/bash
# Nobulex npm cleanup — deprecate all old packages
# KEEP: core, sdk, mcp-server, a2a, langchain
# Run: npm login && bash deprecate-old-packages.sh

MSG="Consolidated into @nobulex/core in v1.0.0. Use @nobulex/sdk instead."

DEPRECATE=(
  attestation breach canary ccl certification cli
  compliance-autopilot consensus enforcement mcp
  negotiation norms proof rail reputation revenue
  robustness store substrate crypto derivatives
  action-log alignment core-types identity
  middleware verification composability types
  independent-verifier trust-physics react
  elizaos-plugin evm otel tee transparency-log
  merkle evidence-core covenant-lang quickstart
  benchmark web3 governance monitor telemetry
  sandbox testkit bridge adapter config logger
  plugin-sdk agent-runtime policy-engine
)

echo "Deprecating ${#DEPRECATE[@]} packages..."
echo ""

for pkg in "${DEPRECATE[@]}"; do
  npm deprecate "@nobulex/$pkg" "$MSG" 2>/dev/null && echo "✅ @nobulex/$pkg" || echo "⏭️  @nobulex/$pkg (not found or already deprecated)"
done

echo ""
echo "Done. Active packages: core, sdk, mcp-server, a2a, langchain"
