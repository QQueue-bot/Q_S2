# Sprint 17 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint 17 focused on two operational problems:

1. ENTRY webhooks were timing out from TradingView's point of view.
2. TP / SL / BE management needed to be proven active in the live runtime.

## What was delivered

### Fast webhook acknowledgement

The webhook handling path was changed so actionable ENTRY signals are acknowledged quickly and execution work is queued in the background.

Result:
- fast HTTP acknowledgement
- TradingView timeout risk reduced significantly
- execution path preserved

### Active live trade management loop

Added a live runtime management loop that continuously calls:

- TP/SL management
- break-even management

This loop now runs as part of the webhook runtime process.

### Demo validation thresholds tightened

To make live management behaviour easier to observe during validation, the runtime test config was tightened to:

- TP1 = 0.15%
- TP2 = 0.30%
- BE trigger = 0.15%
- SL = 0.50%
- mark price remains the trigger basis

## Validation

### Webhook responsiveness

Live validation confirmed fast acknowledgement:

- ENTRY webhook returned in ~`0.02s`
- response included `executionQueued: true`

### TP / BE runtime behaviour

Live runtime data proved management is active:

#### Break-even events
- `armed`
- `closed_at_break_even`

#### Exit events
- multiple `take_profit` events
- one `break_even` exit event

### Account state proof

After the observed TP / BE sequence, the BTCUSDT Bybit demo position returned to:

- size = `0`
- flat state

This confirms the management loop is not just evaluating but also driving real execution outcomes.

## Important notes

During validation, some TP behavior appeared noisy, including repeated very small take-profit exits and one `0.000` quantity event. That suggests a later cleanup sprint may be needed around:

- repeated partial-exit behaviour
- minimum-quantity handling
- suppression of meaningless zero-qty exit attempts

These are cleanup issues, not proof failures.

## Interpretation

Sprint 17 is complete for the agreed scope:

- fast webhook acknowledgement path
- active live management loop
- live TP behaviour observed
- live break-even behaviour observed

## Non-goals respected

Sprint 17 did not attempt to add:

- multi-bot changes
- dashboard expansion beyond what was needed to validate runtime behaviour
- broader strategy redesign

## Suggested next-step options

Natural follow-up work after Sprint 17:

- a cleanup sprint for TP minimum-qty / repeated-partial handling
- continue Milestone B dashboard work (B5/B6)
- later return to broader architecture milestones after observability stabilizes
