# Sprint D6 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint D6 integrated MDX-derived settings into the active bot settings resolution path and made MDX the primary runtime settings path for Bot1 with hard-fail behavior.

## What was delivered

### Bot registry updates

Updated:

- `config/bots.json`

Changes:

- all bots now include explicit `mdxProfile`
- current default profile is `balanced`
- Bot1 notes now reflect that MDX-derived settings are the primary runtime path

### Runtime integration

Updated:

- `src/config/resolveBotSettings.js`
- `src/config/resolveBotContext.js`

Changes:

- Bot1 now resolves runtime settings through the MDX path first
- D4 validation runs before MDX-derived settings are accepted
- if the MDX path is broken or invalid, settings resolution hard-fails
- there is no silent fallback to ambiguous global defaults
- bot context now exposes MDX runtime details including selected profile, source path, warnings, and metadata

### Validation script

Added:

- `scripts/test-mdx-runtime-integration.js`

## Validation

Validation confirmed:

- Bot1 resolves runtime settings successfully through MDX
- Bot1 selected profile is explicit (`balanced`)
- Bot1 runtime settings now reflect MDX-derived values for leverage, TP ladder, stop loss, and break-even trigger
- broken MDX path fails clearly before runtime use
- no silent fallback occurs when the MDX path is broken

## Interpretation

Sprint D6 is complete for the agreed runtime-integration objective.

The active bot settings resolution path now supports MDX-derived runtime settings as the primary path for Bot1, with hard-fail safety behavior and explicit runtime-visible MDX context.

## Non-goals respected

Sprint D6 did not attempt to add:

- broader live rollout
- multi-bot activation sweep
- silent fallback behavior
