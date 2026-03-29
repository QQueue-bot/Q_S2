# Q_S2 - System Summary

_Last updated: 2026-03-29 UTC._

This README is a concise recovery and handover document for the `Q_S2` trading-system prototype.
It summarizes what has been built across Sprints 1-15, what the system now does, and how the webhook/runtime automation is set up.

---

## 1. What this project is

`Q_S2` is a controlled, config-driven trading execution system built around:

- TradingView-style webhook alerts
- Bybit Testnet / demo execution
- SQLite persistence
- staged sprint-based development with explicit validation and closeout

The system is designed to evolve carefully, with each sprint adding one tested capability at a time.

---

## 2. Current system capabilities (after Sprints 1-15)

The system now supports:

### Signal intake and validation
- webhook endpoint for TradingView-style alerts
- signal parsing / normalization
- config loading and schema validation
- risk/pre-trade checks
- symbol allowlist / leverage / size guardrails

### Persistence and observability
- SQLite-backed persistence for:
  - raw webhook events
  - normalized signals
  - system events
  - price ticks
  - order attempts
  - exit events
  - break-even events
  - staged entry events
- standalone trade lifecycle summary reporting in both:
  - JSON
  - human-readable text

### Execution behavior
- controlled Bybit demo/testnet paper trade execution
- opposite-signal handling:
  - opposite entry = reversal intent
  - close current opposite position first
  - only proceed if close succeeds
- TP/SL management:
  - mark-price based trigger checks
  - partial take-profit closes
  - full stop-loss close
- app-managed break-even:
  - arm BE when trigger is reached
  - close remaining position if price returns to entry
- staged-entry / simple initial DCA:
  - 50% immediate entry
  - 50% delayed entry
  - delayed second stage blocked if BE has armed

---

## 3. What the live test system currently looks like

### Repo path
- `/home/ubuntu/.openclaw/workspace/Q_S2`

### Observed live runtime path
- `/tmp/qs2_review`

### Important note
Historically, the active runtime was observed under `/tmp/qs2_review`, while the tracked repo clone was in the workspace path above.
This distinction matters for troubleshooting and recovery.

### Public webhook endpoint
- `https://hooks.tbotsys.one/webhook/tradingview`

### Local listener
- `127.0.0.1:3001`

### Tunnel/runtime automation
Observed services:
- `q-s2-webhook.service`
- `q-s2-tunnel.service`

Observed roles:
- webhook service runs the Node webhook app
- tunnel service runs:
  - `cloudflared tunnel run q-s2-webhook`

Relevant repo files:
- `deploy/systemd/q-s2-webhook.service`
- `deploy/systemd/q-s2-tunnel.service`
- `deploy/systemd/README.md`
- `scripts/run-webhook-with-env.sh`

### Secrets / environment
Secrets are expected outside Git, loaded from:
- `/home/ubuntu/.openclaw/workspace/.env`

Important env values include:
- `WEBHOOK_SECRET`
- `BYBIT_TESTNET_API_KEY`
- `BYBIT_TESTNET_API_SECRET`

Do **not** commit real `.env` contents.

---

## 4. Sprint-by-sprint summary

### Sprint 1 - Scope Review
Defined the boundaries, safety posture, and config-driven approach.

### Sprint 2 - Kanban / Sprint Setup
Set up sprint tracking in Trello and the execution workflow.

### Sprint 3 - Central Config File
Created central runtime configuration structure.

### Sprint 4 - Config Schema Validation
Added config validation and fail-fast behavior.

### Sprint 5 - Signal Contract / Parser
Defined TradingView-style signal contract and parsing behavior.

### Sprint 6 - Webhook Intake
Added webhook ingestion path for POSTed signals.

### Sprint 7 - SQLite Persistence Model
Added core persistence tables and write paths.

### Sprint 8 - Price Monitoring
Added Bybit testnet price monitoring and price tick capture.

### Sprint 9 - Risk Engine / Pre-Trade Checks
Added pre-trade guardrails and safety checks.

### Sprint 10 - Execute Paper Trade
Added first successful paper trade path to Bybit demo/testnet.

### Sprint 10 Recap
Performed continuity repair and verified the end-to-end path:
- webhook ingress
- signal parsing
- Bybit demo execution
- persistence
- Cloudflare + systemd runtime setup

### Sprint 11 - Trade Lifecycle Summary
Added standalone trade lifecycle summary generation:
- JSON output
- human-readable output
- recent activity context

Files:
- `src/reporting/tradeSummary.js`
- `scripts/test-trade-summary.js`

### Sprint 12 - Opposite Signal Handling
Added reversal handling:
- opposite entry signal triggers close-first logic
- new entry only proceeds if close succeeds

### Sprint 13 - TP / SL Management
Added:
- mark-price based TP/SL evaluation
- partial TP handling
- full SL handling
- exit event persistence

Demo validation configuration used:
- TP1: `0.25%`, close `50%`
- TP2: `0.5%`, close `50%`
- SL: `0.5%`

### Sprint 14 - Break-Even Logic
Added app-managed BE logic:
- arm BE at `0.25%`
- if price returns to entry, close remaining position

### Sprint 15 - Initial DCA / Staged Entry
Added simple staged-entry logic:
- 50% immediate entry
- 50% delayed entry
- block delayed add if BE armed

This is intentionally **not** a full optimized price-based DCA system.

---

## 5. Current behavior details

### Webhook payload style
Verified example payload:
- `ENTER_LONG_Bot1`

The system parses the signal, runs risk checks, and executes according to current logic.

### Opposite signal behavior
- opposite entry signal = reversal intent
- close current opposite position first
- if close succeeds, proceed with new direction
- if close fails, abort new entry

### TP/SL behavior
Using mark price:
- TP can close partial position sizes
- SL closes full remaining position

### Break-even behavior
Using mark price:
- BE arms once configured trigger is reached
- once armed, return to entry triggers protective close

### Staged-entry / initial DCA behavior
- first stage places 50%
- second stage places remaining 50% after delay
- second stage skipped if BE is already armed
- because of exchange qty step rounding, 50/50 may appear as uneven quantities such as `0.013` and `0.014`

---

## 6. Files worth knowing first

### Core execution / logic
- `src/webhook/createServer.js`
- `src/risk/evaluateSignal.js`
- `src/execution/bybitExecution.js`
- `src/reporting/tradeSummary.js`
- `src/db/sqlite.js`

### Validation / test scripts
- `scripts/test-execution.js`
- `scripts/test-opposite-signal.js`
- `scripts/test-opposite-signal-simulated.js`
- `scripts/test-tp-sl-simulated.js`
- `scripts/test-tp-sl-live.js`
- `scripts/test-break-even-simulated.js`
- `scripts/test-break-even-live.js`
- `scripts/test-staged-entry-simulated.js`
- `scripts/test-staged-entry-live.js`
- `scripts/test-trade-summary.js`

### Runtime / deployment docs
- `docs/runtime-status.md`
- `deploy/systemd/README.md`
- `deploy/systemd/q-s2-webhook.service`
- `deploy/systemd/q-s2-tunnel.service`

### Sprint recap docs
- `docs/sprint-10-recap.md`
- `docs/sprint-11-recap.md`
- `docs/sprint-12-recap.md`
- `docs/sprint-13-recap.md`
- `docs/sprint-14-recap.md`
- `docs/sprint-15-recap.md`

---

## 7. Safety / recovery notes

### Config baseline vs live test config
The repo `config/settings.json` is intentionally kept as a conservative baseline.
Historically, a more permissive live test config existed in `/tmp/qs2_review/config/settings.json`.
Do not blindly assume the repo baseline and live runtime config are identical.

### The live test system should be treated as test/demo runtime
This project has validated a strong paper-trade and automation path, but it should still be treated as a controlled test/demo system unless explicitly hardened further.

### Review order if recovering context later
If context is lost in future, check in this order:
1. this `README.md`
2. `docs/runtime-status.md`
3. sprint recap docs
4. Trello current/last sprint status
5. current branch / Git history / runtime path

---

## 8. Process rule that improved reliability

The project now uses a stricter sprint closeout standard:
- each sprint should fit within 30-60 minutes
- inputs checked up front
- if debugging drifts beyond about 15 minutes or 2 serious attempts, classify it explicitly
- every sprint must end with:
  - GitHub update
  - Trello update
  - validation result
  - memory/docs update

This is important because continuity and reviewability are treated as part of the product.

---

## 9. Current branch / state expectation

Primary working branch used for these sprints:
- `sprint-scope-review`

At the point this README was written, repo closeout had been maintained sprint-by-sprint so GitHub and local branch state were kept aligned after each completed sprint.
