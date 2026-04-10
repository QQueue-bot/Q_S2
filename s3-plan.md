# S3 Shadow Scoring v1 — Implementation Plan

No files have been modified.

---

## Files Inspected

| File | Purpose |
|---|---|
| src/webhook/createServer.js | Signal ingestion — injection point for S3 |
| src/risk/evaluateSignal.js | Existing risk engine — pattern to mirror |
| src/db/sqlite.js | Persistence — where to add `s3_scores` table |
| src/execution/bybitExecution.js | Live execution — must remain untouched |
| src/execution/evaluateDcaEntry.js | Guard logic — prior pattern for conditional scoring |
| config/settings.json | Runtime config — where S3 config section goes |
| src/config/validateSettings.js | Schema validation — extend for S3 config |
| src/config/resolveBotContext.js | Bot context resolver — pass S3 config through |
| src/signals/parseSignal.js | Signal parsing — check what metadata is available |
| config/bots.json | Bot registry — per-bot S3 enable flag possible |

---

## Files Likely Changed

| File | Change |
|---|---|
| src/db/sqlite.js | Add `s3_scores` table (signal_id, bot_id, symbol, score, components_json, created_at) |
| config/settings.json | Add `s3` config block: enabled, weights, factor flags |
| src/webhook/createServer.js | Call `computeS3Score()` after risk check, before execution queue — log only |
| src/config/validateSettings.js | Validate S3 config section |

**New file:**

| File | Purpose |
|---|---|
| src/scoring/computeS3Score.js | S3 engine: factor computation + weighted aggregation + logging |

---

## Safest Implementation Sequence

**Step 1 — DB schema** (zero risk)
Add `s3_scores` table to src/db/sqlite.js. No reads, no execution impact.

**Step 2 — Config** (zero risk)
Add `s3` block to config/settings.json with `enabled: false` initially. Extend src/config/validateSettings.js. S3 stays inert.

**Step 3 — Score engine** (zero risk — new file only)
Create `src/scoring/computeS3Score.js`. Computes weighted score from available inputs, returns `{ score, components }`. No side effects.

**Step 4 — Hook into webhook** (low risk)
In src/webhook/createServer.js, after the risk check and before `setImmediate(executePaperTrade)`:
```js
const s3Result = await computeS3Score(signal, botContext, s3Config);
recordS3Score(s3Result);
logger.info('[S3]', s3Result);
// execution proceeds unchanged
```
The score is fire-and-forget. No branching on it. Execution path is identical whether S3 is enabled or not.

**Step 5 — Validate in shadow** (observation only)
Run live signals, review `s3_scores` table and logs. No action taken from score.

---

## Factor Availability

| Factor | Data Source | Status |
|---|---|---|
| RSI position | TradingView alert payload or MDX metadata | **Unknown — see Q1** |
| Distance from VWAP | TradingView alert payload or MDX metadata | **Unknown — see Q1** |
| Volume spike | TradingView alert payload or MDX metadata | **Unknown — see Q1** |
| HTF trend alignment | Derivable from `price_ticks` (simple MA cross) | Available, needs computation |
| Win/loss streak | Derivable from `exit_events` + `trade_state_events` | Available, needs query |
| Support/resistance context | No current source | **Unknown — see Q2** |

---

## Risks / Assumptions

- **S3 hook adds latency to webhook handler.** Computation should be synchronous and fast (< 5ms). If any factor requires a DB query (win/loss streak), benchmark it.
- **Missing factors don't break scoring.** Engine should assign neutral weight (0.5) for any factor that cannot be computed, with a flag in `components_json`.
- **TradingView alert format.** Current `parseSignal.js` only extracts `signal` and `botId`. If RSI/VWAP/volume are not in the alert, they cannot be scored at Step 4 without a separate Bybit candle fetch.
- **HTF trend from `price_ticks`** assumes sufficient tick history exists. If the DB is young, trend signals will be unreliable.
- **No execution branching on score** — the only way S3 can affect live execution is if someone wires it to `evaluateSignal.js`. That is explicitly out of scope.

---

## Open Questions

**Q1: What data is in the TradingView alert payload?**
The current parser only reads `signal` and `botId`. If RSI, VWAP distance, and volume spike are already embedded in the alert JSON from TradingView, scoring those is straightforward. If not, they require a separate Bybit candle/kline fetch — adding latency and a new external call. Do the alerts currently carry this metadata?

**Q2: How are support/resistance levels defined?**
Are these static levels per symbol (e.g., a config file or manual table), dynamically computed (pivot highs/lows from candle data), or coming from an external source? This factor is the most ambiguous — happy to skip it in v1 or stub it as a placeholder.

**Q3: Should S3 score all 8 bots, or a subset?**
If certain bots are experimental or have low trade frequency, enabling S3 selectively (per-bot flag in `bots.json`) may make validation easier.

**Q4: Score output format preference?**
The plan logs `{ score: 0-100, components: { rsi: 0.7, vwap: 0.4, ... } }` to both the `s3_scores` table and `logger.info`. Is that sufficient, or do you want it surfaced in the dashboard as well?

---

Ready to proceed to implementation once Q1 and Q2 are confirmed. Steps 1–3 (DB, config, engine file) can start immediately without any answers — they're fully isolated.
