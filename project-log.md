# Q_S2 Project Log

Operations reference for common tasks.

_Last updated: 2026-04-24 UTC._

---

## Current operational state (2026-04-24)

### Active durable repo/runtime path
- `/home/ubuntu/.openclaw/workspace/Q_S2`

### Public endpoints
- webhook: `https://hooks.tbotsys.one/webhook/tradingview`
- dashboard: `https://dashboard.tbotsys.one`
- mobile: `https://dashboard.tbotsys.one/mobile`

### Systemd services currently in use
- `q-s2-webhook.service`
- `q-s2-dashboard.service`
- `q-s2-tunnel.service`

### Important 2026-04-24 runtime correction
Historically, S2 was actively operated from `/tmp/qs2_review`.
That path proved ephemeral and disappeared during the 2026-04-24 outage/recovery event.

Services were then repointed back to the workspace repo path so the system could be restored.

### Important data caveat
The richer historical runtime DB previously operated under `/tmp/qs2_review/data/s2.sqlite` appears to have been lost when the `/tmp` runtime disappeared.
Current review work therefore depends heavily on:
- Bybit exchange-side history
- repo config / docs
- surviving workspace DB content

---

## Deploy / update

### Current safe assumption
Treat the workspace repo as the active durable runtime reference unless intentionally changed again.

If updating the repo on-server, check service unit paths and wrapper scripts before assuming an older `/tmp/qs2_review`-style deploy model still applies.

---

## Check service state

### Dashboard
```bash
systemctl status q-s2-dashboard.service --no-pager
curl -I http://127.0.0.1:3010/mobile
```

### Webhook
```bash
systemctl status q-s2-webhook.service --no-pager
curl -i -sS http://127.0.0.1:3001/ | sed -n '1,40p'
```

### Tunnel
```bash
systemctl status q-s2-tunnel.service --no-pager
journalctl -u q-s2-tunnel.service -n 60 --no-pager
```

---

## Check S3 Shadow Scores

**Script:** `scripts/checkS3Scores.js`

Run locally, pointing at the intended DB path:

```bash
node scripts/checkS3Scores.js

# Override DB path if needed
S2_DB_PATH=/path/to/s2.sqlite node scripts/checkS3Scores.js
```

Prints the last 20 rows from `s3_scores`, showing:
- row ID, timestamp, bot, symbol, signal
- composite score (0–100)
- fetch latency and data availability flag
- per-factor scores and weights

S3 scoring remains shadow-mode only (`s3.enabled: false` in `config/settings.json`).

---

## Review references

### Full review pack (2026-04-24)
- `summaries/S2 full bot and trade review pack 2026-04-24.md`
- `summaries/bybit-review-data-2026-04-24.json`
- `summaries/resolved-bot-settings-2026-04-24.json`
- `summaries/local-db-snapshot-2026-04-24.json`

### Current practical review truth sources
1. Bybit exchange-side account data
2. `config/bots.json`
3. MDX source files under `mdx/`
4. current repo docs / summaries
5. surviving local SQLite data

---

## Handover note
If a reference elsewhere in the repo still assumes `/tmp/qs2_review` is the current active runtime, treat that as historical unless an operator has intentionally re-established that layout.
