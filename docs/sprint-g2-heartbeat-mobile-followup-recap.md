# Sprint G2 Follow-up Recap - Mobile Heartbeat Visibility

_Last updated: 2026-03-31 UTC._

## Objective

Extend the mobile bot status page so operators can see the TradingView-to-S2 heartbeat state directly on the phone view.

## What changed

### Mobile status data builder

Updated `src/dashboard/buildMobileBotStatus.js` so the mobile status payload now includes heartbeat state from the runtime DB:

- `lastHeartbeatAt`
- `heartbeatAgeMinutes`
- `heartbeatFresh`
- `heartbeatStale`
- `heartbeatStaleThresholdMinutes`

### Mobile page display

Updated `src/dashboard/createDashboardServer.js` so `/mobile` now shows:

- last heartbeat time
- age in minutes
- fresh / stale state
- explicit UTC labeling for timestamps
- the 6 hour heartbeat stale threshold in the page freshness note

## Validation

Validation confirmed against the live runtime DB:

- heartbeat state was read successfully from `heartbeat_events`
- last heartbeat timestamp resolved correctly
- heartbeat age in minutes resolved correctly
- fresh/stale logic resolved correctly using the 6 hour threshold

## Interpretation

This completes the first operator-visible heartbeat loop for the mobile page and reduces the chance of silently stale TradingView-to-S2 connectivity being mistaken for quiet markets.

The page now exposes both:

- bot fleet state
- heartbeat freshness state

in one quick phone-oriented view.
