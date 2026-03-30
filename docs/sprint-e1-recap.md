# Sprint E1 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint E1 reviewed likely signal/trade behavior and defined the first practical DCA strategy candidates for S2.

## What was delivered

### DCA strategy options review

Added:

- `docs/dca-strategy-options-e1.md`
- `docs/sprint-e1-progress-note.md`

These documents now record the candidate DCA strategies considered during E1 and preserve alternative options for later optimization.

## Key E1 outcomes

### Primary implementation candidate
- **Candidate A - Impulse-Aware Confirmation DCA**

Reason:
- safer
- simpler
- easier to validate
- lower risk of accidental over-averaging in weak trades

### Strong optimization candidate for later
- **Candidate B - Risk-Capped Pullback / Reclaim DCA**

Reason:
- potentially improves blended entry materially
- becomes much more defensible if the stop remains anchored to the original invalidation price
- should be preserved for later optimization and/or shadow-comparison work

### Important design insight captured
If DCA is used below the initial entry, the stop should remain anchored to the original invalidation price rather than drifting lower with each add.

This was captured as an important risk-control principle.

### Future optimization path captured
A later shadow-comparison concept was identified and added to backlog as:

- `Sprint E5 - Shadow DCA Strategy Comparison`

Preferred first usage:
- Strategy A live
- Strategy B shadow-monitored

## Interpretation

Sprint E1 is complete for the agreed review/design objective.

The result is a clear first-pass strategy direction for Milestone E and a preserved record of alternative DCA approaches for later optimization.

## Non-goals respected

Sprint E1 did not attempt to add:

- runtime DCA config model yet
- execution logic yet
- live DCA rollout yet
