# Sprint D9 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint D9 extended MDX break-even trigger mapping beyond TP1 so real-world MDX profiles using TP2 and TP3 can integrate cleanly.

## What was delivered

### Extended break-even trigger mapping

Updated:

- `src/config/resolveMdxSettings.js`
- `src/config/validateMdxRuntimeSettings.js`
- `docs/mdx-to-s2-mapping-schema-d2.md`
- `docs/mdx-validation-rules-d4.md`

Changes:

- `SL to BE = TP1` remains supported
- `SL to BE = TP2` is now supported
- `SL to BE = TP3` is now supported
- derived break-even trigger percent now resolves from the selected profile's referenced TP target percent
- unsupported break-even references outside TP1/TP2/TP3 still hard-fail

### Validation script

Added:

- `scripts/test-extended-breakeven-trigger-mapping.js`

## Validation

Validation confirmed:

- TP1, TP2, and TP3 break-even references resolve correctly
- Bot3 resolves successfully with `SL to BE = TP3`
- Bot5 resolves successfully with `SL to BE = TP3`
- Bot7 resolves successfully with `SL to BE = TP2`
- unsupported references outside the supported set still fail clearly

## Interpretation

Sprint D9 is complete for the agreed break-even-trigger extension objective.

This closes the specific compatibility gap discovered in D8 and allows the real Bot3, Bot5, and Bot7 MDX source files to integrate cleanly under the current MDX runtime path.

## Non-goals respected

Sprint D9 did not attempt to add:

- broader live rollout
- silent fallback behavior
- unrelated MDX semantic expansion beyond break-even trigger references
