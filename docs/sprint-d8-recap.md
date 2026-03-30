# Sprint D8 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint D8 replaced the seeded placeholder MDX source files for Bot2 through Bot8 with real bot-specific MDX source data.

## What was delivered

### Real MDX source population

Updated:

- `mdx/Bot2.source.json`
- `mdx/Bot3.source.json`
- `mdx/Bot4.source.json`
- `mdx/Bot5.source.json`
- `mdx/Bot6.source.json`
- `mdx/Bot7.source.json`
- `mdx/Bot8.source.json`

These files now contain real bot-specific MDX values rather than seeded placeholders.

### Validation / discovery result

Validation sweep showed:

#### Compatible with current MDX runtime path
- Bot1
- Bot2
- Bot4
- Bot6
- Bot8

#### Not yet compatible with current MDX runtime path
- Bot3
- Bot5
- Bot7

### Root cause of incompatibility

The current MDX runtime mapping only supports:

- `SL to BE = TP1`

Real Bot3/Bot5/Bot7 source files exposed unsupported real-world values:

- Bot3 -> `SL to BE = TP3`
- Bot5 -> `SL to BE = TP3`
- Bot7 -> `SL to BE = TP2`

## Interpretation

Sprint D8 is complete for the agreed real-source-population objective.

It also surfaced a genuine next-step requirement:

- **D9 is needed** to extend break-even trigger mapping beyond `TP1` so real-world MDX sources using `TP2` and `TP3` can integrate cleanly.

## Operational conclusion

D8 successfully replaced placeholder MDX files with real source data and exposed the next real compatibility gap before activation work.

That is a successful outcome for this sprint.
