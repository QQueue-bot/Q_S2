# Milestone C - Multi-Bot Foundation Roadmap

_Last updated: 2026-03-29 UTC._

## Purpose

Milestone C transitions S2 from a mostly single-bot runtime into a bot-aware system foundation that can eventually support:

- up to 8 bots
- correct settings per bot
- correct account/subaccount mapping per bot
- cleaner per-bot persistence and observability
- later live execution across multiple Bybit subaccounts

This milestone is deliberately designed to front-load self-contained architecture/code work before higher-friction external account-routing validation.

---

## Milestone C objective

Build the internal architecture that allows S2 to move from:

- one validated demo bot/runtime

to:

- a true multi-bot system foundation with bot identity, per-bot config resolution, and account mapping readiness.

Milestone C is not the full live 8-bot rollout. It is the structural groundwork that makes that rollout reliable and reviewable.

---

## Planning principle for Milestone C

Recent sprint experience showed a strong pattern:

- the best sprints were the ones that could be executed mostly end-to-end in code without too much external interaction
- the most difficult sprints were the ones that depended on shell interactions, service reloads, Cloudflare, or other environment/runtime troubleshooting

Because of that, Milestone C is designed in two layers:

### Type 1 - self-contained foundation sprints
These are high-confidence 30-60 minute sprints that can be executed mostly within the repo/codebase.

### Type 2 - external interaction / activation sprints
These are higher-friction sprints that depend on real account routing, credentials, or external runtime verification.

The milestone intentionally schedules the Type 1 foundation work first.

---

## What is already known going into Milestone C

- S2 currently works for a single-bot style runtime on Bybit demo/testnet
- webhook, reversal logic, TP/SL, break-even, and staged-entry are all now proven in live runtime behaviour
- observability milestone B has produced an internal/external dashboard path with signal, position, event, summary, and health visibility
- Bybit subaccount API keys are already available for 8 bots/accounts

This means Milestone C can focus on architecture and bot-account structure, not on proving the basic execution engine from scratch.

---

## Milestone C sprint family

### Sprint C1 - Bot Registry Model
**Objective**
Introduce a formal bot registry/config structure so the system knows what bots exist.

**Work**
- define bot registry structure
- represent bot ID, symbol, enabled state, and config reference
- create a central bot-definition file or section
- make Bot1 the first concrete example

**Output**
- working bot registry model

**Why first**
This is foundational, self-contained, and low-friction.

---

### Sprint C2 - Bot-Aware Settings Resolution
**Objective**
Load the correct settings for the correct bot instead of relying on one global config.

**Work**
- resolve incoming signal bot ID to bot config
- support per-bot settings path/object
- keep fallback behavior explicit

**Output**
- bot-specific settings resolution

**Why this matters**
This is one of the most important architecture steps in the whole milestone.

---

### Sprint C3 - Bot-Aware Persistence
**Objective**
Ensure stored events/results are clearly attributable to the correct bot.

**Work**
- verify all relevant tables persist bot identity cleanly
- patch gaps where bot ID is missing or inconsistent
- keep timeline/reporting bot-aware

**Output**
- reliable per-bot persistence layer

**Why here**
Before multiple bots exist, persistence must be ready to separate them cleanly.

---

### Sprint C4 - Dashboard Multi-Bot Readiness
**Objective**
Prepare the dashboard to represent multiple bots without yet fully implementing all 8.

**Work**
- add bot labels where needed
- make panels bot-aware in structure
- prepare room for more than one bot state

**Output**
- multi-bot-ready observability structure

**Why now**
This keeps the operator interface aligned with the architecture as it evolves.

---

### Sprint C5 - Bot Credential Mapping Model
**Objective**
Create the internal account/credential mapping structure for bots.

**Work**
- define how bot ID maps to account/subaccount credentials
- do not fully activate all live routing yet
- create a secure reference pattern for 8 subaccounts

**Output**
- bot-to-account mapping model

**Why now**
This is the point where the available Bybit subaccount API keys become structurally useful.

---

### Sprint C6 - Single Subaccount Routing Test
**Objective**
Prove the system can route one bot to one specific subaccount cleanly.

**Work**
- use one bot/account pair
- route execution using mapped credentials
- verify events and trades land in the intended subaccount

**Output**
- first true bot/account routed execution

**Why this is later**
This is the first higher-friction external/account sprint and should only happen after the config/mapping model is clean.

---

### Sprint C7 - Expand Mapping to 8 Bots
**Objective**
Scale the bot/account model from proof-of-concept to full 8-bot readiness.

**Work**
- define 8 bot entries
- define 8 account mappings
- ensure bot lookup and settings lookup scale cleanly

**Output**
- 8-bot registry and mapping readiness

**Why here**
This moves from single routed proof to structured 8-bot readiness without yet forcing a full live rollout.

---

### Sprint C8 - Multi-Bot Execution Readiness Review
**Objective**
Review and validate that S2 is truly ready for 8-bot execution work.

**Work**
- review bot registry
- review settings routing
- review persistence
- review credential mapping
- review dashboard visibility
- identify remaining blockers before full live multi-bot activation

**Output**
- multi-bot readiness assessment

**Why this matters**
This avoids jumping too quickly from Bot1 architecture into full 8-bot live activation without a structured readiness check.

---

## Why this sprint family is structured this way

The milestone intentionally separates:

### Lower-risk / self-contained sprints
- C1
- C2
- C3
- C4
- C5
- C7
- C8

from:

### Higher-friction / external routing sprint
- C6

This preserves the style of sprint execution that has worked best recently:
- clear objective
- lower dependency on manual environment fixes
- more reliable end-to-end sprint completion

---

## How the 8 Bybit subaccount API keys fit

The existence of 8 ready subaccount API keys is valuable, but they should be used at the right point.

Recommended use:

- C5: define the bot/account credential mapping model
- C6: test one bot routed to one real subaccount
- later: expand confidently toward full 8-bot readiness

They should not drive the earliest architecture sprints prematurely.

---

## Recommended execution order

1. C1 - Bot Registry Model
2. C2 - Bot-Aware Settings Resolution
3. C3 - Bot-Aware Persistence
4. C4 - Dashboard Multi-Bot Readiness
5. C5 - Bot Credential Mapping Model
6. C6 - Single Subaccount Routing Test
7. C7 - Expand Mapping to 8 Bots
8. C8 - Multi-Bot Execution Readiness Review

---

## What Milestone C should achieve by the end

By the end of Milestone C, S2 should have:

- a formal bot registry
- bot-specific settings resolution
- bot-aware persistence
- dashboard structure ready for multiple bots
- bot-to-account credential mapping structure
- one proven routed execution into a chosen subaccount
- 8-bot mapping readiness
- a clear readiness review for the next milestone

This should put S2 in a much stronger position for the later stages:
- MDX settings mapping
- deeper DCA strategy work
- broader subaccount live routing
- full multi-bot live comparison against S1
