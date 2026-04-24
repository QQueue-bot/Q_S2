# STATE_OF_SYSTEM.md — Q_S2 Handover Assessment

_Generated: 2026-04-24 UTC. Assessor: Claude Sonnet 4.6._
_Read-only orientation. No code was modified._

---

## Orientation Note

This assessment was conducted from a **local macOS clone** of the repo at `/Users/ianhenderson/Q_S2`. The system's live EC2 instance at `/home/ubuntu/.openclaw/workspace/Q_S2` was not directly accessible during this review. Sections covering live EC2 state (service health, journal logs, installed systemd units, running processes, cloudflared config, DB file) are therefore based on code inspection, git history, and sprint recap documentation rather than direct observation. Any such inference is flagged with `[INFERRED]`.

---

## 1. What S2 Does — End to End

### Signal Arrival

TradingView fires a POST to the public webhook endpoint (`https://hooks.tbotsys.one/webhook/tradingview?secret=<WEBHOOK_SECRET>`). The request reaches the EC2 instance via a Cloudflare tunnel (`cloudflared tunnel run q-s2-webhook`) which forwards to `127.0.0.1:3001`.

The Node HTTP server (`src/webhook/createServer.js`) authenticates via the `secret` query parameter. Unauthenticated requests are rejected with 401 and logged to `raw_webhook_events`. Heartbeat signals (`S2_HEARTBEAT`) are handled separately — stored in `heartbeat_events` and returned without executing.

### Parser and Registry Resolution

`parseSignalString` (`src/signals/parseSignal.js`) splits the raw body on the last `_BOT` token to extract signal type and bot number (e.g., `ENTER_LONG_Bot2` → `signal: ENTER_LONG`, `botId: Bot2`). Signals must match one of the four supported types; bot token must be in the bot registry.

`resolveBotContext(botId)` (`src/config/resolveBotContext.js`) loads the bot registry (`config/bots.json`), resolves per-bot settings via `resolveBotSettings`, loads MDX source config, resolves credentials from the env file, and returns:
- `allowedBots` — all configured bot IDs (for signal acceptance/logging)
- `executionEnabledBots` — only bots where `enabled: true` (for execution gating)
- `settings` — the merged runtime settings (MDX values merged over global base)
- `validation` — validation result of the _unmerged base_ settings.json (see Known Issue 1)

**Settings merge (critical):** `resolveBotSettings` takes the global `config/settings.json` as a base, then merges in the bot's MDX-derived profile values for `positionSizing.leverage`, `takeProfit.levels`, `stopLoss.triggerPercent`, `breakEven.triggerPercent`. `accountPercent` is hardcoded to `10` in the merge, regardless of the global setting (50). The merge does NOT update `trading.allowedSymbols` or other `trading` fields — those remain from the global settings.

### Risk Evaluation

`createRiskEngine` (`src/risk/evaluateSignal.js`) evaluates the parsed signal against the merged settings and bot context. Execution is allowed only if all checks pass:

1. `botContext.symbol` is in `settings.trading.allowedSymbols` ← **stale; see Known Issue / Flag**
2. Bot is in `allowedBots` (registry check)
3. Bot ID matches resolved context
4. Bot is in `executionEnabledBots` (enabled flag gate)
5. `accountPercent <= maxAccountPercent` and `leverage <= maxLeverage`
6. Kill switch is off
7. Trading enabled (for entry signals)
8. No active TP/SL/BE placeholder zeros in the merged settings

If all pass, `risk.allowed = true` and `risk.actionable = true` (for entry signals).

### Bybit Order Placement

`executePaperTrade` (`src/execution/bybitExecution.js`) runs in `setImmediate` (non-blocking):

1. Loads per-bot credentials from `/home/ubuntu/.openclaw/.env` (see env path note in Section 3)
2. Calls `getBybitBaseUrl()` — defaults to `https://api-demo.bybit.com` but reads `BYBIT_BASE_URL` env var; on mainnet this must be set to `https://api.bybit.com`
3. Fetches live account balance from Bybit (`getWalletBalance`)
4. Caps effective balance at 5,000 USDT: `effectiveAccountBalanceUsd = Math.min(actual, 5000)`
5. Computes order qty: `(effectiveBalance × 10%) × leverage / referencePrice`, floored to qty step
6. Handles opposite-position reversal: if existing position is opposite side, closes it first
7. Stage 1: places 50% of qty as market order
8. If `bot.dcaPolicy.enabled === true` (via `resolveDcaStrategy`): after a delay of 1–2 candles, places remaining 50% as a DCA add, subject to guards (no BE armed, no TP started, no opposite signal)
9. If `bot.dcaPolicy.enabled === false`: records `dca_add_skipped` with `reason: policy_disabled` and stops
10. Persists to `staged_entry_events`, `order_attempts`

### Lifecycle Management (TP Ladder, SL, Break-Even)

`startTradeManagementLoop` (`src/runtime/startTradeManagementLoop.js`) runs every 15 seconds (default; configurable via `S2_MANAGEMENT_INTERVAL_MS`) and iterates over all **enabled** bots:

- **TP/SL:** `manageTpSl` fetches the live Bybit mark price and open position. Evaluates each enabled TP level against `position.unrealised_pnl_percent`. On trigger, closes `closePercent`% of remaining quantity. SL fires if mark price crosses the configured threshold.
  - Idempotency: `trade_state_events` records an action key (`TP_1_EXECUTED`, etc.) per trade. On next loop tick, `hasTradeActionExecuted` checks this key; if found, the level is skipped. **This was the fix for the pre-Sprint-11 TP repeated re-fire bug.**
- **Break-even:** `manageBreakEven` arms BE state when mark price exceeds the BE trigger (from `slToBeTrigger` mapped to the corresponding TP level percent). Once armed, if price returns to entry, closes the remaining position.
  - Idempotency: `BE_ARM` and `BE_CLOSE` action keys prevent re-firing.
  - Lifecycle scoping: armed state is now scoped to the current live position's `createdTime` — stale armed events from previous trades on the same symbol are ignored. **This was the fix for the pre-Sprint-F3M stale BE arm state bug.**
- Management uses **per-bot resolved settings** (MDX-aware), not the global `config/settings.json`. **This was the fix for the pre-Sprint-F3J shared-settings management bug.**

### S3 Shadow Scoring

After execution is queued, if `settings.s3.enabled === true` and the signal is an entry signal, `computeS3Score` (`src/scoring/computeS3Score.js`) fires asynchronously (fire-and-forget, never gates execution). It fetches Bybit klines for RSI, VWAP, volume spike, and HTF trend factors; queries `exit_events`/`trade_state_events` for win/loss streak. Writes to `s3_scores` table and logs via `logger.info`. On main branch, `s3.enabled: true`; on sprint-scope-review, `s3.enabled: false`.

---

## 2. Current Runtime State

> **EC2 NOT DIRECTLY ACCESSIBLE.** All items below are `[INFERRED]` from code, git history, and sprint documentation unless noted otherwise.

### Services

[INFERRED] The system runs two systemd services:

- **`q-s2-webhook.service`** — Node process running `run-webhook.js` from the runtime directory. Configured with `WorkingDirectory=/tmp/qs2_review` and `Environment=S2_DB_PATH=/tmp/qs2_review/data/s2.sqlite` in the committed service unit.
- **`q-s2-tunnel.service`** — Cloudflare tunnel: `cloudflared tunnel run q-s2-webhook`. Proxies public webhook traffic to `127.0.0.1:3001`.

[INFERRED — CONCERN] The runtime directory `/tmp/qs2_review` is known to have been lost (EC2 reboot wipes `/tmp`). The orientation brief states "recovery is in progress" and that there is a local modification to `scripts/run-webhook-with-env.sh` on the EC2 that is not yet committed. This modification likely changes either the runtime path or the node entrypoint path to something that survives reboots. **The committed version of this file still references `/tmp/qs2_review/scripts/run-webhook.js` and `/tmp/qs2_review/data/s2.sqlite`.** If the EC2 was not recovered to a new path before services were restarted, services may be failing or running from a rebuilt `/tmp/qs2_review`.

### Database

[INFERRED] The DB is expected at `/tmp/qs2_review/data/s2.sqlite` (from systemd unit and run-webhook-with-env.sh). If the EC2 runtime was rebuilt post-reboot, this DB may be freshly initialized with only schema tables and no historical trade data. Historical data from before the runtime loss is not recoverable from the repo (the DB is gitignored). The repo config `config/settings.json` also references `./data/s2.sqlite` which, relative to the runtime working directory, resolves to `/tmp/qs2_review/data/s2.sqlite`.

### Tunnel

[INFERRED] The Cloudflare tunnel identity is managed by cloudflared credentials stored outside the repo (typically at `/etc/cloudflared/` or `~/.cloudflared/`). The tunnel name is `q-s2-webhook`. If the service is running, the public endpoint `https://hooks.tbotsys.one/webhook/tradingview` should be reachable. [Cannot verify without EC2 access or a test HTTP request.]

### Log Errors / Warnings of Note

[INFERRED] Based on code analysis, the following would appear in recent logs if the system is active:

- `[S3] Score computation failed` — any bot whose symbol isn't available on the api-demo.bybit.com klines endpoint (possible for newer symbols like PUMPFUNUSDT)
- `Bot symbol XXXUSDT is not in allowedSymbols` — for Bots 3, 5, 6, 7, 8 (see Known Issue 3 / Flag)
- Management loop credential errors for bots without API key/secret in the `.env` file (if newly-added bots don't have credentials yet)

### Running Processes

[INFERRED] If healthy:
```
/usr/bin/node /tmp/qs2_review/scripts/run-webhook.js     # q-s2-webhook
/usr/local/bin/cloudflared tunnel run q-s2-webhook       # q-s2-tunnel
```

---

## 3. EC2 State vs Repo State — Drift Analysis

### Known Local Modification: `scripts/run-webhook-with-env.sh`

The orientation brief confirms at least one uncommitted change to this file on the EC2 instance. The committed version:

```bash
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/home/ubuntu/.openclaw/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

export S2_DB_PATH="${S2_DB_PATH:-/tmp/qs2_review/data/s2.sqlite}"
exec node /tmp/qs2_review/scripts/run-webhook.js
```

The EC2 modification probably changes:
- The `exec node` target path (from `/tmp/qs2_review/...` to a reboot-stable path)
- Possibly `S2_DB_PATH` to a reboot-stable location

**Recommendation:** SSH to EC2, `cat scripts/run-webhook-with-env.sh`, diff against committed version, and commit the result. Until this is committed, a repo push that rsyncs to `/tmp/qs2_review/` would overwrite the EC2 modification without warning. This is a data-loss risk on next deploy.

### `.env` File

The `.env` file at `/home/ubuntu/.openclaw/workspace/.env` (documented in README and runtime-status.md) is the expected location for secrets. However there is an inconsistency in the codebase:

| Location | Path used |
|---|---|
| `scripts/run-webhook-with-env.sh` | `/home/ubuntu/.openclaw/.env` (no `workspace/`) |
| `scripts/run-webhook.js` → management loop | `/home/ubuntu/.openclaw/workspace/.env` |
| `src/webhook/createServer.js` → execution | `/home/ubuntu/.openclaw/.env` |
| `src/config/resolveBotCredentials.js` default | `/home/ubuntu/.openclaw/.env` |

There are two distinct paths in active use. If only one file exists, the other path falls back to `process.env` (which inherits whatever the shell script sourced). This may work silently. But if both files exist with different content, the management loop would use different credentials than the execution path — a production correctness concern.

**Recommendation:** Standardize to a single `.env` path. Verify which file exists on EC2 and whether `/home/ubuntu/.openclaw/workspace/.env` is a symlink or a separate file. Document the canonical path in Claude.md.

### `config/settings.json` Drift Between Branches

- **`sprint-scope-review`:** `s3.enabled: false`
- **`main`:** `s3.enabled: true` (deployed to EC2 via `bfa467e`)

The running system on EC2 has S3 shadow scoring **enabled**. Sprint-scope-review still reflects the pre-enable state. Any PR that updates settings.json from sprint will conflict on this field.

### Installed Systemd Units vs Repo

[INFERRED] The committed service unit `deploy/systemd/q-s2-webhook.service` references `/tmp/qs2_review` throughout. If the EC2 local modification to `run-webhook-with-env.sh` changes the runtime path, the installed unit at `/etc/systemd/system/q-s2-webhook.service` may also have been updated manually. These two files should be compared before any systemd-related work.

### Dashboard Service

A `q-s2-dashboard.service` unit exists in `deploy/systemd/` and `scripts/run-dashboard.js` exists. Runtime status of the dashboard service cannot be confirmed without EC2 access.

### Orphaned State

[INFERRED] If `/tmp/qs2_review` was wiped by a reboot, all DB data, log files, and any other ephemeral artifacts under that path are gone. There is no indication of a DB backup mechanism. Any `/tmp/qs2_review/data/s2.sqlite` that exists now is post-recovery.

### Other Files Outside the Repo

[INFERRED] The following files exist outside Git and are load-bearing:
- `/home/ubuntu/.openclaw/.env` (or `.openclaw/workspace/.env`) — bot credentials, WEBHOOK_SECRET, BYBIT_BASE_URL
- `/etc/systemd/system/q-s2-webhook.service`
- `/etc/systemd/system/q-s2-tunnel.service`
- `/etc/cloudflared/config.yml` (or `~/.cloudflared/config.yml`) — Cloudflare tunnel config
- `~/.cloudflared/<tunnel-uuid>.json` — Cloudflare tunnel credentials

None of these are committed or gitignored-with-documentation. The cloudflared config should at minimum have its structure documented (not credentials) in the repo.

---

## 4. Branch Analysis

### `main` (default, production)

- **2 commits ahead of `sprint-scope-review`** at the shared merge point
- Contains: `bfa467e` (enable S3 shadow scoring: `s3.enabled: true` in settings.json) and `238bf8b` (inline deploy commands in GitHub Actions workflow)
- The GitHub Actions `deploy.yml` on `main` deploys on every push: git pull → rsync to `/tmp/qs2_review/` → restart webhook service
- **This is the production branch.** Pushes here go live.
- Status: Clean, up to date with remote, nothing stale.

### `sprint-scope-review` (active working branch)

- **2 commits behind `main`** — missing the S3 enable and inline-deploy workflow commits
- All substantive feature work lives here before being merged to main
- The deploy workflow on this branch uses `bash /home/ubuntu/.openclaw/workspace/Q_S2/deploy.sh` (calling the repo-tracked deploy script), while main uses inline commands. The inline approach on main is simpler and less fragile.
- **Recommendation:** Sync sprint-scope-review with main (merge or rebase main → sprint). The 2 missing commits are safe and intentional. The S3 enable in particular should be visible on the working branch to avoid future config conflicts.

### `access-test` (remote only, stale)

- **108 commits behind main.** Last commit: `5673b43 Add repo_access_test_2`.
- This branch was created during initial Trello/identity bootstrap and contains: `IDENTITY.md`, `USER.md`, `access_test` file, Trello helper scripts.
- It has **no Q_S2 source code** — all project files (`src/`, `config/`, `deploy/`, `docs/`) are absent.
- **No merging, no keeping. Recommend deleting** after noting that its Trello/identity content (if still needed) is not in any other branch.

---

## 5. The 8-Bot Registry

All resolved from MDX `balanced` profile unless `mdxProfile` says otherwise in `config/bots.json`. `accountPercent` is hardcoded to 10% in the settings merge regardless of global config.

| Bot | Symbol | Profile | Leverage | SL% | BE trigger | TP1% | TP2% | TP3–6% | DCA | Registry `enabled` |
|---|---|---|---|---|---|---|---|---|---|---|
| Bot1 | STXUSDT | balanced | 5x | 5% | TP2 → 2.15% | 0.85 | 2.15 | 3.84/6.48/9.5/18.01 | Off | **true** |
| Bot2 | NEARUSDT | **aggressive** | **6x** | 6% | TP1 → 4.87% | 4.87 | 5.44 | 7.18/10.96/16.23/24.03 | **On** | **true** |
| Bot3 | PAXGUSDT | balanced | 8x | 3% | TP3 → 1.73% | 0.37 | 0.91 | 1.73/3.09/4.78/9.6 | Off | **true** |
| Bot4 | CRVUSDT | balanced | 5x | 6% | TP1 → 3.24% | 3.24 | 6.08 | 8.44/10.99/13.87/20.47 | Off | **false** ← disabled |
| Bot5 | WIFUSDT | balanced | 4x | 2% | TP3 → 9.26% | 1.97 | 5.67 | 9.26/12.32/16.91/26.92 | Off | **true** |
| Bot6 | IPUSDT | balanced | 3x | 3% | TP1 → 3.43% | 3.43 | 5.26 | 9.33/14.57/31.29/52.88 | Off | **true** |
| Bot7 | FLOKIUSDT | balanced | 3x | 5% | TP2 → 6.29% | 3.03 | 6.29 | 8.17/12.35/17.8/27.09 | Off | **true** |
| Bot8 | PUMPFUNUSDT | balanced | 3x | 5% | TP1 → 2.22% | 2.22 | 5.45 | 8.53/12.7/19.67/29.49 | Off | **true** |

**Exchange-side evidence match:** Cannot verify directly — EC2 not accessible. Based on the review pack (2026-04-08), Bot1/Bot2/Bot4 had confirmed Bybit order submissions with `retCode: 0`. Bots 3, 5, 6, 7, 8 had zero confirmed Bybit executions at that time (all were `enabled: false` until 2026-04-09). Current enabled/disabled states match the most recent commit `35fd515 Re-enable STX and disable CRV`.

**Bot2 profile mismatch with review pack:** The 2026-04-08 review pack shows Bot2 on `balanced` profile (leverage 4). The current repo has `mdxProfile: "aggressive"` (leverage 6). The profile change was made in commit `3bd3455` after the review pack was collected. The current runtime should be using aggressive profile if the deploy ran after that commit.

**Bot6 aggressive profile incomplete:** `mdx/Bot6.source.json` has `aggressive.strategy` with all nulls and empty arrays. If Bot6's `mdxProfile` were ever changed to `aggressive`, `resolveMdxSettings` would throw on `validatePercentArray`. Currently safe (mdxProfile: balanced), but the null aggressive profile is a latent hazard.

---

## 6. Known Issues — Confirmed, Refined, or Disputed

### Issue 1: `validation.ok: false` and `safeMode: true` Despite Live Execution

**Confirmed. Root cause identified. Not a safety bypass — a stale validation object.**

Trace:
1. `resolveBotSettings` returns `{ settings: mergedSettings, validation: validatedBase.validation }`.
2. The `validation` field is produced by `validateSettingsObject(baseSettings)` where `baseSettings` is the raw `config/settings.json` — which has `stopLoss.triggerPercent: 0.0` (an explicit placeholder zero).
3. `validateSettingsObject` detects this zero and emits `error: "Trading cannot be enabled while TP/SL/BE placeholder zero values exist"` → `ok: false, safeMode: true`.
4. The risk engine uses `settings = botContext.settings = mergedSettings` (has real MDX SL values).
5. `hasActivePlaceholderValues(settings)` checks `mergedSettings.stopLoss.triggerPercent` which is non-zero → returns `false` → no block added to `reasons`.
6. `risk.allowed = true`, execution proceeds.
7. The webhook response includes `validation: botContext.validation` — the stale pre-merge object — showing `ok: false`.

**The validator is not ignored; it's being queried against the wrong object.** The execution path is correct. The response is misleading. Fix: either re-validate against `mergedSettings` after the merge, or strip the stale `validation` from the response and report it from a separate post-merge check.

**Secondary stale field:** `environment.mode: "testnet"` in `config/settings.json`. The validator accepts "testnet" without error, but the system runs on Bybit mainnet (controlled by `BYBIT_BASE_URL` env var). This field is purely documentary and currently false.

### Issue 2: Bot2 `dcaPolicy.enabled: true` vs `dca.enabled: false` in Resolved Settings

**Confirmed. The two fields are different mechanisms. DCA is running for Bot2. No code bug.**

- `settings.dca.enabled: false` (global config, from `config/settings.json`) — this is the legacy Sprint-15 DCA scaffolding. **It is not read by the execution path.** `executePaperTrade` calls `resolveDcaStrategy` which reads `bot.dcaPolicy.enabled` from the registry, not `settings.dca.enabled`.
- `bots.json` Bot2: `dcaPolicy.enabled: true` → `resolveDcaStrategy` returns `{ enabled: true }` → DCA add executes.
- Confirmed by the 2026-04-08 review pack: `ENTER_LONG_DCA_ADD@2026-04-07T22:31:03.879Z status=submitted` for Bot2.

**What DCA does for Bot2:** Places stage 1 at 50% of computed qty immediately on entry. After a 1–2 candle delay (~60s at 150m timeframe this could wait up to 2 candles ≈ 5 hours, but `addTiming.minDelayCandles = 1` means minimum 1 candle ≈ actual setTimeout of 60 seconds in code), places remaining 50% unless: BE has armed, a TP has fired, or an opposite signal arrived. The second order has `retCode: 0` in the review pack confirming it reached mainnet.

**Risk implication:** Bot2 effectively doubles its position if guards don't fire. At 6x leverage with a 6% SL, max loss per trade with DCA = `account_balance × 10% × 6 × 6% × 2 = 7.2% of balance`. For a 50 USDT wallet: ~3.6 USDT maximum loss per trade.

### Issue 3: Bot7 (FLOKIUSDT) Has Never Executed — Signal Chain Break

**Confirmed. Two independent breaks, one of which is still active.**

**Historical break (now resolved):** At the time of the 2026-04-07/08 review packs, Bot7 was `enabled: false`. The risk engine correctly blocked execution. The review pack confirms: `enabled: False`, one signal received (`ENTER_LONG@2026-04-07T22:30:01.183Z`), zero executions.

**Active break (still present):** `FLOKIUSDT` is not in `settings.trading.allowedSymbols: ["STXUSDT", "NEARUSDT", "CRVUSDT"]`.

Code path (`src/risk/evaluateSignal.js:line ~38`):
```js
if (!settings.trading.allowedSymbols.includes(botContext.symbol)) {
  reasons.push(`Bot symbol ${botContext.symbol} is not in allowedSymbols`);
}
```
This adds to `reasons`, making `risk.allowed = false`. Execution is blocked regardless of the bot's `enabled` state.

**This same break blocks Bots 3, 5, 6, and 8** (PAXGUSDT, WIFUSDT, IPUSDT, PUMPFUNUSDT are all absent from `allowedSymbols`).

**Additional concern:** The 2026-04-07 review pack shows zero TradingView signals received for Bot7 in the reviewed window (only 1 arrived on 2026-04-07). This may indicate Bot7's TradingView source bot is configured for a different exchange or timeframe pairing that doesn't fire frequently. Without confirmed TradingView-side configuration, it's unknown whether Bot7 receives signals at all under normal market conditions.

**Summary for Bot7:** Signal chain has two breaks: (1) `allowedSymbols` blocks execution even when Bot7 is enabled; (2) TradingView signal arrival rate for Bot7 is unknown/possibly low.

### Issue 4: Bot2 Cumulative P&L −20.71 USDT (−41%) — Consistency with Risk Controls

**The TP re-fire bug (pre-Sprint-11) is confirmed as a major distorting factor. Whether −41% represents over-risk or accumulated bug damage requires post-fix verification.**

Evidence from review pack (trade 2026-04-07T22:30:02Z through 2026-04-08T08:33:53Z):
- 56 consecutive `exit_reason: take_profit` events, ALL at `trigger_percent: 4.22`, `close_percent: 8.0`
- Quantities decrement: 5.3 → 4.9 → 4.5 → ... → 0.1 coins per close
- This is the TP re-fire bug in action: the TP1 check keeps firing every management loop cycle (15s) and closing 8% of remaining position, reducing to zero over 56 cycles (~14 minutes)
- Sprint 11 (`4398c8d`) added `trade_state_events` action key deduplication to prevent this

**What the bug did:** Each TP1 trigger closed 8% of the remaining position at ~1.36 USDT/NEAR (entry was ~1.298). This trade was profitable (price moved up to TP1 level) but the exit was fragmented over 56 micro-closes instead of one clean 8%-close. From a P&L perspective this trade likely generated a small profit, not a loss — the bug distorted the mechanics of the exit but didn't necessarily create losses on a winning trade.

**What caused the −41%:** The P&L figure must come from the full history of Bot2 trades including losses, not just this one trade. Without access to the current DB or a complete trade history, the breakdown cannot be traced here. Key risk factors that could produce −41% on a 50 USDT wallet:

- At 50% accountPercent (pre-MDX-merge, which hardcodes 10%): margin per trade = 25 USDT, notional = 100 USDT at 4x leverage. A single 6% SL hit = −6 USDT. That's 3 SL hits to reach −18 USDT, close to the −20.71 total.
- The review pack trade shows entry_notional_usd = 43.75 USDT for stage 1. With accountPercent 10%, this implies effective balance ≈ 218 USDT — inconsistent with a 50 USDT wallet. Either: accountPercent was 50% at trade time (before the 10% hardcode was effective), the wallet balance was higher, or the 50 USDT starting balance refers to Bot2's initial subaccount deposit and the balance grew/shrank.
- DCA doubling the position amplifies SL losses 2× when the add fires before the SL

**Risk controls verdict:** With **current** settings (aggressive profile, 6x leverage, 10% accountPercent): max per-trade loss = 7.2% of balance with DCA, 3.6% without. At 50 USDT, that's 3.6 USDT max. Six such losses = −21.6 USDT, consistent with −41%. So the math can work even with current settings over 6+ losing trades. The controls appear consistent *if* the SL was actually executed. The pre-Sprint-11 management bugs (bot-unaware exit management, stale BE state) could have caused premature exits or missed SLs on prior trades, contributing to the real loss figure.

**Recommendation:** Pull the current Bot2 wallet balance and trade history from Bybit API. Verify all trades post-Sprint-11 show clean single-level TP execution and correct SL triggers.

---

## 7. Additional Code and Runtime Flags

### Flag A: `allowedSymbols` is Critically Stale

`config/settings.json` → `trading.allowedSymbols: ["STXUSDT", "NEARUSDT", "CRVUSDT"]`

Only 3 of the 8 bot symbols are listed. The 5 bots enabled since 2026-04-09 (Bots 3, 5, 6, 7, 8) are execution-blocked. This is **the single highest-priority code fix required** to make the newly enabled bots functional.

Note: The `allowedSymbols` check uses the merged settings, but the `trading` section of the merged settings is NOT overridden by MDX (only `positionSizing`, `takeProfit`, `stopLoss`, `breakEven` are merged). So this field always comes from the base `config/settings.json`.

### Flag B: `.env` Path Split

Two different paths are in active use simultaneously:
- `/home/ubuntu/.openclaw/.env` — shell env source, execution credentials
- `/home/ubuntu/.openclaw/workspace/.env` — management loop credential resolution

If both files exist, management loop and execution may use different API keys. No confirmation that both files exist, are the same, or are symlinked.

### Flag C: Management Loop Manages All Enabled Bots Including Newly-Enabled Ones Without Confirmed Credentials

`startTradeManagementLoop` iterates all `registry.bots.filter(bot => bot.enabled)` — currently 7 bots (1,2,3,5,6,7,8). For each, it calls `manageTpSl` and `manageBreakEven` which both call `resolveBotContext` → `resolveBotCredentials`. If `S2_BOT3_API_KEY`, `S2_BOT5_API_KEY`, etc. are not in the env file, `resolveBotCredentials` throws: `Missing credential env for Bot3: S2_BOT3_API_KEY`. The management loop catches per-bot errors (`logger.warn('Trade management bot error')`), so this won't crash the service, but it will produce a warning on every 15-second tick for each bot without credentials.

### Flag D: S3 Scoring Against Wrong Exchange URL

`createServer.js` line 166:
```js
const bybitBaseUrl = process.env.BYBIT_BASE_URL || 'https://api-demo.bybit.com';
```

If `BYBIT_BASE_URL` is set to the mainnet URL (as required for live execution), S3 scoring also uses mainnet klines. This is actually correct behavior — mainnet klines are the right source for scoring live mainnet signals. But if `BYBIT_BASE_URL` is not set, S3 tries to fetch klines from the demo endpoint, which may have limited symbol coverage and different price data.

### Flag E: Bot6 Has Empty Aggressive Profile

`mdx/Bot6.source.json` aggressive profile has `tpTargetsPercent: []`, `tpAllocationsPercent: []`, `stopLossPercent: null`, `slToBeTrigger: null`, `leverage: null`. `resolveMdxSettings` would throw immediately on `validatePercentArray('tpTargetsPercent', [])`. Currently not a live issue (Bot6 uses balanced), but if someone changes `bots.json` to `"mdxProfile": "aggressive"` for Bot6, the webhook server would throw on startup or at first Bot6 signal.

### Flag F: Bot3 (`PAXGUSDT`) Has 8x Leverage on a Balanced Profile

Bot3 balanced leverage is 8x — the highest of any bot. At 8x leverage with a 3% SL, the per-trade loss is `balance × 10% × 8 × 3% = 2.4%` of balance per trade without DCA. While within the configured `maxLeverage: 10`, this is unusually high for a profile named "balanced" and warrants operator attention before Bot3 goes live.

### Flag G: Management Loop Does Not Check `executionEnabledBots` for Position Management

The management loop uses `registry.bots.filter(bot => bot.enabled)` — same as `executionEnabledBots`. This is correct and consistent. Bot4 (enabled: false) is NOT managed by the loop, meaning if Bot4 has an open position from before it was disabled, that position is no longer being managed for TP/SL/BE. [INFERRED — cannot confirm whether Bot4 had an open position when it was disabled on 2026-04-10.]

### Flag H: GitHub Actions Deploy Still Points to `/tmp/qs2_review/`

The `deploy.yml` on `main` rsyncs the repo to `/tmp/qs2_review/`. If the EC2 local modification to `run-webhook-with-env.sh` points to a different runtime directory, the next push to `main` will overwrite that script in `/tmp/qs2_review/` — reverting the modification and potentially breaking the running service. This is a deploy-time trap that must be resolved before any code is pushed to main.

---

## 8. Proposed First Task Batch

Tasks are ordered by urgency. "Live-safe" means the task can be done while the system is trading without requiring a service restart or maintenance window. "Requires maintenance window" means a service restart is needed.

---

### Task 1 — Understand and Commit EC2 Local Modification to `run-webhook-with-env.sh`

**Priority: CRITICAL. Do this before anything else.**

**What:** SSH to EC2, `cat /tmp/qs2_review/scripts/run-webhook-with-env.sh` (or wherever it currently lives), diff against committed version, understand what path changes were made and why, then commit the correct version to the repo.

**Why:** Any push to `main` currently triggers an rsync that would overwrite this file on EC2 with the committed (old) version. If the EC2 modification is load-bearing (e.g., pointing to a different runtime dir), the next deploy would break the running service silently.

**Blast radius:** High if skipped (deploy overwrites critical file). Low once done (read-only investigation + one commit).

**Live-safe:** Yes (read-only investigation + commit, no service changes).

---

### Task 2 — Fix `allowedSymbols` in `config/settings.json`

**Priority: HIGH.**

**What:** Add the 5 missing symbols to `trading.allowedSymbols`:
```json
"allowedSymbols": ["STXUSDT", "NEARUSDT", "CRVUSDT", "PAXGUSDT", "WIFUSDT", "IPUSDT", "FLOKIUSDT", "PUMPFUNUSDT"]
```

**Why:** Bots 3, 5, 6, 7, 8 are currently execution-blocked by this check. All 5 have been enabled in the registry since 2026-04-09 but have never traded.

**Blast radius:** Medium. This change plus a deploy immediately exposes 5 new bots to live execution if they receive signals. Should be combined with Task 3 (credential verification) and only deployed once those bots have confirmed API credentials.

**Requires:** Confirm all 8 bot credentials exist in `.env` before deploying. Confirm `allowedSymbols` is the only remaining block for each bot.

**Live-safe:** Code change is safe; deploy requires service restart (but restart is low-risk).

---

### Task 3 — Verify API Credentials Exist for All 8 Bots

**Priority: HIGH (prerequisite for Task 2 deploy).**

**What:** On EC2: `grep -E '^S2_BOT' /home/ubuntu/.openclaw/.env | cut -d= -f1` (do not print values). Confirm all 16 vars (`S2_BOT1_API_KEY` through `S2_BOT8_API_SECRET`) are present.

**Why:** Missing credentials cause management loop to emit a warning every 15 seconds per missing bot and would cause execution to throw on live signals.

**Blast radius:** Read-only check. No changes needed if all keys exist.

**Live-safe:** Yes.

---

### Task 4 — Fix Stale `validation` Object in API Response (Known Issue 1)

**Priority: MEDIUM.**

**What:** In `resolveBotSettings.js`, re-run `validateSettingsObject(mergedSettings)` on the merged settings before returning, and use that as the returned `validation` object instead of the base-settings validation. Alternatively, document clearly that the response `validation` field reflects the base config, not the merged runtime config.

**Why:** Every API response currently shows `validation.ok: false, safeMode: true`, which is misleading and makes legitimate execution look like a misconfiguration. Any alerting or monitoring built on this field would fire continuously.

**Code reference:** `src/config/resolveBotSettings.js` lines 42–61 (the merge block). The fix is to call `validateSettingsObject(mergedSettings)` after the merge and return that instead of `validated.validation`.

**Blast radius:** Low (cosmetic to API response; no execution path change).

**Live-safe:** Yes (requires service restart to take effect but no execution risk).

---

### Task 5 — Reconcile `.env` Path Split (Flag B)

**Priority: MEDIUM.**

**What:** Pick one canonical `.env` path. Update `scripts/run-webhook.js` line 19 to use `/home/ubuntu/.openclaw/.env` (matching the shell script and execution path). Or use a symlink between the two locations.

**Why:** The split between `/home/ubuntu/.openclaw/.env` and `/home/ubuntu/.openclaw/workspace/.env` is an accident waiting to happen if someone rotates credentials in one file but not the other.

**Blast radius:** Low (path standardization only).

**Live-safe:** Yes if file exists at the chosen path before deploying.

---

### Task 6 — Fix `environment.mode: "testnet"` in `config/settings.json`

**Priority: LOW (cosmetic).**

**What:** Change `"mode": "testnet"` to `"mode": "mainnet"` in `config/settings.json`.

**Why:** The system is live on mainnet. The validator enforces `mode` must be "testnet" or "mainnet"; currently it accepts "testnet" without error but the value is false. Any future tooling that reads this field would make wrong assumptions.

**Note:** Changing this will also fix the validation result because the current `environment.mode` check passes for "testnet". There may be downstream validation logic that gates on this value in future. Confirm the validator does not block "mainnet" (it allows both; confirmed in `validateSettings.js`).

**Blast radius:** Negligible.

**Live-safe:** Yes.

---

### Task 7 — Fix Bot6 Empty Aggressive Profile (Flag E)

**Priority: LOW (defensive).**

**What:** Either populate the aggressive profile in `mdx/Bot6.source.json` with real values from the source bot, or add a runtime guard in `resolveMdxSettings` that throws a clear error before the existing `validatePercentArray` panic.

**Why:** Currently safe (balanced profile is used), but a future config change to Bot6's profile would cause a crash.

**Blast radius:** Negligible (MDX file fix; no behavior change unless profile is changed).

**Live-safe:** Yes.

---

### Task 8 — Merge sprint-scope-review Up to main

**Priority: MEDIUM (housekeeping).**

**What:** Merge or fast-forward `sprint-scope-review` to include the 2 commits on `main` (`bfa467e` and `238bf8b`).

**Why:** The working branch is 2 commits behind the production branch. PRs from sprint to main will have a non-trivial diff on settings.json and the workflow file, creating confusion.

**Blast radius:** Low if done cleanly. Does mean sprint branch gets `s3.enabled: true` — verify this is the desired state for sprint development.

**Live-safe:** Yes (git operation only, no deploy).

---

### Task 9 — Delete `access-test` Branch

**Priority: LOW (hygiene).**

**What:** `git push origin --delete access-test`

**Why:** 108 commits behind main, contains only Trello/identity bootstrap code from project inception, no Q_S2 code. No reason to keep.

**Blast radius:** Negligible. Cannot be accidentally deployed (not referenced in GitHub Actions).

**Live-safe:** Yes.

---

### Task 10 — Verify Sprint-11 TP Fix and Post-Fix Bot2 P&L (Known Issue 4)

**Priority: MEDIUM (operational confidence).**

**What:** Query the live DB: `SELECT * FROM s3_scores ORDER BY id DESC LIMIT 5; SELECT * FROM trade_state_events ORDER BY id DESC LIMIT 20; SELECT * FROM exit_events ORDER BY id DESC LIMIT 10;` (run from EC2 or via `scripts/checkS3Scores.js`). Confirm no TP-level appears more than once per trade ID in `trade_state_events`. Pull Bot2 Bybit trade history for post-April-8 trades and compute realized P&L.

**Why:** Sprint 11 fix was committed but live verification post-fix hasn't been documented in any recap. The -41% figure needs a clean post-fix baseline.

**Blast radius:** Read-only investigation.

**Live-safe:** Yes.

---

### Task 11 — Resolve Bot7 Signal Question

**Priority: MEDIUM (can Bot7 even trade?).**

**What:** After resolving Tasks 2 and 3 (allowedSymbols + credentials), check TradingView alert history for Bot7 FLOKIUSDT signals. Confirm the source bot on TradingView is active and configured to send `ENTER_LONG_Bot7` / `ENTER_SHORT_Bot7` alerts to the webhook endpoint.

**Why:** The 2026-04-07 and 2026-04-08 review packs both show zero or near-zero TradingView signals for Bot7. If the TradingView alert is not wired up, fixing allowedSymbols won't help.

**Blast radius:** Read-only investigation.

**Live-safe:** Yes.

---

### Task 12 — Document Cloudflared Config Structure

**Priority: LOW (operational hygiene).**

**What:** On EC2, `cat /etc/cloudflared/config.yml` (not the credentials JSON), add a redacted version to `docs/` or `deploy/`, and note the path in `docs/runtime-status.md`.

**Why:** The tunnel is load-bearing (it's the only public ingress path). Its config structure is completely undocumented in the repo. A future rebuild from scratch would have no reference.

**Blast radius:** Documentation only.

**Live-safe:** Yes.

---

_END OF STATE_OF_SYSTEM.md_
