# Sprint G4 Recap

_Last updated: 2026-03-31 UTC._

## Objective

Reduce friction and uncertainty for future dashboard/mobile page updates by creating a lightweight deploy and smoke-test path.

## What was delivered

### Dashboard deploy helper

Added:

- `scripts/deploy-dashboard.sh`

This script now:

- syncs repo contents into `/tmp/qs2_review`
- restarts `q-s2-dashboard`
- prints dashboard service status
- smoke-tests the key dashboard routes locally
- smoke-tests the key dashboard routes publicly

### Smoke-tested routes

The script checks:

- `/`
- `/mobile`
- `/api/mobile-bot-status`

for both:

- local listener `http://127.0.0.1:3010`
- public URL `https://dashboard.tbotsys.one`

### Operator value

This creates a one-command sanity check so a page change can be deployed and verified before being declared done.

## Validation target

A successful G4 run should prove:

- the repo was copied into runtime
- the dashboard service restarted successfully
- the local listener responds on the expected routes
- the public Cloudflare-backed routes also respond

## Interpretation

Sprint G4 is intentionally lightweight. It is not CI/CD and it does not replace broader runtime management. Its purpose is to remove the repeated ambiguity around whether a dashboard/mobile-page change is actually live.
