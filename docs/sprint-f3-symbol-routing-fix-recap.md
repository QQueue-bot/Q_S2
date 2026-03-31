# Sprint F3 Symbol Routing Fix Recap

_Last updated: 2026-03-31 UTC._

## Context

During controlled S2 live validation, it became clear that bot-specific TradingView signals were arriving from the correct token charts, but runtime execution was still routing enabled bots into `BTCUSDT` because the live bot registry symbols had not been updated away from the original Milestone C placeholder mapping.

A second related issue was also identified: the trade management loop was still effectively managing only the default Bot1 path rather than iterating across all enabled bots.

## What was wrong

### 1) Bot registry symbol mapping was stale

`config/bots.json` still mapped all bots to `BTCUSDT`, even though the MDX source files defined distinct intended assets.

### 2) Trade management loop was single-bot biased

`src/runtime/startTradeManagementLoop.js` was using the old default path shape and was not iterating over all enabled bots. This meant TP/SL and break-even management were not properly structured for the enabled multi-bot runtime set.

## Fixes applied

### Updated bot symbol mapping in `config/bots.json`

- Bot1 → `IPUSDT`
- Bot2 → `NEARUSDT`
- Bot3 → `PAXGUSDT`
- Bot4 → `CRVUSDT`
- Bot5 → `WIFUSDT`
- Bot6 → `IPUSDT`
- Bot7 → `FLOKIUSDT`
- Bot8 → `PUMPFUNUSDT`

These symbols were taken from the MDX source files already committed in `mdx/`.

### Updated trade management loop in `src/runtime/startTradeManagementLoop.js`

- switched env path to `/home/ubuntu/.openclaw/.env`
- added registry loading through `loadBotRegistry(...)`
- iterated TP/SL and break-even management across all enabled bots instead of implicitly relying on the Bot1 default path

## Runtime action taken

The live runtime `config/bots.json` was updated directly and the active validation set was restored to:

- Bot1 enabled
- Bot2 enabled
- Bot4 enabled

After restart, the mobile dashboard correctly reflected token-specific routing instead of showing all enabled bots as `BTCUSDT`.

## Validation

Confirmed:

- mobile page now shows distinct per-bot symbols for the enabled bots
- Bot1 / Bot2 / Bot4 now display the intended assets rather than all showing BTC
- the issue was real runtime config drift, not a dashboard rendering bug

## Interpretation

This fix restores the intended S2 direction of bot-specific signal identity plus bot-specific execution symbol routing.

It does **not** yet prove full end-to-end live execution correctness for all token-specific paths under real signals; that still needs ongoing validation. But the known BTC-only registry defect is now addressed and visible state matches intended routing.
