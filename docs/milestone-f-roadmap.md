# Milestone F - Runtime Hardening and Controlled Live Validation Roadmap

_Last updated: 2026-03-30 UTC._

## Purpose

Milestone F hardens the actual runtime so the system is clean enough for controlled live validation and the next limited activation decisions.

At this stage, the main blockers are no longer architecture or strategy design. The main blockers are:

- temporary runtime proof-state leftovers
- runtime / persistence activation gaps
- operator visibility gaps
- need for a clean controlled live DCA validation path

This milestone should stay operational and compact.

---

## Milestone F objective

Move from:

- built-but-not-yet-clean runtime state

to:

- a hardened runtime baseline that supports controlled Bot1 DCA live validation and a clear next activation decision.

---

## Sprint family

### Sprint F1 - Runtime Policy and Config Cleanup
**Objective**
Clean up temporary runtime policy/settings so the system is operating from intentional values instead of leftover proof/test state.

**Work**
- review live runtime settings
- replace temporary proof-specific values
- define real stop-loss policy
- clean up outdated notes and labels
- reconcile repo/runtime config intent where appropriate
- reduce operator confusion

**Output**
- clean runtime policy baseline

**Validation**
- runtime config no longer carries temporary proof leftovers
- stop-loss is no longer placeholder
- runtime notes match actual operating intent
- key config values are explicit and reviewable

---

### Sprint F2 - Runtime Persistence and Observability Activation
**Objective**
Ensure the updated runtime actually boots and produces the new persistence/observability data needed for DCA validation.

**Work**
- run updated runtime code against the live DB/runtime path
- verify new persistence structures exist in runtime DB
- confirm `dca_events` and related data are actually being produced
- verify dashboard / operator visibility is sufficient for DCA validation
- check for migration/runtime drift issues

**Output**
- proven runtime persistence/visibility path

**Validation**
- `dca_events` exists in live/runtime DB
- updated runtime code is actually in use
- persistence is visible and interpretable
- no hidden runtime/schema drift blocks review

---

### Sprint F3 - Controlled Bot1 DCA Live Validation
**Objective**
Run a controlled live validation of the new DCA behavior on Bot1.

**Work**
- validate Candidate A in the real runtime path
- observe initial entry / delayed add logic
- confirm skip/block conditions work as intended
- confirm persistence and logs tell the story clearly
- keep this tightly controlled

**Output**
- first clean live DCA validation proof

**Validation**
- Bot1 DCA path executes in live/runtime conditions
- delay logic behaves as expected
- blocked-add rules behave as expected
- persistence/logging is sufficient for operator review

---

### Sprint F4 - Controlled Activation Review
**Objective**
Decide whether the system is ready for the next limited operational step after Bot1 DCA validation.

**Work**
- review runtime cleanup results
- review persistence/visibility results
- review live DCA validation outcome
- identify remaining blockers or green lights
- produce a concrete next-step recommendation

**Output**
- operational readiness recommendation

**Validation / Decision Output**
- produce a concrete result such as:
  - Ready for limited Bot2 activation
  - Ready for continued Bot1 DCA monitoring only
  - Not ready; blockers listed

---

## Recommended execution order

1. F1 - Runtime Policy and Config Cleanup
2. F2 - Runtime Persistence and Observability Activation
3. F3 - Controlled Bot1 DCA Live Validation
4. F4 - Controlled Activation Review

---

## What Milestone F should achieve by the end

By the end of Milestone F, S2 should have:

- a cleaned-up runtime policy baseline
- active runtime persistence for the newer DCA lifecycle events
- a controlled Bot1 DCA live validation result
- a clear recommendation on the next limited activation step

---

## Success criterion

Milestone F is successful when the live runtime is clean, observable, and trustworthy enough to validate DCA behavior on Bot1 and support a credible next-step activation decision.
