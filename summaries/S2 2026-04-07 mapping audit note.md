# S2 2026-04-07 mapping audit note

## Decision

`Q_S2/config/bots.json` is the enforced source of truth for S2 bot identity, symbol mapping, and related bot configuration.

## Current runtime truth from bots.json

- Bot1 -> IPUSDT
- Bot2 -> NEARUSDT
- Bot3 -> PAXGUSDT
- Bot4 -> CRVUSDT
- Bot5 -> WIFUSDT
- Bot6 -> IPUSDT
- Bot7 -> FLOKIUSDT
- Bot8 -> PUMPFUNUSDT

## Audit result

The current live S2 runtime is consistent with Bot1 = IPUSDT.

This is supported by:
- `config/bots.json`
- runtime bot context resolution
- mobile dashboard output
- current Bot1 live execution rows in the aligned runtime DB

## Bot1 signal provenance for current live short

Current Bot1 short provenance in S2:
- raw webhook ingress: `2026-04-07T03:10:01.525Z` -> `ENTER_SHORT_Bot1`
- normalized signal: `bot_id=Bot1`, `signal=ENTER_SHORT`
- order attempt: `2026-04-07T03:10:02.665Z` -> `symbol=IPUSDT`, `status=submitted`
- staged add: `2026-04-07T03:11:03.286Z` -> `ENTER_SHORT_DCA_ADD`, `symbol=IPUSDT`, `status=submitted`

## What was wrong

The problem was not missing runtime mapping.

The problem was review/report drift:
- some S2-facing review material mixed Bot1 = STX into S2 outputs
- this conflicted with the actual S2 runtime mapping where Bot1 = IPUSDT

## Required enforcement rule going forward

Any S2-facing summary, review pack, dashboard explanation, or audit output must derive bot identity and symbol mapping from `Q_S2/config/bots.json` unless explicitly marked as external/legacy context.

## Known design note

There is still a duplicate-symbol design reality in the registry:
- Bot1 = IPUSDT
- Bot6 = IPUSDT

That is not the same as the resolved reporting drift, but it should remain visible as a future design/ops review item.
