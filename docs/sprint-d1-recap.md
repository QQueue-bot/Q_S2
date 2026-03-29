# Sprint D1 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint D1 defined the first-pass MDX settings source model for S2 using the MDX bot settings page as the observed source format.

## What was delivered

### MDX source-model document

Added:

- `docs/mdx-source-model-d1.md`

This document now:

- records the observed MDX page structure
- distinguishes top-half TradingView signal-bot settings from runtime execution settings
- distinguishes source performance/optimization metadata from profile strategy settings
- records Safe / Balanced / Aggressive profile values
- marks Balanced as the default profile
- provides a typed field inventory
- provides a concrete normalized example source object shape for later mapping work

## Key D1 decisions

### 1. Top-half page settings are recorded but not assumed to be runtime settings
These are treated as:

- signal-bot source metadata

They are still worth storing for:

- change tracking
- drift detection
- later user notification if MDX source settings change

### 2. Risk profiles are first-class source structure
The MDX page should be modeled with:

- `safe`
- `balanced`
- `aggressive`

and:

- `balanced` as the default profile

### 3. Performance/optimization metadata stays separate
Performance values are stored as source metadata, not runtime strategy config.

## Validation

Validation was completed by source-model capture and explicit structured extraction from the provided MDX screenshot:

- one example MDX settings source for Bot1 was modeled structurally
- field definitions were made explicit
- top-half TradingView settings were separated from runtime assumptions
- Safe / Balanced / Aggressive values were captured clearly
- unsupported or still-ambiguous fields were identified for later D-family sprints

## Interpretation

Sprint D1 is complete for the agreed MDX source-model objective.

The main result is not runtime behavior yet. The result is a clean source-model contract that later sprints can use for:

- D2 mapping semantics
- D3 resolver implementation
- D4 validation and safety guards

## Non-goals respected

Sprint D1 did not attempt to add:

- runtime mapping semantics
- resolver implementation
- live execution changes
