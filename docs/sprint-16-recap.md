# Sprint 16 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint 16 synced the live runtime to the current repo logic, enforced close-first reversal behaviour in the active runtime, and reset the Bybit demo account to a clean flat state for fresh monitoring.

## What was delivered

### Runtime sync

Synced runtime-critical files from the repo into the live runtime under `/tmp/qs2_review`:

- `src/execution/bybitExecution.js`
- `src/db/sqlite.js`
- `src/webhook/createServer.js`
- `src/config/validateSettings.js`

This was required because live runtime behaviour had drifted behind the current repo implementation.

### Validation consistency fix

The validator was updated so disabled TP levels with zero values no longer block trading while enabled TP/SL/BE zero placeholders still do.

This resolved the earlier inconsistency where the runtime could trade successfully but still reported config-validation errors.

### Position reset / clean account state

The current BTCUSDT demo position was explicitly closed and open BTCUSDT orders were cleared.

Result after reset:

- BTCUSDT position size = `0`
- BTCUSDT open orders = none

## Validation

### Runtime state

After restart, the live webhook service was confirmed running from `/tmp/qs2_review` and webhook validation returned cleanly:

- `ok: true`
- `safeMode: false`

### Account reset

Before reset:
- open BTCUSDT position existed
- no open BTCUSDT orders existed

Reset actions:
- submitted a reduce-only market close order for the remaining BTCUSDT position
- cancelled all BTCUSDT open orders

After reset:
- BTCUSDT position flat (`size = 0`)
- BTCUSDT open orders empty

## Interpretation

Sprint 16 is complete for the agreed runtime-sync + clean-account-reset scope.

The live runtime is now aligned more closely with the repo implementation, and the demo account has been returned to a flat state so future monitoring can start cleanly from the next signal.

## Non-goals respected

Sprint 16 did not attempt to add new trading strategy features.

## Suggested next-step options

Natural next actions after Sprint 16:

- observe the next live signal from a clean flat account
- verify close-first reversal behaviour live after runtime sync
- later switch TradingView chart feed from Binance BTC perp to Bybit BTC price data for tighter signal/execution alignment
