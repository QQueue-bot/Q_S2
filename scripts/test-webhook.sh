#!/usr/bin/env bash
set -euo pipefail
PORT="${WEBHOOK_PORT:-3001}"
SECRET="${WEBHOOK_SECRET:-dev-secret}"
PATH_PART="${WEBHOOK_PATH:-/webhook/tradingview}"

curl -sS -X POST "http://127.0.0.1:${PORT}${PATH_PART}?secret=${SECRET}" \
  -H 'Content-Type: text/plain' \
  --data 'ENTER_LONG_Bot1'
