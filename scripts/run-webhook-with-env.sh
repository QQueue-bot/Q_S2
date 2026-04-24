#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/home/ubuntu/.openclaw/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export S2_DB_PATH="${S2_DB_PATH:-/tmp/qs2_review/data/s2.sqlite}"
exec node /home/ubuntu/.openclaw/workspace/Q_S2/scripts/run-webhook.js
