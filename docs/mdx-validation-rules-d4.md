# D4 - MDX Validation and Safety Guard Rules

_Last updated: 2026-03-29 UTC._

## Hard-fail rules

The following conditions must hard-fail:

- take-profit ladder does not contain exactly 6 levels
- any TP trigger percent is non-numeric or <= 0
- any TP allocation percent is non-numeric or <= 0
- TP trigger percents are not strictly increasing
- TP allocation percents do not total exactly 100
- stop-loss trigger percent is missing, non-numeric, or <= 0
- leverage is missing, non-numeric, or <= 0
- break-even trigger percent cannot be resolved or is <= 0
- `SL to BE` uses an unsupported reference (currently `TP1`, `TP2`, and `TP3` are supported)

## Warning rules

The following conditions should surface warnings rather than hard-fail:

- metadata-only source fields are present but not runtime-mapped
- `slType` / `slValue` are present but remain metadata-only
- profile performance metadata is present but unused
- leverage is syntactically valid but unusually high for current S2 policy

## Current policy choices

- TP allocations must sum to exactly 100%
- TP targets must be strictly increasing
- `SL to BE = TP1` is the only supported break-even trigger reference
- top-half TradingView settings remain metadata-only in this phase
