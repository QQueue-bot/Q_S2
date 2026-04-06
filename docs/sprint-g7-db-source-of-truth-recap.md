# Sprint G7 Recap - Align Webhook and Dashboard DB Source of Truth

_Last updated: 2026-04-06 UTC._

## Objective

Eliminate the runtime inconsistency where the dashboard mobile page reads one DB file while the live webhook/runtime activity appears to write recent signals, heartbeats, and order attempts elsewhere or through a different unresolved path.

## Root cause

The dashboard service was explicitly pinned to:

- `S2_DB_PATH=/tmp/qs2_review/data/s2.sqlite`

But the webhook service was not explicitly pinned to the same DB path in systemd. It relied on defaults, which made the shared observability path fragile and likely inconsistent.

## Fix applied

Updated repo service/runtime artifacts so the webhook path is also explicitly pinned to:

- `S2_DB_PATH=/tmp/qs2_review/data/s2.sqlite`

### Files updated

- `deploy/systemd/q-s2-webhook.service`
- `scripts/run-webhook-with-env.sh`

## Interpretation

This aligns webhook and dashboard around the same explicit DB source of truth, which is required for the mobile page to show fresh heartbeat, signal, and order activity from the actual live runtime.

## Validation target

After host-level service file update + daemon reload + restart:

- fresh heartbeat rows should appear in `/tmp/qs2_review/data/s2.sqlite`
- fresh normalized signals should appear in the same DB
- fresh order attempts should appear in the same DB
- `/api/mobile-bot-status` and `/mobile` should then reflect those fresh values correctly
