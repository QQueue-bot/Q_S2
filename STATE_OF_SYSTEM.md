# STATE_OF_SYSTEM.md — Q_S2 Handover Assessment

_Generated: 2026-04-24 UTC. Assessor: Claude Sonnet 4.6._
_Updated: 2026-04-24 UTC — EC2 live inspection completed via SSH. All `[INFERRED]` findings have been replaced with confirmed data or explicitly retained where direct observation was not possible._

---

## Orientation Note

This assessment was conducted in two phases:

**Phase 1 (read-only orientation):** Local macOS clone at `/Users/ianhenderson/Q_S2` on branch `handover/state-of-system`. Source files, MDX configs, and sprint documentation reviewed; EC2 not yet accessible.

**Phase 2 (EC2 live inspection):** SSH access confirmed via `openclaw` alias → `16.192.15.119`. EC2 runtime at `/home/ubuntu/.openclaw/workspace/Q_S2`, branch `sprint-scope-review`. Key files spot-checked via MD5 (createServer.js, evaluateSignal.js, bybitExecution.js, Bot2.source.json — all byte-for-byte identical to local clone). config/settings.json differs as expected (mainnet mode, all 8 symbols). All `[INFERRED]` tags in Section 2 have been replaced with confirmed observations. Credential hygiene audit completed. The EC2 runtime has 3 commits ahead of the local clone's sprint-scope-review that were not present during Phase 1, notably commit `e5f0398` which added all 8 bot symbols to `allowedSymbols` and set mode to mainnet.

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

> **EC2 DIRECTLY INSPECTED via SSH** (`openclaw` → `16.192.15.119`). All items confirmed live on 2026-04-24 UTC unless noted.

### Services — Confirmed Live

**`q-s2-webhook.service`** — ACTIVE (running). Installed unit at `/etc/systemd/system/q-s2-webhook.service`:

```ini
[Service]
WorkingDirectory=/home/ubuntu/.openclaw/workspace/Q_S2
ExecStart=/home/ubuntu/.openclaw/workspace/Q_S2/scripts/run-webhook-with-env.sh
Environment=NODE_ENV=production
Environment=S2_DB_PATH=/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite
```

Running process: `node /home/ubuntu/.openclaw/workspace/Q_S2/scripts/run-webhook.js`

Live verification: `curl https://hooks.tbotsys.one/webhook/tradingview?secret=wrong` returned HTTP 401 — service is up and responding.

**`q-s2-tunnel.service`** — Confirmed installed at `/etc/systemd/system/q-s2-tunnel.service`. Tunnel `q-s2-webhook` is active: `hooks.tbotsys.one` → `127.0.0.1:3001` and `dashboard.tbotsys.one` → `127.0.0.1:3010`.

### Database — Confirmed Location

DB is at `/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite` (set by `Environment=S2_DB_PATH=...` in the installed systemd unit). This path survives reboots. The `/tmp/qs2_review` DB was lost on the prior reboot; the workspace DB was initialized fresh post-migration.

### Cloudflared — Confirmed Config

`~/.cloudflared/config.yml`:
```yaml
ingress:
  - hostname: hooks.tbotsys.one
    service: http://127.0.0.1:3001
  - hostname: dashboard.tbotsys.one
    service: http://127.0.0.1:3010
  - service: http_status:404
```

Credential file: `~/.cloudflared/b4698400-2a3d-4a11-ac02-824497ea4d5e.json` (permissions: `r--------` — correctly restricted).

Config file permissions: `rw-rw-r--` (664) — world-readable but non-sensitive; no immediate risk.

### Credentials — Confirmed

Active env file: `/home/ubuntu/.openclaw/.env` (1135 bytes, last modified Mar 31). Contains 20 variables including `S2_BOT1_API_KEY` through `S2_BOT8_API_SECRET` (all 16 bot credential vars confirmed present), `WEBHOOK_SECRET`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`.

Old testnet env: `/home/ubuntu/.openclaw/workspace/.env` (268 bytes, Mar 29) — contains `BYBIT_TESTNET_API_KEY`, `BYBIT_TESTNET_API_SECRET`, `WEBHOOK_SECRET`. Not used by the live service.

### Active Open Positions — Confirmed

As of 2026-04-24 inspection, four bots had open positions:
- **Bot1** (STXUSDT): LONG, at TP2 level, positive PnL
- **Bot5** (WIFUSDT): SHORT, at TP2 level, positive PnL
- **Bot6** (IPUSDT): SHORT, at TP2 level, positive PnL
- **Bot8** (PUMPFUNUSDT): SHORT, at TP2 level, positive PnL

Sprint 11 TP dedup confirmed working: journal shows `take_profit_skip_duplicate` entries for all active bots, indicating action-key deduplication is preventing re-fires.

### EC2 Git State — Confirmed

EC2 is on branch `sprint-scope-review`. It has **3 commits ahead of the local Mac clone's sprint-scope-review**:

```
d7177d3  Tidy docs and labels for current S2 runtime reality
ee7a639  Add 2026-04-24 full S2 review pack and raw review artifacts
e5f0398  Expand S2 execution allowlist to all bot symbols
```

Commit `e5f0398` is the critical one: added all 8 bot symbols to `allowedSymbols` in `config/settings.json` and changed `environment.mode` from `testnet` to `mainnet`. **Flags A and Issue 3 from Phase 1 are resolved on the runtime.** The local Mac clone needs `git pull` on sprint-scope-review to receive these commits.

Uncommitted changes on EC2 (confirmed via `git diff HEAD`): only `scripts/run-webhook-with-env.sh` — the single-line exec path change from `/tmp/qs2_review/` to the workspace path. **This has now been committed on `handover/state-of-system` branch and pushed.**

---

## 3. EC2 State vs Repo State — Drift Analysis

### `scripts/run-webhook-with-env.sh` — **RESOLVED**

EC2 had one uncommitted change: the exec target changed from `/tmp/qs2_review/scripts/run-webhook.js` to `/home/ubuntu/.openclaw/workspace/Q_S2/scripts/run-webhook.js`. The `S2_DB_PATH` default in the script still references `/tmp/qs2_review/` but is overridden by the systemd `Environment=` directive, so this stale default has no effect at runtime.

**Status:** This change is now committed on `handover/state-of-system` (commit `006e9c6`) and pushed. The EC2 and repo are aligned for this file.

### `.env` Path Split — **CONFIRMED, PARTIALLY RESOLVED**

Both files exist on EC2:

| File | Size | Modified | Status |
|---|---|---|---|
| `/home/ubuntu/.openclaw/.env` | 1135 bytes | Mar 31 | **Active** — 20 vars, all 8 bot credentials |
| `/home/ubuntu/.openclaw/workspace/.env` | 268 bytes | Mar 29 | **Stale testnet only** — 3 vars |

The path split in code:

| Location | Path used |
|---|---|
| `scripts/run-webhook-with-env.sh` | `/home/ubuntu/.openclaw/.env` ← active file |
| `scripts/run-webhook.js` → management loop env init | `/home/ubuntu/.openclaw/workspace/.env` ← stale testnet file |
| `src/webhook/createServer.js` → execution | `/home/ubuntu/.openclaw/.env` ← active file |
| `src/config/resolveBotCredentials.js` default | `/home/ubuntu/.openclaw/.env` ← active file |

**Runtime behavior:** The shell script sources `/home/ubuntu/.openclaw/.env` (the active file) and exports all vars into the process environment before exec-ing the Node process. When `run-webhook.js` then tries to load `/home/ubuntu/.openclaw/workspace/.env` for the management loop, it finds the stale testnet file — but all the `S2_BOTn_*` keys were already injected via the shell export. So `process.env.S2_BOT1_API_KEY` etc. are already set; the workspace `.env` load is effectively a no-op for bot credentials (its `BYBIT_TESTNET_*` vars don't shadow anything that matters).

**Risk:** Low in current configuration, but if someone rotates keys in `/home/ubuntu/.openclaw/.env` and the management loop path ever changes precedence, credentials would silently revert to the testnet values. Standardize to one path.

### Installed Systemd Units vs Repo — **CONFIRMED DRIFT**

Installed `q-s2-webhook.service` on EC2 (post-migration):
```ini
WorkingDirectory=/home/ubuntu/.openclaw/workspace/Q_S2
ExecStart=/home/ubuntu/.openclaw/workspace/Q_S2/scripts/run-webhook-with-env.sh
Environment=NODE_ENV=production
Environment=S2_DB_PATH=/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite
```

Committed `deploy/systemd/q-s2-webhook.service` in repo:
```ini
WorkingDirectory=/tmp/qs2_review
ExecStart=/tmp/qs2_review/scripts/run-webhook-with-env.sh
Environment=NODE_ENV=production
Environment=S2_DB_PATH=/tmp/qs2_review/data/s2.sqlite
```

**All three paths differ.** The deployed unit file is correct; the repo unit file is stale. If someone runs `deploy.sh` and it copies the committed unit file to `/etc/systemd/`, the service would break. This is a deploy trap.

`q-s2-tunnel.service`: confirmed identical between installed and repo versions.

### `config/settings.json` Branch Divergence — **CONFIRMED**

| Branch | `s3.enabled` | `environment.mode` | `allowedSymbols` |
|---|---|---|---|
| EC2 `sprint-scope-review` (3 commits ahead) | `false` | `mainnet` | all 8 symbols |
| Local `sprint-scope-review` | `false` | `testnet` | 3 symbols only |
| Local `main` | `true` | `testnet` | 3 symbols only |

The 3 EC2-only commits (including `e5f0398`) must be pulled before doing any settings.json work locally.

### Orphaned `/tmp/qs2_review`

Confirmed wiped. The workspace DB at `/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite` is the current active DB — post-migration, fresh initialization. Pre-reboot trade history is gone (no backup mechanism exists).

### Files Outside Git — **CONFIRMED**

All load-bearing files outside the repo (confirmed to exist):
- `/home/ubuntu/.openclaw/.env` — active credentials (20 vars)
- `/home/ubuntu/.openclaw/workspace/.env` — old testnet file (not used by live service)
- `/etc/systemd/system/q-s2-webhook.service` — differs from repo version (see above)
- `/etc/systemd/system/q-s2-tunnel.service` — matches repo version
- `~/.cloudflared/config.yml` — tunnel routing config (world-readable, non-sensitive)
- `~/.cloudflared/b4698400-2a3d-4a11-ac02-824497ea4d5e.json` — tunnel credentials (permissions: `r--------`, correctly restricted)

---

## 4. Branch Analysis

> Note: EC2 is on `sprint-scope-review` with 3 commits ahead of the local Mac clone. Run `git pull origin sprint-scope-review` locally before doing any branch or settings work.

### EC2 `sprint-scope-review` (the live runtime branch)

- **3 commits ahead of local Mac clone's sprint-scope-review** (and 3 + 2 = 5 commits ahead of local `main` on the axis that matters)
- Extra commits:
  - `e5f0398` — Expand S2 execution allowlist to all bot symbols; set mode mainnet
  - `ee7a639` — Add 2026-04-24 full S2 review pack and raw review artifacts
  - `d7177d3` — Tidy docs and labels for current S2 runtime reality
- The service runs directly from this branch checkout; no rsync/deploy pipeline currently active for sprint-scope-review

### Local `main` (GitHub default, deploy-wired)

- **5 commits behind EC2 sprint-scope-review** — missing the 3 EC2 commits above plus missing the 2 sprint commits below
- The GitHub Actions `deploy.yml` on `main` triggers on every push: SSH to EC2 → `bash /home/ubuntu/.openclaw/workspace/Q_S2/deploy.sh`
- **IMPORTANT:** The `deploy.sh` script's behavior determines whether a push to main overwrites the EC2 runtime. Must verify what `deploy.sh` does (git pull? rsync?) before any push to main.
- `config/settings.json` on main still has 3-symbol allowedSymbols and `s3.enabled: true` — both are stale relative to EC2 runtime

### Local `sprint-scope-review`

- **3 commits behind EC2 sprint-scope-review** — missing `e5f0398`, `ee7a639`, `d7177d3`
- After git pull, this branch will be current with EC2 runtime settings
- The 2 commits missing from main (`bfa467e` S3 enable, `238bf8b` inline-deploy workflow) are visible on this branch

### `handover/state-of-system` (this handover branch)

- Forked from `sprint-scope-review` at the Phase 1 starting point
- Contains: `STATE_OF_SYSTEM.md` (this document) + `scripts/run-webhook-with-env.sh` exec path fix
- Pushed to remote. Not wired to any deploy action. Safe to continue committing handover artifacts here.

### `access-test` (remote only, stale)

- **108 commits behind main.** Last commit: `5673b43 Add repo_access_test_2`.
- Created during initial Trello/identity bootstrap — contains `IDENTITY.md`, `USER.md`, `access_test` file, Trello helper scripts only.
- Has **no Q_S2 source code.**
- **Recommend deleting** — no merge value, no active use.

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

**CORRECTED BY EC2 INSPECTION.** Phase 1 reported an active `allowedSymbols` block for Bots 3, 5, 6, 7, 8. This was based on the local Mac clone's `config/settings.json` (3 symbols only). The EC2 runtime has commit `e5f0398` which added all 8 symbols to allowedSymbols. The allowedSymbols block is resolved on the runtime.

**Historical break (resolved at time of 2026-04-07/08 review packs):** Bot7 was `enabled: false`. Risk engine blocked execution. Review pack confirms: `enabled: False`, one signal received (`ENTER_LONG@2026-04-07T22:30:01.183Z`), zero executions.

**allowedSymbols (resolved on EC2 since commit `e5f0398`):** EC2's `config/settings.json` now has:
```json
"allowedSymbols": ["STXUSDT","NEARUSDT","PAXGUSDT","CRVUSDT","WIFUSDT","IPUSDT","FLOKIUSDT","PUMPFUNUSDT"]
```
All 8 bot symbols are listed. Local Mac clone does not yet have this commit — run `git pull origin sprint-scope-review`.

**Remaining open question:** The 2026-04-07 review pack shows only 1 TradingView signal received for Bot7 in the reviewed window. Whether the TradingView source bot for FLOKIUSDT is actively sending signals under current market conditions is unknown. This is a TradingView-side configuration question — confirm via TradingView alert history.

**Current Bot7 status:** Registry `enabled: true`, all 8 credentials confirmed in `.env`, allowedSymbols includes FLOKIUSDT, balanced profile settings valid. The only remaining uncertainty is TradingView signal frequency.

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

### Flag A: `allowedSymbols` — **RESOLVED ON EC2, LOCAL CLONE STALE**

**CORRECTED.** The EC2 runtime has all 8 symbols in `allowedSymbols` (commit `e5f0398` on `sprint-scope-review`). Bots 3, 5, 6, 7, 8 are NOT execution-blocked by this check at runtime.

The local Mac clone's `sprint-scope-review` and `main` branches still show 3 symbols — run `git pull origin sprint-scope-review` to sync. Before pushing any settings.json changes to main, ensure `e5f0398`'s allowedSymbols is included, or a deploy would revert the EC2 runtime to 3 symbols and re-block 5 bots.

**For documentation:** The `allowedSymbols` check uses the `trading` section of the merged settings. The `trading` section is NOT overridden by MDX (only `positionSizing`, `takeProfit`, `stopLoss`, `breakEven` are merged). So this field always comes from the base `config/settings.json` — any future symbol addition must update this file.

### Flag A2: Credential Hygiene Audit — **COMPLETED 2026-04-24**

Five checks run against EC2 repo and active env files:

| Check | Result |
|---|---|
| `.gitignore` covers `.env` | ✅ `.env` listed in `.gitignore` |
| `.env` not tracked by git | ✅ `git ls-files --error-unmatch .env` → not found |
| Working tree: no credential values in tracked files | ✅ `apiKey`/`apiSecret` references in `summaries/*.json` are env var names only (`S2_BOT1_API_KEY`), not values |
| Git history: no `.env` ever committed, no credential values in `-S` search | ✅ `git log --all --diff-filter=A -- .env` → empty; `git log -S 'API_KEY='` → empty; `git log -S 'WEBHOOK_SECRET'` → only README.md variable name reference |
| `.env` file permissions | ⚠️ Both `/home/ubuntu/.openclaw/.env` and `/home/ubuntu/.openclaw/workspace/.env` are `rw-rw-r--` (664 — world-readable on a single-tenant EC2, low immediate risk, should be 600) |

**Action needed:** `chmod 600 /home/ubuntu/.openclaw/.env /home/ubuntu/.openclaw/workspace/.env` on EC2. Low blast radius, live-safe.

### Flag B: `.env` Path Split — **CONFIRMED TWO FILES**

Two files exist (see Section 3 for detail). Runtime behavior is currently safe because the shell script sources the active file and injects all vars before Node starts — the workspace `.env` load in `run-webhook.js` is a no-op for bot credentials. Risk is low but the split should be resolved (standardize to `/home/ubuntu/.openclaw/.env`, update `scripts/run-webhook.js` line 19).

### Flag C: Management Loop Bot Credentials — **RESOLVED**

All 16 bot credential vars (`S2_BOT1_API_KEY` through `S2_BOT8_API_SECRET`) are confirmed present in `/home/ubuntu/.openclaw/.env`. No credential-missing warnings expected in management loop.

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

### Flag H: GitHub Actions Deploy and Systemd Unit Both Stale

**Deploy workflow (`main`'s `deploy.yml`):** Calls `bash /home/ubuntu/.openclaw/workspace/Q_S2/deploy.sh` on push to main. What `deploy.sh` does (git pull? rsync?) must be checked before any push to main. If it does a `git pull` of the current branch, pushing to main while EC2 is on sprint-scope-review would not affect the runtime. If it rsyncs from main, it would overwrite EC2 files including `config/settings.json` — reverting allowedSymbols to 3 symbols and breaking 5 bots.

**Committed systemd unit (`deploy/systemd/q-s2-webhook.service`):** Still references `/tmp/qs2_review` throughout. Confirmed differs from installed unit (Section 3). If `deploy.sh` installs this unit file, the service would attempt to run from `/tmp/qs2_review` and fail after a reboot.

**Action:** Read `deploy.sh` on EC2, understand its behavior, update the committed systemd unit file to match the installed version before any deploy action.

---

## 8. Proposed First Task Batch

Tasks are ordered by urgency. "Live-safe" means the task can be done while the system is trading without requiring a service restart or maintenance window. "Requires maintenance window" means a service restart is needed.

---

### Task 1 — Commit EC2 Local Modification to `run-webhook-with-env.sh` — **DONE**

**Status: COMPLETED 2026-04-24.** The EC2 uncommitted diff (exec path from `/tmp/qs2_review/` to workspace) was confirmed, committed on `handover/state-of-system` (commit `006e9c6`), and pushed. Deploy trap resolved.

---

### Task 2 — Fix `allowedSymbols` in `config/settings.json` — **DONE ON RUNTIME, LOCAL SYNC NEEDED**

**Status: RESOLVED ON EC2 RUNTIME.** Commit `e5f0398` on EC2's `sprint-scope-review` already added all 8 symbols. Bots 3, 5, 6, 7, 8 are no longer execution-blocked on the running system.

**Remaining action:** Run `git pull origin sprint-scope-review` on the local Mac clone to receive `e5f0398`. Before pushing anything to `main`, ensure this commit's `allowedSymbols` change is included — otherwise a deploy would revert the EC2 runtime to 3 symbols.

---

### Task 3 — Verify API Credentials Exist for All 8 Bots — **DONE**

**Status: CONFIRMED 2026-04-24.** All 16 bot credential vars (`S2_BOT1_API_KEY` through `S2_BOT8_API_SECRET`) confirmed present in `/home/ubuntu/.openclaw/.env`.

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
