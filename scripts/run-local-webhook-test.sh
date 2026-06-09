#!/usr/bin/env bash
# Runs webhook-handler.js locally with real env vars and fires the e2e test.
# Usage: bash scripts/run-local-webhook-test.sh [test-polar-webhook.js args]
set -euo pipefail

PORT=4001
LOG=/tmp/qa-webhook-server.log

POLAR_WEBHOOK_SECRET=$(grep QA_ARCHITECT_SECRET ~/Projects/internal/claude-setup/.env | cut -d= -f2)
BLOB_TOKEN=$(grep BLOB_READ_WRITE_TOKEN "$(dirname "$0")/../.env.local" | cut -d= -f2 | tr -d '"')

POLAR_PRO_PRODUCT_ID=cbb4408c-e7b3-4d19-a585-f9b07195adae \
  POLAR_WEBHOOK_SECRET="$POLAR_WEBHOOK_SECRET" \
  LICENSE_REGISTRY_KEY_ID=prod-2026-06 \
  LICENSE_REGISTRY_PRIVATE_KEY_PATH="$(dirname "$0")/../private-key.pem" \
  BLOB_READ_WRITE_TOKEN="$BLOB_TOKEN" \
  PORT=$PORT \
  node "$(dirname "$0")/../webhook-handler.js" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

sleep 2

QA_ARCHITECT_SECRET="$POLAR_WEBHOOK_SECRET" \
  node "$(dirname "$0")/test-polar-webhook.js" --url "http://localhost:$PORT" "$@"

EXIT=$?
echo ""
echo "=== Server log ==="
cat "$LOG"
exit $EXIT
