# Sprint F3I Recap - Fix Live Sizing Basis and 5000 USD Cap

_Last updated: 2026-04-06 UTC._

## Objective

Fix the live sizing rule so S2 uses the real account balance for sizing, capped at 5000 USD, instead of incorrectly treating 5000 USD as the active sizing base.

## Intended rule

The correct sizing rule is:

- `effective account balance = min(actual account balance, 5000 USD)`
- `trade notional = effective account balance × account-use percent × leverage`

## Root cause

`executePaperTrade()` in `src/execution/bybitExecution.js` was still computing sizing with a hardcoded `maxMarginUsd: 5000`, which made the system behave as if every subaccount already had 5000 USD available for margin.

That produced absurdly large order quantities and caused Bybit to reject the order with insufficient available balance.

## Fix applied

Updated `src/execution/bybitExecution.js` to:

- fetch the live USDT wallet balance from Bybit
- compute `effectiveAccountBalanceUsd = min(actualAccountBalanceUsd, 5000)`
- size the trade from that effective account balance instead of from a fixed 5000 USD base
- expose `actualAccountBalanceUsd` and `effectiveAccountBalanceUsd` in the execution result for observability

## Validation

Local validation confirmed:

- Bot4 / `CRVUSDT` sizing now uses:
  - `actualAccountBalanceUsd = 50`
  - `effectiveAccountBalanceUsd = 50`
- sizing source remained `bybit_ticker`
- computed trade notional became approximately 100 USD rather than an absurd oversized order
- local execution path reached a successful Bybit order submission (`retCode: 0`)

## Interpretation

This fixes the sizing-basis bug and brings S2’s live order sizing in line with the intended cap behavior.

The 5000 USD value remains useful, but now as a ceiling rather than a permanent sizing base.
