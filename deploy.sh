#!/usr/bin/env bash
# deploy.sh — Pull latest code and restart the webhook bot.
# Run this ON the AWS server as the ubuntu user.
set -euo pipefail

REPO_DIR="/home/ubuntu/.openclaw/workspace/Q_S2"
RUNTIME_DIR="/tmp/qs2_review"

printf '\n==> Pull latest code\n'
git -C "$REPO_DIR" pull

printf '\n==> Sync repo to runtime\n'
rsync -a "$REPO_DIR/" "$RUNTIME_DIR/"

printf '\n==> Restart webhook service\n'
sudo systemctl restart q-s2-webhook

printf '\n==> Restart dashboard service\n'
sudo systemctl restart q-s2-dashboard

printf '\n==> Service status\n'
systemctl status q-s2-webhook q-s2-dashboard --no-pager || true

printf '\nDeploy complete.\n'
