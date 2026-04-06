# Sprint F3H Recap - Execution Sizing Fallback for Missing Price Ticks

_Last updated: 2026-04-06 UTC._

## Objective

Remove the execution-path blocker where otherwise actionable multi-token signals still failed before order submission because no stored internal price tick was available for sizing.

## Root cause

`executePaperTrade()` in `src/execution/bybitExecution.js` was still relying on a stored internal tick from `price_ticks` for sizing.

This created a blocker for newer multi-token symbols when the tick store did not already contain a current row for the symbol, producing:

- `No stored price tick available for sizing`

## Fix applied

Updated `src/execution/bybitExecution.js` to:

- prefer a stored symbol-specific tick when available
- fall back to a live Bybit market price (`/v5/market/tickers`) when no stored tick exists
- surface the sizing price source in the execution result

## Validation

Local validation confirmed:

- the old missing-tick failure is removed
- Bot4 / `CRVUSDT` can now compute sizing using `bybit_ticker` as the fallback source
- execution progresses into the order path instead of dying at the sizing gate

## Interpretation

This removes a leftover dependency from the earlier single-symbol / pre-populated tick model and makes multi-token execution much more robust.

It does not guarantee order success by itself, but it should allow actionable signals to reach real order-attempt creation even when the internal tick store is empty.
