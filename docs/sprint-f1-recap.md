# Sprint F1 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint F1 cleaned up temporary runtime policy/settings so the system operates from intentional values instead of leftover proof/test state.

## What was delivered

### Runtime policy cleanup

Updated:

- `src/config/resolveBotSettings.js`
- `/tmp/qs2_review/config/settings.json`

Changes:

- cautious live validation sizing baseline now uses **10% of account**
- Bot1 resolved runtime settings now clearly state that TP / SL / BE are derived from the MDX profile when enabled
- live runtime stop-loss placeholder value was removed and replaced with a real baseline value (`6`)
- stale demo-validation / temporary-proof wording was replaced with clearer runtime intent notes

### Runtime policy baseline doc

Added:

- `docs/runtime-policy-baseline-f1.md`

### Validation result

Confirmed:

- resolved Bot1 runtime settings now show:
  - `accountPercent = 10`
  - MDX-derived take-profit ladder
  - MDX-derived stop-loss
  - MDX-derived break-even trigger
- runtime baseline file no longer carries temporary `5%` sizing or placeholder stop-loss
- runtime notes are now materially clearer and more intentional

## Interpretation

Sprint F1 is complete for the agreed runtime-policy cleanup objective.

The runtime policy surface is now much clearer for future live validation work:

- cautious 10% account sizing baseline
- per-bot MDX-derived TP / SL / BE as the operational source of truth where enabled
- reduced operator confusion from stale proof-state settings and notes

## Non-goals respected

Sprint F1 did not attempt to add:

- broader live rollout
- hidden architecture work
- silent operational policy changes
