#!/bin/bash
# Sign YC application and deploy receipt to nobulex.com
# Usage: ./deploy-yc-receipt.sh "your application text"

set -e

NOBULEX_DIR="/Users/ariangogani/github/nobulex"
WEB_DIR="/Users/ariangogani/github/nobulex-web"

if [ -z "$1" ]; then
  echo "Usage: $0 <pre|post|both> [content]"
  echo ""
  echo "  pre    - sign pre-execution (before submitting YC application)"
  echo "  post   - sign post-execution (after submitting YC application)"
  echo "  both   - example only, do NOT use for real (would sign and complete chain instantly)"
  exit 1
fi

MODE=$1
CONTENT=$2

cd "$NOBULEX_DIR"

if [ "$MODE" = "pre" ]; then
  echo "Signing pre-execution receipt..."
  node scripts/sign-yc-application.mjs pre "$CONTENT"
elif [ "$MODE" = "post" ]; then
  echo "Signing post-execution receipt..."
  node scripts/sign-yc-application.mjs post "${CONTENT:-submitted}"
elif [ "$MODE" = "verify" ]; then
  echo "Verifying receipt..."
  node scripts/sign-yc-application.mjs verify
  exit 0
fi

# Copy to nobulex-web for live deployment
echo ""
echo "Copying receipt to nobulex-web..."
cp "$NOBULEX_DIR/yc-application-receipt.json" "$WEB_DIR/yc-application-receipt.json"

# Commit and push to nobulex-web
cd "$WEB_DIR"
git add yc-application-receipt.json
git commit --no-verify -m "yc: $MODE-execution bilateral receipt (S26 application)"
git push origin main

echo ""
echo "Deployed. Live in 1-2 minutes at:"
echo "  https://nobulex.com/yc-application-receipt.json"
echo "  https://nobulex.com/yc"
echo ""

# Also commit to main nobulex repo
cd "$NOBULEX_DIR"
git add yc-application-receipt.json
git commit --no-verify -m "yc: $MODE-execution bilateral receipt (S26 application)" || echo "nothing to commit"
git push origin main || echo "nothing to push"
