# Sprint D2 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint D2 defined the first-pass translation schema from MDX source fields into normalized S2 settings concepts.

## What was delivered

### MDX-to-S2 mapping schema

Added:

- `docs/mdx-to-s2-mapping-schema-d2.md`

This document now:

- classifies MDX fields as direct runtime mappings, derived runtime mappings, metadata-only fields, or unsupported/deferred fields
- defines the confirmed break-even rule:
  - `SL to BE = TP1` maps to `breakEven.triggerPercent = selected profile TP1 target percent`
- treats Balanced as the default profile
- treats top-half TradingView settings as metadata only
- defines hard-fail versus warning behavior

### Concrete mapping example

Added:

- `docs/mdx-balanced-to-s2-example.json`

This provides a worked first-pass example showing how the observed Balanced profile maps into an S2-shaped config result.

## Key D2 conclusions

### Direct runtime mappings
- TP target percents -> `takeProfit.levels[n].triggerPercent`
- TP allocation percents -> `takeProfit.levels[n].closePercent`
- Stop loss percent -> `stopLoss.triggerPercent`
- Leverage -> `positionSizing.leverage`

### Derived runtime mappings
- `SL to BE = TP1` -> `breakEven.triggerPercent = TP1 target percent`
- TP enablement derived from target/allocation pairs

### Metadata only
- top-half TradingView signal-bot fields
- top-level performance metrics
- profile performance metrics

### Unsupported / deferred
- `slType`
- `slValue`
- ATR-style stop-loss semantics
- any runtime meaning for top-half TradingView fields

## Validation

Validation was completed by producing:

- an explicit mapping schema
- a concrete Balanced-profile worked example
- explicit treatment of metadata-only and unsupported fields
- explicit hard-fail versus warning rules

## Interpretation

Sprint D2 is complete for the agreed mapping-schema objective.

D3 can now focus on implementing resolver code instead of arguing about semantic mapping rules.

## Non-goals respected

Sprint D2 did not attempt to add:

- resolver implementation
- runtime integration
- live execution changes
