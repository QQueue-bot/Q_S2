# S2 Trading System – Scope & Sprint Plan (v0.5 Config-Driven)

## 1. Scope Summary

S2 is a controlled, incremental trading execution system using TradingView alerts and Bybit Testnet.
The system is fully config-driven, allowing changes to tokens, alerts, TP/SL/BE settings, and execution parameters without code changes.
Development should happen in tightly scoped 30–60 minute sprints with strong emphasis on safety, observability, validation, and step-by-step testing.

## 2. Core Design Principle

All variable parameters must be stored in a central settings file from the start.

This includes:
- Trading pairs (for example `BTCUSDT`)
- Signal types (`ENTER/EXIT LONG/SHORT`)
- Position sizing
- Leverage
- Stop-loss values
- Take-profit levels
- Break-even trigger levels
- DCA levels
- Environment-specific settings (testnet/prod)

No trading logic should rely on hardcoded strategy values.
All sprints must read from settings where applicable.

## 3. Delivery Rules

- Each sprint should fit within **30–60 minutes**
- Each sprint must have **one clear outcome**
- Each sprint must be **testable**
- Each sprint must produce a **GitHub commit**
- Each sprint must update **Kanban status**
- Each sprint must include a short **closeout/documentation step** before it is considered complete
- Do not combine multiple sprint objectives into one work block
- Every sprint should state both its **deliverable** and its **validation method**
- Every sprint should leave behind enough durable context that a future review can reconstruct what was built, what was tested, what is temporary, and what still remains

### Standard Sprint Card / Closeout Format

Each sprint card should include:
- **Objective** — what this sprint is for
- **Work** — what gets built or changed
- **Output** — concrete artifact produced
- **Validation** — how success is tested or proven
- **Closeout / Documentation** — GitHub updated, Trello updated, key runtime/config decisions documented, temporary drift/hacks noted, memory/internal notes updated, next dependency or risk recorded
- **Non-goals** — what the sprint is explicitly not trying to do

### Sprint Execution / Bug Handling Rule

- Every sprint remains timeboxed to **30–60 minutes**.
- Before starting, confirm the inputs/context needed for the sprint are ready.
- During execution, do not let open-ended debugging silently replace the sprint objective.
- If a bug is clearly in-scope and likely solvable within the sprint timebox, fix it and continue.
- If debugging consumes roughly **15 minutes** or **2 serious fix attempts** without clean resolution, explicitly classify the situation as one of:
  - **within-sprint fix**
  - **blocker requiring a specific missing input/decision**
  - **separate bugfix/recap sprint**
- If a bug becomes the main work, stop pretending the original sprint is still happening and create/use a dedicated bugfix or recap sprint instead.
- Every sprint should still end with a closeout, even if the result is partial or blocked.

## 4. Safety & Architecture Requirements

Before meaningful execution logic, the system should explicitly support:
- Config schema validation
- Fail-fast startup on invalid config
- Symbol allowlist / trading pair controls
- Position size and leverage limits
- Duplicate signal suppression
- Stale signal rejection
- Risk gating before order submission
- SQLite-backed event persistence
- Clear logs and lifecycle summaries
- Manual kill switch / execution disable control

DCA should be treated as optional and introduced only after the core execution lifecycle is stable.

## 5. Sprint Plan

### Sprint 1 — Scope Review
- **Objective:** confirm project boundaries, assumptions, and priorities before coding
- **Work:** review the scope doc, identify major risks/gaps, confirm config-driven approach
- **Output:** written scope feedback with recommended sprint ordering
- **Validation:** feedback captured in GitHub issue or repo note
- **Non-goals:** no code changes to execution logic

### Sprint 2 — Kanban / Sprint Setup
- **Objective:** make execution visible and disciplined
- **Work:** create sprint cards, define workflow states, align sprint naming and ordering
- **Output:** Kanban board populated with sprint tasks
- **Validation:** all planned sprints visible and ordered on the board
- **Non-goals:** no trading system code

### Sprint 3 — Central Config File
- **Objective:** establish one source of truth for runtime parameters
- **Work:** create config structure for symbols, sizing, leverage, TP/SL/BE, DCA, and environment selection
- **Output:** initial config file committed to the repo
- **Validation:** application can load config successfully at startup
- **Non-goals:** no order placement or signal handling yet

### Sprint 4 — Config Schema Validation
- **Objective:** prevent invalid config from reaching runtime logic
- **Work:** define required fields, data types, defaults, and validation rules
- **Output:** startup config validation module
- **Validation:** valid config passes; invalid config fails with clear errors
- **Non-goals:** no webhook or exchange integration yet

### Sprint 5 — Signal Contract / Parser
- **Objective:** define exactly what an incoming trading signal looks like
- **Work:** specify payload structure, required fields, timestamps, supported actions, and idempotency handling
- **Output:** signal contract documentation plus parser/normalizer
- **Validation:** sample payloads normalize into expected internal format
- **Non-goals:** no network-exposed webhook endpoint yet

### Sprint 6 — Webhook Intake
- **Objective:** reliably receive TradingView alerts
- **Work:** create webhook endpoint, accept POST payloads, and route them into the parser layer
- **Output:** running webhook intake path
- **Validation:** test alert is received, parsed, and acknowledged successfully
- **Non-goals:** no trade execution yet

### Sprint 7 — SQLite Persistence Model
- **Objective:** persist system events for traceability and debugging
- **Work:** create tables for alerts, normalized signals, errors, and lifecycle events
- **Output:** initialized SQLite schema and write path
- **Validation:** test alert is stored and queryable
- **Non-goals:** no exchange order placement yet

### Sprint 8 — Price Monitoring
- **Objective:** observe market price for the configured symbol during runtime
- **Work:** connect to Bybit Testnet WebSocket, subscribe to the configured pair, and log price updates
- **Output:** live price feed integrated into the system
- **Validation:** price ticks are received and stored/logged correctly
- **Non-goals:** no trading decisions triggered from price feed yet

### Sprint 9 — Risk Engine / Pre-Trade Checks
- **Objective:** ensure unsafe trades are blocked before execution
- **Work:** implement checks for symbol allowlist, size limits, leverage caps, stale signals, duplicates, and kill switch state
- **Output:** pre-trade validation layer
- **Validation:** invalid trade attempts are rejected with explicit reasons
- **Non-goals:** no live order submission changes beyond gating logic

### Sprint 10 — Execute Paper Trade
- **Objective:** place a controlled testnet trade using validated signal and config inputs
- **Work:** connect execution logic to Bybit Testnet, submit order, and record order results
- **Output:** first successful paper trade path
- **Validation:** order is placed on testnet and recorded in DB/logs
- **Non-goals:** no TP/SL/BE management yet

### Sprint 11 — Trade Lifecycle Summary
- **Objective:** produce a readable summary of trade behaviour and outcomes
- **Work:** track open, update, close, timestamps, notable actions, and PnL fields
- **Output:** generated trade summary report/object
- **Validation:** closed paper trade produces complete summary output
- **Non-goals:** no DCA or reversal logic yet

### Sprint 12 — Opposite Signal Handling
- **Objective:** safely handle reversal conditions
- **Work:** detect opposite-direction signals and close or reject existing position according to defined rules
- **Output:** reverse-signal handling logic
- **Validation:** simulated opposite signal behaves according to specification
- **Non-goals:** no DCA logic yet

### Sprint 13 — TP / SL Management
- **Objective:** automate trade exits using configured thresholds
- **Work:** implement stop-loss and take-profit monitoring using config-defined rules
- **Output:** working TP/SL management flow
- **Validation:** simulated trade hits TP or SL and closes correctly
- **Non-goals:** no break-even or DCA logic yet

### Sprint 14 — Break-Even Logic
- **Objective:** protect gains once trade conditions are met
- **Work:** monitor BE trigger and move stop-loss to break-even when threshold is reached
- **Output:** BE state transition logic
- **Validation:** simulated profitable trade updates SL to BE as expected
- **Non-goals:** no DCA additions yet

### Sprint 15 — DCA (Optional / Last)
- **Objective:** add position scaling only after the base system is stable
- **Work:** implement config-driven DCA levels and safeguards
- **Output:** optional DCA logic path
- **Validation:** simulated trade adds at configured levels without breaking lifecycle tracking
- **Non-goals:** no expansion into unrelated strategy features

## 6. Recommended Feedback Medium

Primary feedback should live in **GitHub** (issues, PR comments, or scope docs committed to the repo) so that technical decisions are durable and tied to the codebase.
Trello should be used for execution tracking and status, not as the sole record of project reasoning.
