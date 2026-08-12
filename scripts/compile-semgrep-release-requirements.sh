#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
INPUT=".github/semgrep-release-requirements.in"
OUTPUT=".github/semgrep-release-requirements.txt"
GENERATED="$OUTPUT.generated"
trap 'rm -f "$GENERATED"' EXIT

uv pip compile "$INPUT" \
  --python-platform linux \
  --python-version 3.12 \
  --generate-hashes \
  --no-emit-index-url \
  --no-annotate \
  --output-file "$GENERATED"

# Semgrep 1.172.0 hard-pins mcp==1.23.3. The release job performs only local
# CLI scans and never starts an MCP transport, so omit that optional runtime
# surface and install the remaining explicit lock with --no-deps.
awk '
  /^mcp==/ { skipping = 1; next }
  skipping && /^[[:alnum:]][[:alnum:]_.-]*==/ { skipping = 0 }
  !skipping { print }
' "$GENERATED" > "$OUTPUT"

if grep -q '^mcp==' "$OUTPUT"; then
  echo "error: vulnerable MCP SDK remained in Semgrep release lock" >&2
  exit 1
fi
