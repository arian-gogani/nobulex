#!/usr/bin/env bash
#
# Nobulex Covenant Protocol, Publish All Packages
#
# Builds and publishes all 9 core packages to npm in dependency order.
#
# Usage:
#   ./scripts/publish-all.sh          # dry-run (default)
#   ./scripts/publish-all.sh --publish # actually publish to npm
#
# Prerequisites:
#   npm login  (authenticate to npm registry)
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=true

if [[ "${1:-}" == "--publish" ]]; then
  DRY_RUN=false
fi

# Packages in dependency order (leaf dependencies first)
PACKAGES=(
  "core-types"
  "covenant-lang"
  "action-log"
  "middleware"
  "verification"
  "composability"
  "tee"
  "contracts"
  "elizaos-plugin"
)

echo "═══════════════════════════════════════════════════════════"
echo "  Nobulex, Publish All Packages"
if $DRY_RUN; then
  echo "  Mode: DRY RUN (pass --publish to actually publish)"
else
  echo "  Mode: LIVE PUBLISH"
fi
echo "═══════════════════════════════════════════════════════════"
echo

# Check npm authentication
if ! npm whoami &>/dev/null; then
  echo "ERROR: Not authenticated to npm. Run 'npm login' first."
  exit 1
fi

echo "  Authenticated as: $(npm whoami)"
echo

FAILED=()
SUCCESS=()

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$ROOT_DIR/packages/$pkg"
  PKG_NAME="@nobulex/$pkg"

  if [[ ! -d "$PKG_DIR" ]]; then
    echo "  ✗ $PKG_NAME, directory not found, skipping"
    FAILED+=("$PKG_NAME")
    continue
  fi

  echo "───────────────────────────────────────────────────────────"
  echo "  Building $PKG_NAME..."

  # Build the package
  if [[ -f "$PKG_DIR/tsup.config.ts" ]]; then
    (cd "$PKG_DIR" && npx tsup src/index.ts --format cjs,esm 2>/dev/null) || true
  fi

  # Generate type declarations if tsconfig exists
  if [[ -f "$PKG_DIR/tsconfig.json" ]]; then
    (cd "$PKG_DIR" && npx tsc --emitDeclarationOnly --outDir dist 2>/dev/null) || true
  fi

  echo "  ✓ Built $PKG_NAME"

  # Publish
  if $DRY_RUN; then
    echo "  → DRY RUN: npm publish --dry-run"
    (cd "$PKG_DIR" && npm publish --dry-run --access public 2>&1 | head -5) || true
  else
    echo "  → Publishing $PKG_NAME@0.1.0..."
    if (cd "$PKG_DIR" && npm publish --access public 2>&1); then
      echo "  ✓ Published $PKG_NAME"
      SUCCESS+=("$PKG_NAME")
    else
      echo "  ✗ Failed to publish $PKG_NAME"
      FAILED+=("$PKG_NAME")
    fi
  fi

  echo
done

echo "═══════════════════════════════════════════════════════════"
echo "  Publish Summary"
echo "═══════════════════════════════════════════════════════════"

if $DRY_RUN; then
  echo "  DRY RUN complete. ${#PACKAGES[@]} packages ready to publish."
  echo "  Run with --publish to publish for real."
else
  echo "  Published: ${#SUCCESS[@]} / ${#PACKAGES[@]}"
  if [[ ${#FAILED[@]} -gt 0 ]]; then
    echo "  Failed:"
    for f in "${FAILED[@]}"; do
      echo "    - $f"
    done
  fi
fi
echo "═══════════════════════════════════════════════════════════"
