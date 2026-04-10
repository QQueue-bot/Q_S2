# Q_S2 Project Log

Operations reference for common tasks.

---

## Deploy

**Script:** `deploy.sh` (project root)

Run on the AWS server as the `ubuntu` user:

```bash
cd /home/ubuntu/.openclaw/workspace/Q_S2
bash deploy.sh
```

What it does:
1. `git pull` in the repo directory (`/home/ubuntu/.openclaw/workspace/Q_S2`)
2. `rsync` to the runtime directory (`/tmp/qs2_review`)
3. `sudo systemctl restart q-s2-webhook`
4. Prints service status

Does not modify config, install packages, or touch the database.

---

## Check S3 Shadow Scores

**Script:** `scripts/checkS3Scores.js`

Run locally (pointing at the live DB) or on the server:

```bash
# On the server
node scripts/checkS3Scores.js

# Override DB path if needed
S2_DB_PATH=/path/to/s2.sqlite node scripts/checkS3Scores.js
```

Prints the last 20 rows from `s3_scores`, showing:
- Row ID, timestamp, bot, symbol, signal
- Composite score (0–100)
- Fetch latency and data availability flag
- Per-factor scores and weights

S3 scoring is shadow-mode only (`s3.enabled: false` in `config/settings.json`).
To activate, flip `enabled` to `true` — no other changes required.

---
