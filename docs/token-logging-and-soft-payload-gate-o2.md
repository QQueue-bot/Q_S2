# O2 - Token Logging and Soft Payload Gate

## Purpose

Provide a lightweight operational layer for monitoring token growth and warning about oversized prompt payloads without introducing hard blocking or heavy automation.

## Phase 1 policy

Enabled now:
- token usage visibility where available
- soft payload warnings
- no hard token blocking

Deferred:
- hard token caps
- automatic refusal based on payload size
- deep provider billing integration

## Soft payload gate rules

Before large analysis turns, prefer warning if any of the following are about to be included directly in prompt context:

### High-risk payload types
- full TradingView CSV/log exports
- large raw DB row dumps
- full review packs when only one section is needed
- long Trello specs already stored in Trello/docs
- multiple logs/config files in one turn

### Safer alternatives
- counts + latest rows
- one bot / one time window
- summary files already written to repo
- scripts that preprocess large datasets first
- S2-only output before cross-system comparison

## Soft warning rubric

Treat a request as payload-heavy and worth narrowing when one or more apply:

- asks for a full export or full log review
- asks for all bots when only one or two are needed
- mixes debugging + reporting + Trello + deploy in one turn
- repeats a full spec already stored in Trello/docs
- asks for broad retrospective analysis over a long-lived session

## Recommended warning style

Short and practical. Example:

> This will likely be a high-context / high-token turn because it pulls in raw CSV/log data and broad session history. Prefer: counts + latest rows, one bot/time window, or a file-based summary first.

## Token logging notes

Exact provider-grade per-request token logs are not currently available in a ready local ledger, but the following should be tracked whenever practical:

- session status snapshots
- context size
- compaction count
- model used
- whether large files/logs were pulled into the turn

## Operational use

Use this as a workflow rule, not as a hard block:
- warn first
- narrow scope if possible
- continue when a large forensic turn is genuinely necessary

## Goal

Reduce avoidable token growth while preserving debugging effectiveness.
