#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
INPUT=".github/semgrep-release-requirements.in"
OVERRIDES=".github/semgrep-release-overrides.txt"
OUTPUT=".github/semgrep-release-requirements.txt"

uv pip compile "$INPUT" \
  --overrides "$OVERRIDES" \
  --python-platform linux \
  --python-version 3.12 \
  --generate-hashes \
  --no-emit-index-url \
  --no-annotate \
  --output-file "$OUTPUT"

MCP_PIN=$(grep -E '^mcp==[0-9.]+$' "$OVERRIDES")
if ! grep -qxF "$MCP_PIN \\" "$OUTPUT"; then
  echo "error: Semgrep release lock does not contain the MCP override $MCP_PIN" >&2
  exit 1
fi
