# Sprint 13 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint 13 implemented TP/SL management using mark-price trigger evaluation, with the agreed demo validation configuration:

- TP1 = 0.25%, close 50%
- TP2 = 0.5%, close remaining 50%
- TP3+ unused/disabled
- SL = 0.5%
- mark price used as trigger basis

Break-even logic was intentionally left out for Sprint 14.

## What was delivered

### TP/SL trigger evaluation

Added TP/SL evaluation logic that:

- computes position PnL % from live position side, entry price, and mark price
- selects the highest reached take-profit level
- triggers stop-loss when adverse move reaches configured threshold
- returns hold/no-action when no threshold is reached

### Exit execution support

Added TP/SL close-order execution support that can:

- submit reduce-only close orders
- support partial TP closes
- support full SL closes
- record exit events with exit reason and trigger metadata

### Persistence support

Added `exit_events` persistence for TP/SL close actions.

### Validation scripts

Added:

- `scripts/test-tp-sl-simulated.js`
- `scripts/test-tp-sl-live.js`

## Validation

### Simulated validation

Simulated validation passed for the agreed demo rules:

- profitable move to 0.25% triggered TP1 for 50%
- profitable move to 0.5% triggered TP2 for 50%
- adverse move to -0.5% triggered SL for 100%
- sub-threshold move produced hold/no action

A bug was found during validation where TP2 incorrectly returned TP1 because the first matching level was used. This was fixed by selecting the highest reached TP level.

### Live-path validation

A live-path TP/SL management check ran successfully against the runtime DB path and returned `no_position`, confirming the execution path runs safely even when no open position exists.

## Interpretation

Sprint 13 is complete for the agreed TP/SL management scope:

- partial TP handling
- full SL handling
- mark-price evaluation
- exit-event persistence
- validation coverage for TP1, TP2, SL, and hold behaviour

## Non-goals respected

Sprint 13 did not attempt to add:

- break-even logic
- DCA logic
- long-horizon permanent live TP configuration design beyond what was needed for demo validation

## Suggested next-step options

Natural next work after Sprint 13:

- Sprint 14 break-even logic
- integrate exit-event details into reporting summaries
- improve long-running live/demo config separation if needed
