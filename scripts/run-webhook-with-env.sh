#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/home/ubuntu/.openclaw/workspace/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec node /tmp/qs2_review/scripts/run-webhook.js
