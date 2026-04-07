# Sprint F3G - Selective Bot DCA

## Goal

Move S2 away from global DCA assumptions by adding a per-bot DCA policy with a default of OFF.

## Scope

Fast implementation only:
- add per-bot DCA enable/disable policy
- default all bots to DCA OFF
- selectively enable where explicitly desired
- no broader strategy redesign in this sprint

## Changes

### 1. Bot registry policy

Added `dcaPolicy.enabled` to every bot in `config/bots.json`.

Current policy after this sprint:

- Bot1: OFF
- Bot2: ON
- Bot3: OFF
- Bot4: OFF
- Bot5: OFF
- Bot6: OFF
- Bot7: OFF
- Bot8: OFF

### 2. Runtime DCA resolution

Updated `src/config/resolveDcaStrategy.js` so DCA now resolves from per-bot policy:

- default behaviour is OFF unless `bot.dcaPolicy.enabled === true`
- runtime now carries policy metadata showing the source is `bot.dcaPolicy.enabled`

## Result

S2 now supports selective DCA by bot with a safe default of OFF.

This implements the fast operational conclusion from the earlier DCA review:
- DCA should not be treated as globally on
- Bot2 / NEAR remains the initial keep-DCA candidate
- other bots remain off until explicitly enabled
