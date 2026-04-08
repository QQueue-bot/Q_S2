# S2 offline review assessment and bug-fix proposal 2026-04-08

## Assessment of the last 24h review pack

### Overall judgement

The current 24h offline pack is more useful as a **runtime QA / trade-management validation pack** than as a clean **regime-analysis pack**.

Reason:
- multiple observed outcomes are still materially affected by runtime management behaviour
- this makes it hard to judge signal quality or market regime quality cleanly from trade outcome alone

So the pack still has value, but the strongest value right now is in surfacing runtime issues that must be controlled before regime conclusions are trusted.

---

## Main findings

### 1. Bot4 / CRVUSDT break-even behaviour remains the most suspicious runtime issue

Observed in the pack:
- Bot4 entered at `2026-04-08T00:00:14Z`
- Bot4 then closed at break-even at `2026-04-08T00:00:20Z`
- trigger shown: `3.24`
- mark price effectively equal to entry price

This does **not** look like a valid trade-quality outcome.
It looks like runtime state/logic behaviour.

Most likely interpretation:
- stale break-even arm state was affecting fresh trades
- or the break-even state machine advanced incorrectly without a valid arm path

Current status:
- this bug was identified and patched in `8ad814d`
- so it should now be treated as a **known pre-fix runtime distortion**, not as evidence that the CRV entry itself was bad

### 2. Bot2 / NEARUSDT TP behaviour looks fragmented / repeatedly re-fired

Observed pattern:
- many repeated TP events
- same `exit_reason: take_profit`
- same `trigger_percent: 4.22`
- same `close_percent: 8.0`

This does not match the intended TP allocation model where a TP level should execute once and then advance state.

Most likely interpretation:
- TP state is not being persisted or advanced correctly
- a reached TP level is being re-triggered repeatedly until the whole position is gone

This is likely a runtime management bug, not a market-regime conclusion.

### 3. DCA policy interpretation needs timing discipline

Concern raised:
- DCA events appear on bots whose current policy is `dca_enabled: false`

This is a valid concern and should be watched as a possible config/runtime mismatch.

However, the interpretation must be time-scoped:
- if those DCA events happened before the selective-DCA rollout, they are historical pre-fix behaviour
- if they happen after the rollout, they are a live bug

So this item should currently be framed as:
- **serious policy-integrity check required**
- but not automatically labeled as a current live runtime bug without pre/post rollout separation

---

## Trade-quality observations that still appear usable

### NEARUSDT

NEAR remains the strongest candidate in this pack for a directionally valid trade example:
- entry held long enough to matter
- price moved enough to engage management
- outcome suggests the raw signal may have been directionally correct

Caution:
- management behaviour still appears to have distorted the final exit path
- so it is not a pure “strategy-only” example yet

### STXUSDT

STX is currently the best candidate for manual chart review:
- live/open example in the pack
- not already invalidated by a clearly suspicious recorded exit in the same way as CRV
- better suited to studying whether entry quality was good, poor, late, or structurally weak

### CRVUSDT

CRV should **not** yet be used as a clean regime-quality judgement case.

Reason:
- runtime behaviour likely invalidated the outcome
- current evidence does not support concluding that the entry itself was poor

---

## Corrected summary judgement

A more precise statement is:

> There are at least three runtime logic issues or suspected runtime-state mismatches currently dominating interpretation of the last 24h trade outcomes. As a result, this review pack is currently stronger as a runtime QA / management-validation pack than as a clean regime-analysis pack.

That is the correct frame for further work.

---

# Proposal summary for needed bug fixes

## Priority 1 — Confirm and monitor F3M break-even fix in live runtime

### Problem
Fresh trades on the same symbol could inherit stale break-even armed state and close immediately at entry.

### Status
- already identified
- already patched in `8ad814d`
- already deployed

### Needed next action
- monitor the next Bot4/CRV trade
- confirm no immediate break-even close occurs
- if clean, close this as validated under live conditions

---

## Priority 2 — Fix TP state persistence / repeated TP re-fire behaviour

### Problem
Same TP level appears to execute repeatedly (example: NEAR at `trigger_percent = 4.22`, `close_percent = 8.0`) instead of progressing cleanly through the TP ladder.

### Why it matters
This distorts:
- trade outcomes
- review quality
- regime analysis
- trust in per-level TP allocation design

### Likely root cause class
- TP state not persisted correctly
- or TP level completion not remembered after first execution
- or TP reevaluation loop keeps reusing the same level

### Required fix objective
Ensure each TP level is:
- triggered once per trade lifecycle
- recorded as completed
- not repeatedly re-fired unless explicitly designed

---

## Priority 3 — Add explicit pre/post rollout DCA policy validation

### Problem
Current review interpretation can confuse historical DCA behaviour with post-policy-change behaviour.

### Why it matters
Without time-scoping, DCA policy integrity cannot be judged accurately.

### Required fix objective
For DCA validation/reporting:
- separate pre-rollout from post-rollout events
- confirm whether any post-rollout Bot1/Bot4 DCA add still occurs while DCA policy is off
- if yes, treat as a live runtime bug

### Minimum implementation
- add a simple validation note or report field showing whether the trade occurred before or after the selective-DCA rollout
- optionally log DCA policy state alongside staged-entry decisions

---

## Priority 4 — Improve offline review material with cleaner trade-state evidence

### Problem
The offline pack is useful, but still mixes genuine trade-quality evidence with runtime-management distortions.

### Required improvement
Enhance future review material with:
- explicit pre-fix / post-fix labels
- clearer trade lifecycle timelines
- max favorable / adverse excursion where possible
- clear runtime-management notes when trade outcomes are not strategy-clean

This is not just reporting polish. It directly improves decision quality for regime strategy work.

---

## Recommended sequence

1. Validate F3M live on the next CRV trade
2. Open/fix the TP repeated re-fire bug as the next serious management issue
3. Add post-rollout DCA policy validation so selective DCA integrity can be proven
4. Continue offline review only after runtime distortions are reduced enough that trade outcomes are strategy-meaningful

---

## Final conclusion

The review pack is valuable, but its strongest current use is:
- identifying management/runtime bugs
- separating valid signal examples from invalidated trade outcomes
- preventing premature regime conclusions from distorted exits

The next bug-fix focus should therefore be:
1. validate the deployed Bot4 break-even fix
2. fix repeated TP re-fire behaviour
3. verify selective DCA policy integrity under current runtime
