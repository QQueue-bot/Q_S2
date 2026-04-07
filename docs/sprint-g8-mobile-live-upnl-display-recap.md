# Sprint G8 - Mobile Live uPnL Display

## Goal

Add live unrealized PnL (uPnL) per bot to the S2 mobile status page using existing Bybit position data.

## Scope

Reporting/display only.
No execution logic changes.

## Changes

### 1. Mobile bot status builder

Updated `src/dashboard/buildMobileBotStatus.js` so each bot now includes:

- `unrealizedPnl`

This is populated from the Bybit position response when an open position exists.

### 2. Mobile page rendering

Updated `src/dashboard/createDashboardServer.js` so each bot card now shows:

- balance
- live uPnL

uPnL is color-coded:

- green for positive
- red for negative
- neutral fallback when unavailable

## Expected result

The `/mobile` page and `/api/mobile-bot-status` output now expose per-bot live unrealized PnL when Bybit returns it for an open position.
