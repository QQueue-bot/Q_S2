#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/home/ubuntu/.openclaw/workspace/.env"
WEBHOOK_URL="https://hooks.tbotsys.one/webhook/tradingview"
PAYLOAD="ENTER_LONG_Bot1"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

WEBHOOK_SECRET=$(grep '^WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
if [[ -z "${WEBHOOK_SECRET:-}" ]]; then
  echo "WEBHOOK_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

TMP_BODY=$(mktemp)
TMP_HEADERS=$(mktemp)
cleanup() {
  rm -f "$TMP_BODY" "$TMP_HEADERS"
}
trap cleanup EXIT

curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" \
  -X POST "${WEBHOOK_URL}?secret=${WEBHOOK_SECRET}" \
  -H 'Content-Type: text/plain' \
  --data "$PAYLOAD"

HTTP_CODE=$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$TMP_HEADERS")
cat "$TMP_BODY"
printf '\n'

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Expected HTTP 200, got ${HTTP_CODE:-unknown}" >&2
  exit 1
fi

if ! grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$TMP_BODY"; then
  echo 'Response does not contain "ok": true' >&2
  exit 1
fi
