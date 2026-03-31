#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/ubuntu/.openclaw/workspace/Q_S2"
RUNTIME_DIR="/tmp/qs2_review"

printf '\n==> Sync repo to runtime\n'
rsync -a "$REPO_DIR/" "$RUNTIME_DIR/"

printf '\n==> Restart dashboard service\n'
sudo systemctl restart q-s2-dashboard
sleep 2

printf '\n==> Dashboard service status\n'
systemctl status q-s2-dashboard --no-pager || true

printf '\n==> Local smoke tests\n'
for url in \
  "http://127.0.0.1:3010/" \
  "http://127.0.0.1:3010/mobile" \
  "http://127.0.0.1:3010/api/mobile-bot-status"
do
  printf '\n-- %s\n' "$url"
  curl -fsS -I "$url"
done

printf '\n==> Public smoke tests\n'
for url in \
  "https://dashboard.tbotsys.one/" \
  "https://dashboard.tbotsys.one/mobile" \
  "https://dashboard.tbotsys.one/api/mobile-bot-status"
do
  printf '\n-- %s\n' "$url"
  curl -fsS -I "$url"
done

printf '\nDashboard deploy + smoke test complete.\n'
