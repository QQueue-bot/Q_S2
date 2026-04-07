#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/ubuntu/.openclaw/workspace/Q_S2"
RUNTIME_DIR="/tmp/qs2_review"
DB_PATH="/tmp/qs2_review/data/s2.sqlite"
WEBHOOK_SERVICE="q-s2-webhook.service"
DASHBOARD_SERVICE="q-s2-dashboard.service"
LOCAL_WEBHOOK_URL="http://127.0.0.1:3001/webhook/tradingview"
LOCAL_DASHBOARD_URL="http://127.0.0.1:3010/"
LOCAL_MOBILE_URL="http://127.0.0.1:3010/mobile"
LOCAL_MOBILE_API_URL="http://127.0.0.1:3010/api/mobile-bot-status"

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; }
warn() { echo "WARN $1"; }

check_git_sync() {
  local repo_commit runtime_commit
  repo_commit=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)
  runtime_commit=$(git -C "$RUNTIME_DIR" rev-parse HEAD 2>/dev/null || true)
  if [[ -n "$repo_commit" && "$repo_commit" == "$runtime_commit" ]]; then
    pass "repo_runtime_sync commit=$repo_commit"
  else
    fail "repo_runtime_sync repo=${repo_commit:-missing} runtime=${runtime_commit:-missing}"
  fi
}

check_service() {
  local service="$1"
  if systemctl is-active --quiet "$service"; then
    pass "service_active $service"
  else
    fail "service_active $service"
  fi
}

check_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    pass "file_exists $file"
  else
    fail "file_exists $file"
  fi
}

check_sqlite() {
  if [[ ! -f "$DB_PATH" ]]; then
    fail "db_exists $DB_PATH"
    return
  fi
  local tables
  tables=$(python3 - <<PY
import sqlite3
conn=sqlite3.connect('$DB_PATH')
cur=conn.cursor()
print(cur.execute("select count(*) from sqlite_master where type='table'").fetchone()[0])
PY
)
  if [[ "$tables" =~ ^[0-9]+$ ]] && [[ "$tables" -gt 0 ]]; then
    pass "db_readable tables=$tables path=$DB_PATH"
  else
    fail "db_readable path=$DB_PATH"
  fi
}

check_http() {
  local name="$1"
  local url="$2"
  if curl -fsS -o /dev/null "$url"; then
    pass "http_ok $name $url"
  else
    fail "http_ok $name $url"
  fi
}

echo "O1 post-change ops check"
check_git_sync
check_file "$RUNTIME_DIR/config/bots.json"
check_file "$RUNTIME_DIR/config/settings.json"
check_service "$WEBHOOK_SERVICE"
check_service "$DASHBOARD_SERVICE"
check_sqlite
check_http webhook "$LOCAL_WEBHOOK_URL"
check_http dashboard "$LOCAL_DASHBOARD_URL"
check_http mobile "$LOCAL_MOBILE_URL"
check_http mobile_api "$LOCAL_MOBILE_API_URL"
echo "O1 check complete"
