# Dashboard Runbook

_Last updated: 2026-03-29 UTC._

## Purpose

Short operator runbook for the S2 dashboard, webhook runtime, and Cloudflare tunnel.

## Public dashboard

- Dashboard URL: `https://dashboard.tbotsys.one`
- Current mode: read-only operator dashboard
- Auto-refresh: every 15 seconds

## Key services

### Webhook runtime
- systemd unit: `q-s2-webhook.service`

### Cloudflare tunnel
- systemd unit: `q-s2-tunnel.service`

### Dashboard
- systemd unit: `q-s2-dashboard.service`

## Quick status checks

```bash
sudo systemctl status q-s2-webhook --no-pager
sudo systemctl status q-s2-tunnel --no-pager
sudo systemctl status q-s2-dashboard --no-pager
```

## Restart commands

```bash
sudo systemctl restart q-s2-webhook
sudo systemctl restart q-s2-tunnel
sudo systemctl restart q-s2-dashboard
```

## Dashboard deploy + smoke test

For dashboard/mobile page changes, prefer the one-command helper:

```bash
bash /home/ubuntu/.openclaw/workspace/Q_S2/scripts/deploy-dashboard.sh
```

This will:

- sync repo to `/tmp/qs2_review`
- restart `q-s2-dashboard`
- smoke-test `/`, `/mobile`, and `/api/mobile-bot-status`
- check both local and public dashboard routes

## Enable on boot

```bash
sudo systemctl enable q-s2-webhook
sudo systemctl enable q-s2-tunnel
sudo systemctl enable q-s2-dashboard
```

## Useful checks

### Check public dashboard headers
```bash
curl -I https://dashboard.tbotsys.one
```

### Check public webhook headers
```bash
curl -I https://hooks.tbotsys.one
```

### Check dashboard local listener
```bash
ss -ltnp '( sport = :3010 )'
```

### Check webhook local listener
```bash
ss -ltnp '( sport = :3001 )'
```

### Check Cloudflare config
```bash
cat /home/ubuntu/.cloudflared/config.yml
```

## Important file locations

### Active runtime path
- `/tmp/qs2_review`

### Repo path
- `/home/ubuntu/.openclaw/workspace/Q_S2`

### Cloudflare config
- `/home/ubuntu/.cloudflared/config.yml`

### Dashboard systemd unit in repo
- `deploy/systemd/q-s2-dashboard.service`

### Webhook/tunnel systemd units in repo
- `deploy/systemd/q-s2-webhook.service`
- `deploy/systemd/q-s2-tunnel.service`

## Notes

- The dashboard is externally reachable through Cloudflare.
- The dashboard is currently read-only.
- Cloudflare Access/privacy hardening is still a follow-up step if desired.
