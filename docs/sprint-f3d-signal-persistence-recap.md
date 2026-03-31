# Sprint F3D Recap - Restore Signal Persistence and Runtime Observability

_Last updated: 2026-03-31 UTC._

## Objective

Investigate and fix the gap where live S2 trade signals were clearly reaching and being parsed by the webhook but were no longer being persisted into the expected signal/observability tables.

## Root cause

During the webhook heartbeat refactor, `src/webhook/createServer.js` stopped calling the persistence methods for:

- `raw_webhook_events`
- `normalized_signals`

Heartbeat handling was writing successfully into `heartbeat_events`, and journal logs showed live trade-signal arrivals, but the signal-table writes had effectively dropped out of the request flow.

## Fix applied

Updated `src/webhook/createServer.js` to restore persistence for:

- unauthorized webhook attempts → `raw_webhook_events`
- invalid JSON bodies → `raw_webhook_events`
- heartbeat events → `raw_webhook_events` plus `heartbeat_events`
- parsed non-heartbeat signals → `raw_webhook_events` plus `normalized_signals`
- processing failures → `raw_webhook_events`

## Validation

Local validation confirmed:

- `S2_Heartbeat` is accepted and written to `heartbeat_events`
- `S2_Heartbeat` is also written to `raw_webhook_events`
- `EXIT_SHORT_Bot1` is accepted and written to `raw_webhook_events`
- `EXIT_SHORT_Bot1` is written to `normalized_signals`
- heartbeat events remain isolated from `normalized_signals`

## Interpretation

This restores trust that the live webhook journal, DB persistence, and dashboard signal view can once again converge on the same reality.

It also preserves the newer heartbeat monitoring path without mixing heartbeat activity into the trade-signal tables.
