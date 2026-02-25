#!/bin/bash
set -e
echo "=== Running tests ==="
npx vitest run
echo ""
echo "=== Pack dry-run ==="
for pkg in packages/*/; do
  name=$(basename "$pkg")
  echo "--- @nobulex/$name ---"
  cd "$pkg"
  npm pack --dry-run 2>&1 | tail -3
  cd ../..
done
echo ""
echo "=== All checks passed ==="
