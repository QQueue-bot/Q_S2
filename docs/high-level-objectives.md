# High-Level Objectives

_Last updated: 2026-03-29 UTC._

This document describes the broader system-level objectives around S1, S2, and future related bot systems, and sets out the high-level development route for S2.

---

## 1. System Portfolio View

### S1 — Current Trading Bot System

S1 is the current live/reference trading bot system.

Characteristics:
- existing working bot setup
- currently used as the practical reference baseline
- currently operates without the new S2 DCA/staged-entry strategy layer
- serves as the comparison baseline for future live experiments

S1 should be treated as the benchmark/control system when evaluating whether S2 meaningfully improves results.

---

### S2 — New DCA-Capable Trading Bot System

S2 is the system being developed in this repo.

Current status:
- built incrementally through tightly scoped sprints
- currently supports signal intake, paper execution, reversal handling, TP/SL, break-even, and staged-entry logic
- currently validated on Bybit demo/testnet
- intended to evolve into a multi-bot live system with DCA-capable execution and stronger operator visibility

High-level goal for S2:
- run up to 8 bots
- each bot on its own live Bybit sub-account
- load the correct settings for the correct bot
- use MDX algo bot settings as the source/config basis
- implement a suitable DCA strategy
- run live for 2-4 weeks
- compare results against S1 across the same 8 bots, where S1 is the no-DCA baseline

This is the primary active development program.

---

### S3 — Future Bot System (TBD)

S3 is a placeholder for a future bot system.

Current concept:
- potentially based on a new or optimized trading indicator / strategy approach
- not yet designed in detail
- should be treated as future strategy/program work rather than a current implementation commitment

S3 exists as a future expansion lane, but should not distract from S2 completion and live evaluation.

---

## 2. Main Objective for S2

The main objective for S2 is:

> Build and operate a new DCA-capable multi-bot trading system, then compare it live against the existing S1 system over a 2-4 week period.

More concretely, S2 should progress from:
- a single validated demo/test bot

to:
- a live, observable, bot-aware trading system capable of running 8 bots on separate Bybit sub-accounts using MDX-aligned settings and a defined DCA strategy.

---

## 3. What S2 already has

After the first sprint sequence, S2 already has:

- config-driven structure
- config validation
- webhook intake
- signal parsing
- SQLite persistence
- Bybit demo/testnet execution
- trade lifecycle summary
- opposite-signal handling
- TP/SL management
- app-managed break-even logic
- simple staged-entry / initial DCA path
- runtime sync and flat-account reset procedures
- documented sprint recaps and runtime notes

This means S2 has already passed the initial proof-of-execution stage.

---

## 4. What S2 still needs before the main goal

To reach the main goal cleanly, S2 still needs the following broad capabilities:

### A. Better operator visibility
- simple internal web interface / dashboard
- visibility into signals received
- visibility into open positions
- visibility into recent events and bot activity

### B. Multi-bot architecture
- bot registry / bot identity model
- bot-specific config resolution
- bot-aware routing and persistence

### C. MDX settings mapping
- reliable loading/mapping of the correct settings for the correct bot
- durable way to represent/import MDX bot settings into S2

### D. Mature DCA design
- a deliberate DCA strategy, not just a temporary staged-entry placeholder
- clear trigger model, safeguards, and interaction with TP/SL/BE

### E. Bybit sub-account routing
- one bot per live Bybit sub-account
- secure routing of execution to the correct account
- clear bot/account isolation

### F. Live experiment framework
- a controlled rollout path
- 2-4 week comparison against S1
- success metrics and reporting model

---

## 5. Recommended high-level route for S2

The next phase of S2 development should no longer be a single flat sprint list.
It is better understood as a milestone-driven development program.

### Milestone A — Stabilization / Live Observation
Purpose:
- trust the current runtime
- watch live demo behaviour
- clean up any remaining runtime drift

### Milestone B — Observability
Purpose:
- provide a simple web dashboard / operator interface
- make signals, positions, and events visible without reading raw logs/DB manually

### Milestone C — Multi-Bot Foundation
Purpose:
- refactor the system from single-bot assumptions to bot-aware architecture
- define bot registry, bot-specific config resolution, and bot-scoped persistence

### Milestone D — MDX Settings Mapping
Purpose:
- load the right settings for the right bot
- align S2 config with MDX algo bot settings

### Milestone E — DCA Strategy Design and Execution
Purpose:
- design and implement the real DCA strategy intended for live use
- keep this separate from the temporary/simple staged-entry DCA already implemented

### Milestone F — Sub-Account Live Routing
Purpose:
- route each bot to its own Bybit sub-account
- create real account isolation per bot

### Milestone G — Live Experiment / Comparison
Purpose:
- run S2 live for 2-4 weeks
- compare S2 against S1 across 8 bots
- evaluate whether DCA improves results relative to the current non-DCA system

---

## 6. Why milestone-driven sprint families make sense now

The initial S2 build was appropriately handled as a linear sprint chain.

The next phase is different.
The work now falls into grouped tracks such as:
- observability
- multi-bot architecture
- settings integration
- DCA strategy design
- sub-account routing
- live experiment setup

Because of that, milestone-driven sprint families are clearer than a flat Sprint 17, 18, 19 sequence.

Suggested naming style:
- Sprint B1, B2, B3 ... for Observability
- Sprint C1, C2, C3 ... for Multi-Bot Foundation
- Sprint D1, D2 ... for MDX Settings Mapping
- Sprint E1, E2 ... for DCA Strategy
- Sprint F1, F2 ... for Sub-Account Routing
- Sprint G1, G2 ... for Live Experiment work

This makes pause/resume easier and keeps strategic intent visible.

---

## 7. Recommended immediate next direction

If choosing the most constructive next direction after the first 16 sprints, the strongest recommendation is:

### First next milestone: Milestone B — Observability
Start with a simple internal web dashboard showing:
- recent signals received
- current open positions
- recent order attempts
- recent exit / break-even / staged-entry events
- current runtime status

Why this is first:
- improves operator trust
- improves debugging speed
- helps before scaling to 8 bots
- creates visibility needed for live monitoring

### Second next milestone: Milestone C — Multi-Bot Foundation
This is the architectural unlock for:
- 8 bots
- per-bot settings
- per-bot routing
- sub-account support later

---

## 8. Definition of success for S2

S2 should be considered successful when it can:

- run 8 bots reliably
- route each bot to its own live Bybit sub-account
- apply the correct MDX-aligned settings per bot
- use a deliberate DCA strategy
- operate visibly and safely enough to monitor with confidence
- generate enough operational and performance data to compare fairly against S1

The final business question is not simply whether S2 can trade.
The final question is:

> Does S2 outperform or otherwise improve on S1 in a measurable way over live operation?

---

## 9. Relationship between S1, S2, and S3

### S1
- baseline / current system
- comparison control

### S2
- active development program
- DCA-capable, multi-bot, MDX-aligned next-generation system
- main focus now

### S3
- future strategy lane
- not yet defined
- should be explored only after S2 reaches a stable comparative evaluation point
