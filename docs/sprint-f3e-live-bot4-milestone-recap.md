# Sprint F3E/F3H/F3I Live Bot4 Milestone Recap

_Last updated: 2026-04-06 UTC._

## Objective

Push S2 beyond signal observability and into real multi-token live order submission on Bybit.

## Milestone outcome

A live Bot4 (`CRVUSDT`) replay successfully progressed through:

- TradingView-style webhook auth
- signal parsing
- bot routing
- symbol routing
- actionable risk decision
- execution sizing
- Bybit order submission
- staged-entry / DCA add submission

## What was proven live

### Runtime unlock

The runtime gate was opened far enough that replayed Bot4 signals became:

- `allowed: true`
- `actionable: true`
- `executionQueued: true`
- `tradingEnabled: true`

### Price fallback

Execution no longer died when no stored internal price tick existed for `CRVUSDT`.
Instead it could use a live Bybit market ticker reference price for sizing.

### Correct sizing basis

Execution sizing no longer treated 5000 USD as the active sizing base.
The corrected rule now uses:

- `effective account balance = min(actual account balance, 5000 USD)`
- `trade notional = effective account balance × account-use percent × leverage`

### Real Bybit submissions

The resulting order attempts for Bot4 showed:

- `symbol = CRVUSDT`
- sane notional sizes around 50 USD per staged leg
- successful initial entry submission
- successful DCA add submission

## DB evidence

Recent `order_attempts` and `staged_entry_events` confirmed:

- initial Bot4 entry submitted
- Bot4 DCA add submitted
- matching `dca_events` recorded scheduled/executed add behavior

## Interpretation

This is the strongest S2 live execution milestone so far.

It demonstrates that S2 is now capable of:

- receiving a valid multi-token bot signal
- resolving the correct subaccount and symbol
- sizing from the intended capped-real-balance rule
- and submitting a real staged live position to Bybit

## Remaining caution

The shared `config/settings.json` still carries some placeholder-era values (for example `stopLoss.triggerPercent = 0.0`) that should be cleaned up in a later pass. But they no longer prevent the core Bot4 live staged-entry milestone from being demonstrated.
