# Sprint D3 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint D3 implemented the MDX mapping resolver that converts machine-readable MDX source data into normalized S2 settings output.

## What was delivered

### Machine-readable MDX source input

Added:

- `mdx/Bot1.source.json`

This provides a concrete structured MDX source artifact for Bot1 based on the D1 source model.

### MDX resolver implementation

Added:

- `src/config/resolveMdxSettings.js`

This resolver now:

- loads a machine-readable MDX source file
- defaults to the `balanced` profile
- supports explicit override to `safe` and `aggressive`
- emits structured output including:
  - `runtimeSettings`
  - `metadata`
  - `warnings`
- applies the confirmed D2 break-even rule:
  - `SL to BE = TP1` -> selected profile TP1 target percent
- fails clearly for malformed required fields

### Resolver output example

Added:

- `docs/mdx-resolver-output-example-d3.json`

### Validation script

Added:

- `scripts/test-mdx-mapping-resolver.js`

## Validation

Validation confirmed:

- Bot1 resolves successfully with default `balanced`
- Bot1 resolves successfully with `safe`
- Bot1 resolves successfully with `aggressive`
- metadata is preserved in the resolver output
- metadata-only fields generate explicit warnings rather than being silently mapped
- malformed source fails clearly

## Interpretation

Sprint D3 is complete for the agreed resolver-implementation scope.

The system now has a working MDX mapping resolver layer that transforms source data into normalized S2-shaped settings output without yet cutting runtime over to that path.

## Non-goals respected

Sprint D3 did not attempt to add:

- runtime adoption
- live execution changes
- runtime settings cutover
