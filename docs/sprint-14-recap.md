# Sprint 14 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint 14 implemented app-managed break-even logic using mark price and a trigger of 0.25%.

Agreed behaviour:

- monitor live position and mark price
- when mark-price PnL reaches 0.25%, arm break-even
- once break-even is armed, if price returns to entry, close the remaining position
- record/log break-even transition and protective close events

## What was delivered

### Break-even trigger evaluation

Added break-even decision logic that:

- computes current PnL % from live position side, entry price, and mark price
- arms break-even when configured trigger is reached
- detects return-to-entry after break-even is armed
- triggers a protective close when return-to-entry condition is met

### Persistence support

Added `break_even_events` persistence for:

- BE armed events
- BE close events

### Live/app-managed behaviour

This sprint uses app-managed BE rather than exchange-native stop mutation. That keeps the behaviour testable in the current architecture and leaves more advanced stop management out of scope.

### Validation scripts

Added:

- `scripts/test-break-even-simulated.js`
- `scripts/test-break-even-live.js`

## Validation

### Simulated validation

Simulated validation passed for the agreed BE behaviour:

- profitable move to 0.25% armed break-even
- later return to entry triggered break-even close
- sub-threshold/above-entry hold case returned no action while BE remained armed

### Live-path validation

A live-path BE check ran successfully against the runtime DB path and returned `no_position`, confirming the execution path runs safely even when there is no open position to manage.

## Interpretation

Sprint 14 is complete for the agreed app-managed BE scope:

- break-even arming logic
- break-even protective close logic
- break-even event persistence
- simulated validation coverage

## Non-goals respected

Sprint 14 did not attempt to add:

- DCA logic
- trailing-stop logic
- exchange-native stop mutation
- redesign of TP logic

## Suggested next-step options

Natural next work after Sprint 14:

- integrate BE events into reporting summaries
- decide whether exchange-native stop mutation is ever needed later
- continue to Sprint 15 DCA only if still desired
