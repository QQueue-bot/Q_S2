# Model Routing Policy (Initial)

_Last updated: 2026-03-29 UTC._

This document defines the initial model-routing policy for S2 collaboration.

The aim is to reduce cost carefully without degrading quality on strategic or safety-relevant work.

---

## 1. Default rule

The default assumption is:

- keep the main collaboration on the premium/highest-quality model

This is especially important while S2 is still evolving architecturally and while live-trading behaviour and safety logic are still being refined.

---

## 2. Premium model lane

Use the premium model for work that involves:

- sprint planning
- roadmap design
- architectural decisions
- debugging unclear or high-impact issues
- live trading behaviour
- risk / safety logic
- strategic docs and product reasoning
- ambiguous tasks where the cost of being wrong is high

In plain English:

> Premium model for thinking, safety, architecture, and ambiguity.

---

## 3. Lower-cost model lane (initial scope)

The initial lower-cost lane should be kept intentionally small.

### First approved lower-cost lane

- Trello housekeeping
- moving cards between lists
- adding routine card descriptions from already-agreed scope
- posting standard sprint result comments
- routine status/admin updates on Trello

In plain English:

> Trello admin goes cheap. Trello thinking stays premium.

---

## 4. Important distinction for Trello tasks

Not all Trello work is equal.

### Lower-cost Trello tasks

Safe to route to lower-cost model when the task is mostly administrative, for example:

- move this card to Done
- create these standard backlog cards
- apply already-agreed card template text
- post a standard sprint result comment based on already-known facts

### Premium Trello tasks

Keep on premium when the Trello work defines or changes meaning, for example:

- defining sprint scope
- deciding objectives / validation / non-goals
- writing architecture-relevant card text
- documenting safety-critical behaviour
- anything where the card itself is part of product thinking

---

## 5. Escalation rule

If a lower-cost task turns out to require:

- judgment
- ambiguity resolution
- architectural reasoning
- debugging
- safety tradeoffs

then it should be escalated back to the premium model.

This means cost reduction should never override correctness on important work.

---

## 6. Why this policy starts small

The goal is not to optimize every token immediately.
The goal is to start with one low-risk category, evaluate quality and workflow impact, and only then widen the lower-cost lane if it proves worthwhile.

The first experimental lane is Trello admin because it is:

- structured
- repetitive
- easy to verify
- low consequence if wording is slightly imperfect

---

## 7. Likely future expansion candidates

If the Trello experiment works well, likely next lower-cost candidates are:

- routine monitoring checks
- log summaries
- simple documentation cleanup
- repetitive dashboard/admin work once specifications are already clear

These should only be moved after validating that quality remains acceptable.

---

## 8. Summary

### Premium lane
- strategy
- planning
- debugging
- architecture
- live/safety logic
- ambiguous decisions

### Initial lower-cost lane
- Trello admin and routine board housekeeping only

### Escalate back to premium when
- task stops being routine
- task becomes strategic or safety-relevant
- ambiguity appears
