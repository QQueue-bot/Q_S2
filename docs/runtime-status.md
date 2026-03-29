# Runtime Status

_Last updated: 2026-03-29 UTC during Sprint 10 Recap._

## Purpose

This note records the currently observed runtime/deployment state so future review does not depend on chat history, shell history, or memory alone.

## Current observed live test runtime

The actively running test deployment was observed under:

- `/tmp/qs2_review`

This is important because the workspace clone/repo path is:

- `/home/ubuntu/.openclaw/workspace/Q_S2`

Those two locations are currently **not the same effective runtime source of truth**, even though they share the same Git commit base on `sprint-scope-review`.

## Observed live services

The following systemd services were found enabled and running:

- `q-s2-webhook.service`
- `q-s2-tunnel.service`

Observed service roles:

- `q-s2-webhook.service` runs the Node webhook app from `/tmp/qs2_review`
- `q-s2-tunnel.service` runs `cloudflared tunnel run q-s2-webhook`

Observed runtime listener:

- local webhook listener on `127.0.0.1:3001`

Observed public endpoint:

- `https://hooks.tbotsys.one/webhook/tradingview`

## Service/runtime files

Relevant repo files already present:

- `deploy/systemd/q-s2-webhook.service`
- `deploy/systemd/q-s2-tunnel.service`
- `deploy/systemd/README.md`
- `scripts/run-webhook-with-env.sh`

## Environment/secret handling

Secrets should remain outside Git.

The observed runtime script loads environment values from:

- `/home/ubuntu/.openclaw/workspace/.env`

Required values include at least:

- `WEBHOOK_SECRET`
- `BYBIT_TESTNET_API_KEY`
- `BYBIT_TESTNET_API_SECRET`

Do not commit real `.env` contents.

## Verified during Sprint 10 Recap

The following were directly verified:

- public webhook endpoint responded successfully
- TradingView-style payload `ENTER_LONG_Bot1` was accepted
- parsed signal details were returned
- risk/evaluation details were returned by the live runtime
- Bybit demo paper-trade execution succeeded with `retCode: 0`
- order attempts were present in the live runtime SQLite DB under `/tmp/qs2_review/data/s2.sqlite`

## Config handling decision

During Sprint 10 Recap, the live `/tmp/qs2_review/config/settings.json` was reviewed and compared with the repo copy.

Decision:

- keep repo `config/settings.json` as the conservative/default baseline
- do not blindly sync the live testing-enabled runtime config into Git
- treat the live `/tmp/qs2_review/config/settings.json` as a testing-only runtime variant unless/until a future sprint explicitly decides otherwise

This keeps Git review safer while still preserving the fact that the live runtime used a more permissive config during testing.

## Drift / continuity warning

The live runtime under `/tmp/qs2_review` has local modifications not yet fully reflected in the workspace repo clone.

Observed drift categories include:

- config differences
- webhook execution wiring differences
- SQLite schema/persistence differences
- extra execution/debug scripts present only in the live runtime copy

This means:

- live runtime evidence is valuable
- but it should not be assumed that GitHub/repo already fully captures that state

## Important safety interpretation

The current live runtime should be treated as a **testing-enabled paper-trade deployment**, not automatically as a fully complete or production-safe trading system.

In particular, later planned sprint work (for example fuller lifecycle handling, TP/SL management, BE logic, opposite-signal handling, and other hardening) should still be treated as meaningful future work unless explicitly documented otherwise.

## Recommended review order

When reviewing this project in future:

1. Check Trello current sprint/card status
2. Check repo docs, especially Sprint recap notes
3. Check this runtime-status note
4. Compare workspace repo vs live runtime if operational questions remain
5. Only then decide whether runtime drift should be synced back into Git
