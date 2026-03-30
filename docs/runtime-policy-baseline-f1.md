# F1 - Runtime Policy Baseline

_Last updated: 2026-03-30 UTC._

## Intentional live baseline

The runtime policy baseline after F1 is:

- cautious live validation sizing uses **10% of account**
- bot-specific stop-loss should derive from **MDX runtime settings** where MDX is enabled
- bot-specific take-profit should derive from **MDX runtime settings** where MDX is enabled
- bot-specific break-even trigger should derive from **MDX runtime settings** where MDX is enabled

## Why this cleanup was needed

Earlier runtime state still reflected temporary proof settings and outdated note text:

- `accountPercent = 5` from prior live proof work
- placeholder stop-loss value (`0.0`)
- demo-validation wording on TP / BE notes

Those values and notes created operator confusion because the actual Bot1 resolved runtime values were already being overridden by MDX-derived settings.

## Interpretation

F1 does not claim that repo baseline config and runtime operational state are identical.

Instead, it makes the runtime intent explicit:

- cautious live sizing remains active
- per-bot MDX-derived values are the operational source of truth when enabled
- placeholder/shared note text should not imply that bot runtime behavior is still driven by legacy proof values
