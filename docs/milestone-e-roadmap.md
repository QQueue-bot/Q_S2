# Milestone E - DCA Strategy Design and Execution Roadmap

_Last updated: 2026-03-30 UTC._

## Purpose

Milestone E adds a practical DCA strategy layer on top of the bot-aware, MDX-aware S2 foundation.

This milestone should answer:

- when the system should add to a position
- how much it should add
- how many additional entries are allowed
- what conditions cancel pending adds
- how DCA interacts with TP, SL, and break-even logic
- whether the resulting first-pass strategy is safe enough for controlled operational use

This milestone should stay practical and compact. The goal is not to create a huge theoretical strategy tree. The goal is to design, represent, implement, and review a sensible first DCA model.

---

## Milestone E objective

Move from:

- staged entries and MDX-driven runtime settings

to:

- an explicit DCA strategy model that can be implemented, validated, and reviewed for controlled use.

---

## Design principle for Milestone E

Keep the first DCA strategy conservative and explainable.

That means:

- limited number of adds
- explicit cancellation rules
- clear interaction with TP, SL, and BE
- easy-to-observe runtime behavior
- no runaway averaging-down behavior
- no ambiguous strategy logic hidden in implementation details

---

## Sprint family

### Sprint E1 - DCA Signal Pattern Review and Initial Strategy Design
**Objective**
Review typical signal behavior and define the first practical DCA strategy for S2.

**Work**
- review common signal sequences and trade paths
- identify realistic continuation versus failure patterns
- define a reasonable first DCA strategy
- define add timing logic, add sizing logic, maximum adds, cancellation conditions, and TP/SL/BE interaction rules
- define what good-enough first implementation means

**Output**
- initial DCA strategy specification

**Validation**
- example signal and trade scenarios are documented
- first-pass DCA rules are explicit
- guardrails and non-goals are explicit

---

### Sprint E2 - DCA Strategy Runtime Model and Resolver
**Objective**
Represent the DCA strategy cleanly in config and runtime terms.

**Work**
- define how DCA strategy lives in S2 settings
- extend MDX/S2 mapping if needed
- represent add levels, add percentages, timing or trigger conditions, maximum adds, BE interaction, and stop conditions
- keep the shape explicit and machine-usable

**Output**
- DCA config/runtime model

**Validation**
- DCA strategy can be represented structurally in S2
- invalid or unsafe DCA config fails clearly
- example strategies serialize cleanly

---

### Sprint E3 - DCA Execution Logic Implementation
**Objective**
Implement the actual DCA behavior in the trade-management/runtime path.

**Work**
- add DCA execution logic
- add or refine staged-entry and add logic
- enforce maximum adds
- block adds when conditions invalidate them
- integrate cleanly with TP, SL, and BE interaction rules
- persist DCA events clearly

**Output**
- working DCA execution behavior

**Validation**
- controlled scenarios show adds happening when expected
- adds are blocked when they should be
- TP, SL, and BE interaction remains coherent
- persistence and visibility for DCA actions is clear

---

### Sprint E4 - DCA Validation and Operator Review
**Objective**
Review whether the first DCA strategy implementation is safe and useful enough for controlled operational use.

**Work**
- review actual DCA execution behavior
- review guardrails
- review persistence and dashboard visibility
- review edge cases and known rough spots
- produce a concrete rollout recommendation

**Output**
- DCA readiness assessment

**Validation / Decision Output**
- produce a concrete result such as:
  - Ready for limited Bot2 DCA-backed activation
  - Ready for controlled Bot1/Bot2 DCA validation
  - Not ready; blockers listed

---

## Recommended execution order

1. E1 - DCA Signal Pattern Review and Initial Strategy Design
2. E2 - DCA Strategy Runtime Model and Resolver
3. E3 - DCA Execution Logic Implementation
4. E4 - DCA Validation and Operator Review

---

## What Milestone E should achieve by the end

By the end of Milestone E, S2 should have:

- an explicit first-pass DCA strategy definition
- a machine-usable DCA config/runtime model
- working DCA execution logic
- clear persistence and visibility for DCA actions
- a readiness review for controlled operational use

---

## Success criterion

Milestone E is successful when S2 has a conservative, understandable, and validated DCA strategy that is ready for limited controlled operational testing without introducing runaway complexity or ambiguous behavior.
