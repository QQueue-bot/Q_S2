# Sprint G5 Recap - Mobile Trade Signal and Order Monitoring

_Last updated: 2026-04-06 UTC._

## Objective

Improve the mobile operator page with the most useful recent monitoring signals discovered during the live S2 runtime debugging work.

## What changed

### Mobile status payload

Updated `src/dashboard/buildMobileBotStatus.js` so the mobile payload now includes a compact `activity` block with:

- latest non-heartbeat trade signal
- latest order attempt
- latest failed execution / rejection
- relative ages in minutes

### Mobile page

Updated `src/dashboard/createDashboardServer.js` so `/mobile` now shows:

- last trade signal (bot + signal + age)
- last order attempt (bot + symbol + status + age)
- last failure (bot + symbol + short reason + age)

## Validation

Validation against the live runtime DB confirmed the page can now resolve and display:

- latest Bot4 `ENTER_LONG` signal
- latest Bot4 submitted order attempt
- latest failed Bot4 order attempt and rejection reason
- heartbeat freshness and fleet totals alongside these new monitoring blocks

## Interpretation

This materially improves the mobile page as an operator tool. It is now easier to distinguish:

- quiet market conditions
- live signal activity
- successful order submission
- and recent execution problems

without needing immediate DB or journal access.
