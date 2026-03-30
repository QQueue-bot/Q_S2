# Sprint D5 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint D5 scaled the MDX source binding layer from Bot1 to Bot1 through Bot8 and made per-bot MDX source resolution explicit and unambiguous.

## What was delivered

### Per-bot MDX source refs in bot registry

Updated:

- `config/bots.json`
- `src/config/botRegistry.js`

Changes:

- every bot now includes `mdxSourceRef`
- bot-based MDX source filenames are used:
  - `../mdx/Bot1.source.json`
  - through
  - `../mdx/Bot8.source.json`
- registry validation now requires `mdxSourceRef`

### Per-bot MDX source files

Added / expanded:

- `mdx/Bot1.source.json`
- `mdx/Bot2.source.json`
- `mdx/Bot3.source.json`
- `mdx/Bot4.source.json`
- `mdx/Bot5.source.json`
- `mdx/Bot6.source.json`
- `mdx/Bot7.source.json`
- `mdx/Bot8.source.json`

### MDX source resolver

Added:

- `src/config/resolveBotMdxSource.js`

Changes:

- per-bot MDX source refs now resolve to explicit source paths
- missing source files fail clearly

### Bot context integration

Updated:

- `src/config/resolveBotContext.js`

Changes:

- bot context now includes resolved MDX source binding info

### Validation script

Added:

- `scripts/test-bot-mdx-binding.js`

## Validation

Validation confirmed:

- all 8 bots resolve their MDX source refs successfully
- source paths are unique and unambiguous per bot
- broken/missing MDX source refs fail clearly
- Bot1 remains enabled
- Bot2 through Bot8 remain disabled by default

## Interpretation

Sprint D5 is complete for the agreed per-bot MDX binding objective.

S2 now has a full 8-bot MDX source binding inventory aligned with the bot registry and ready for later runtime integration work.

## Non-goals respected

Sprint D5 did not attempt to add:

- runtime adoption
- live execution changes
- runtime settings cutover
