# Sprint G2 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint G2 polished the new mobile bot status view without turning it into a full dashboard replacement.

## What changed

### Freshness polish

Updated `src/dashboard/createDashboardServer.js` so the mobile page now shows:

- the generated/updated timestamp
- an explicit `Auto-refresh every 15s` freshness hint

### Balance handling polish

Updated `src/dashboard/buildMobileBotStatus.js` so an account that is reachable but has no funded USDT trading balance row now shows a zero balance instead of a generic unavailable state.

This preserves a cleaner operator experience for accounts that are valid but simply unfunded or newly funded.

### Runtime launcher cleanup

Updated `scripts/run-webhook-with-env.sh` so the webhook launcher loads live secrets from:

- `/home/ubuntu/.openclaw/.env`

instead of the incorrect workspace `.env` path.

## Validation

Validation confirmed:

- dashboard/mobile code compiles successfully
- builder resolves against the runtime registry and live env path
- enabled count now correctly reflects the intended live validation set when runtime config does
- Bot2/Bot3/Bot4 sample balances resolve cleanly after funded transfer handling
- empty funded-account cases no longer needlessly show `Balance unavailable`

## Result

Sprint G2 delivered the intended lightweight polish:

- better freshness communication
- less confusing zero/empty balance behavior
- cleaner operational runtime env loading in repo state

This keeps the mobile view phone-first and glanceable while reducing false-negative operator friction.
