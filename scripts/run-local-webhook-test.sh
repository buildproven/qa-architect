#!/usr/bin/env bash
# Runs webhook-handler.js locally with real env vars and fires the e2e test.
#
# Usage: bash scripts/run-local-webhook-test.sh [test-polar-webhook.js args]
#
# Required env (override any of these inline; sensible local defaults shown):
#   POLAR_WEBHOOK_SECRET   webhook signing secret. If unset, sourced from
#                          $QAA_SECRET_ENV_FILE (default ~/.config/buildproven/.env
#                          then ~/Projects/internal/claude-setup/.env) by grepping
#                          QA_ARCHITECT_SECRET=. Set the var directly to skip the file.
#   BLOB_READ_WRITE_TOKEN  Vercel Blob token. If unset, read from ../.env.local.
#   POLAR_PRO_PRODUCT_ID   defaults to the QA Architect Pro product id.
#   LICENSE_REGISTRY_KEY_ID / LICENSE_REGISTRY_PRIVATE_KEY_PATH  signing key.
set -euo pipefail

PORT="${PORT:-4001}"
LOG="${LOG:-/tmp/qa-webhook-server.log}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve the webhook secret: explicit env wins; otherwise grep a known .env.
if [ -z "${POLAR_WEBHOOK_SECRET:-}" ]; then
  for candidate in \
    "${QAA_SECRET_ENV_FILE:-}" \
    "$HOME/.config/buildproven/.env" \
    "$HOME/Projects/internal/claude-setup/.env"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      POLAR_WEBHOOK_SECRET=$(grep -m1 '^QA_ARCHITECT_SECRET=' "$candidate" | cut -d= -f2-)
      [ -n "$POLAR_WEBHOOK_SECRET" ] && break
    fi
  done
fi
if [ -z "${POLAR_WEBHOOK_SECRET:-}" ]; then
  echo "❌ POLAR_WEBHOOK_SECRET not set and not found in any known .env." >&2
  echo "   Set it inline or point QAA_SECRET_ENV_FILE at a file with QA_ARCHITECT_SECRET=." >&2
  exit 1
fi

# Resolve the blob token: explicit env wins; otherwise read ../.env.local.
if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  BLOB_READ_WRITE_TOKEN=$(grep -m1 '^BLOB_READ_WRITE_TOKEN=' "$SCRIPT_DIR/../.env.local" 2>/dev/null | cut -d= -f2- | tr -d '"')
fi

POLAR_PRO_PRODUCT_ID="${POLAR_PRO_PRODUCT_ID:-cbb4408c-e7b3-4d19-a585-f9b07195adae}" \
  POLAR_WEBHOOK_SECRET="$POLAR_WEBHOOK_SECRET" \
  LICENSE_REGISTRY_KEY_ID="${LICENSE_REGISTRY_KEY_ID:-prod-2026-06}" \
  LICENSE_REGISTRY_PRIVATE_KEY_PATH="${LICENSE_REGISTRY_PRIVATE_KEY_PATH:-$SCRIPT_DIR/../private-key.pem}" \
  BLOB_READ_WRITE_TOKEN="$BLOB_READ_WRITE_TOKEN" \
  PORT=$PORT \
  node "$SCRIPT_DIR/../webhook-handler.js" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

sleep 2

QA_ARCHITECT_SECRET="$POLAR_WEBHOOK_SECRET" \
  node "$SCRIPT_DIR/test-polar-webhook.js" --url "http://localhost:$PORT" "$@"

EXIT=$?
echo ""
echo "=== Server log ==="
cat "$LOG"
exit $EXIT
