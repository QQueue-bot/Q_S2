# Sprint D4 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint D4 added validation and safety guards for MDX-derived settings so unsafe or malformed mapped output can be blocked before runtime adoption.

## What was delivered

### Validation guard module

Added:

- `src/config/validateMdxRuntimeSettings.js`

This validator now checks:

- TP ladder contains exactly 6 levels
- TP trigger percents are numeric and > 0
- TP allocation percents are numeric and > 0
- TP trigger percents are strictly increasing
- TP allocation percents total exactly 100
- stop-loss trigger percent is numeric and > 0
- leverage is numeric and > 0
- break-even trigger percent resolves correctly
- only `SL to BE = TP1` is currently supported

### Validation rules document

Added:

- `docs/mdx-validation-rules-d4.md`

### Validation script

Added:

- `scripts/test-mdx-validation-guards.js`

## Validation

Validation confirmed:

- valid MDX-derived output passes
- malformed TP allocation totals fail
- non-increasing TP targets fail
- unsupported break-even references fail hard
- metadata-only source fields continue to surface warnings rather than silently mapping into runtime settings

## Interpretation

Sprint D4 is complete for the agreed validation/safety objective.

The MDX mapping path now has an explicit guardrail layer that can reject unsafe derived settings before runtime adoption.

## Non-goals respected

Sprint D4 did not attempt to add:

- runtime adoption
n- live execution changes
- runtime settings cutover
