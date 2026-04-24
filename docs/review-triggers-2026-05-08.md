# Review Triggers — 2026-05-08

Scheduled two-week review following the 2026-04-24 full bot reconfiguration deployment.

## Review date

2026-05-08 (two weeks post-deployment)

## What this review covers

1. Live performance of all 8 bots on their new assets and Balanced profiles
2. Confirm accountPercent=50 is sizing positions as expected
3. Confirm Bot1 (DEEP) and Bot4 (ZEC) signal flow end-to-end on new assets
4. Check Bot7 symbol routing for 1000FLOKIUSDT
5. Validate TP ladder firing behaviour matches MDX targets (exit_events table)
6. Check SL polling — any positions that have hit internal SL threshold?

## Go/no-go criteria for continuing at 50%

- All 8 bots receiving and executing signals without error
- No unexpected full-account drawdowns on any sub-account
- TP levels firing within expected range of MDX target %
- No duplicate or missed executions observed in DB

## Scaling gate: native Bybit SL (prerequisite)

**Scaling beyond 50% margin requires native Bybit SL implementation first.**

S2 currently manages stop-loss entirely via internal polling (15-second loop). During the 2-3 day service crash (2026-04-22 to 2026-04-24), positions were left naked — no native exchange-side stop orders protected them. This is the highest-priority architectural change before increasing position sizing further.

Native SL implementation: on every ENTER signal execution, place a native Bybit stop order at the SL price via POST /v5/order/create with stopLoss param or a separate conditional stop order. This protects positions even if the S2 service crashes.

Do not scale accountPercent above 50 until this is implemented and verified.

## If criteria are not met

- Reduce accountPercent back to 25 and investigate per-bot
- Disable any bot with consistent execution errors
- File issues for any TP misfires with DB evidence
