# E1 - DCA Strategy Options Review

_Last updated: 2026-03-30 UTC._

## Purpose

This document records the candidate DCA strategies considered during E1 so the first implementation choice is explicit and alternative ideas remain available for later optimization.

The goal of E1 is not to prove which option is best mathematically from a chart screenshot alone. The goal is to define sensible first-pass candidates and choose a conservative, explainable implementation path.

---

## Signal behavior assumptions from review

Based on the reviewed STX / NEAR charts and discussion, the bot signal appears to behave like a regime-following system where:

- a regime starts with a buy or sell trigger
- the initial entry currently occurs at the close of the trigger candle
- some trades appear to continue smoothly
- some trades appear to wobble or dip after the initial trigger before continuing
- some triggers likely fail and should not be averaged into aggressively

This suggests that the first DCA strategy should:

- improve average entry on weak starts where possible
- avoid blindly chasing large impulse candles
- avoid open-ended averaging down
- preserve a clear and limited risk structure

---

## Candidate A - Impulse-Aware Confirmation DCA

### Summary
- 50% initial entry on trigger candle close
- second 50% only if follow-up conditions remain valid
- if the trigger candle is unusually large relative to recent candles, delay the second fill by 1–2 candles

### Why it was considered
This strategy is conservative and avoids overcommitting after an impulsive move.

### Example rule shape
- Entry 1: 50% at trigger candle close
- classify the trigger candle relative to the recent average range (for example last 10 candles)
- if the trigger candle is not impulsive:
  - second 50% can be eligible on next confirmation candle
- if the trigger candle is impulsive:
  - second 50% is delayed 1–2 candles
  - trade regime must still be valid
  - no opposite signal / exit / BE / TP invalidation
  - avoid adding if price is already excessively extended

### Pros
- simple and explainable
- safer first implementation
- avoids buying the second half immediately after an oversized impulse candle
- easier to validate operationally

### Cons
- may buy the second half at a worse price in strong continuation moves
- may not improve average entry much in dip-and-recover trades
- still somewhat time/confirmation dependent

---

## Candidate B - Risk-Capped Pullback / Reclaim DCA

### Summary
- 50% initial entry on trigger candle close
- additional entries only if price remains below the initial entry price while the regime remains valid
- keep the stop anchored to the original invalidation price
- complete the remaining size only on reclaim / confirmation

### Why it was considered
This strategy can improve average entry on trades that dip after the trigger but later continue, while keeping the stop anchored to the original invalidation structure.

### Key design principle
The stop should remain at the original trade invalidation price rather than moving lower as size is added. This preserves the trade's invalidation structure and makes the DCA logic more defensible.

### Example rule shape
- Entry 1: 50% at trigger candle close
- if price remains below initial entry while regime remains valid:
  - allow one or two controlled adds in smaller chunks
- keep the same absolute stop price
- complete the remaining size only if price reclaims the initial entry and regime remains valid
- cancel further adds if:
  - opposite signal
  - exit condition triggered
  - BE armed
  - TP started
  - max adverse drift exceeded

### Pros
- potentially improves blended entry materially
- more aligned with true DCA behavior
- benefits from pullback/recovery patterns
- fixed stop structure can make total loss smaller than full-size immediate entry if the trade later fails after partial scaling

### Cons
- more complex than Candidate A
- increases size while the trade is under pressure
- can still become averaging into weakness if not tightly constrained
- needs stronger exposure caps and add limits

---

## Candidate C - Pure Confirmation Add

### Summary
- 50% at initial trigger
- 50% on the next confirmation candle if the regime is still active

### Why it was considered
This is the simplest staged-entry extension.

### Pros
- extremely simple
- easy to test
- low implementation complexity

### Cons
- too blunt
- can chase continuation after an already large move
- does not adapt well to entry quality

### Status
Recorded for completeness, but not preferred as the best design candidate.

---

## Candidate D - Time-Staged Add Only

### Summary
- 50% initial entry
- fixed delayed second fill after N candles if still valid

### Why it was considered
Deterministic and easy to implement.

### Pros
- simple
- predictable

### Cons
- time alone is not a strong market-quality filter
- can add too late or in poor conditions

### Status
Recorded for completeness, but not preferred as the best design candidate.

---

## Candidate E - Pullback-in-Trend Add

### Summary
- 50% initial entry
- second fill only on controlled retrace while regime remains valid

### Why it was considered
Could improve average entry without requiring multiple lower candles.

### Pros
- more market-aware than pure time staging
- potentially good average entry improvement

### Cons
- more parameter-sensitive
- harder to tune for a first implementation

### Status
Recorded for completeness, and may later combine with Candidate B ideas.

---

## Candidate F - Hybrid Confirmation / Pullback DCA

### Summary
A blended model combining:
- initial partial entry
- confirmation logic
- and some awareness of pullback / extension

### Why it was considered
This is the broad design family from which Candidate A and Candidate B emerged.

### Status
Rather than keeping it vague, E1 narrows this family into two practical candidates:
- Candidate A (Impulse-Aware Confirmation)
- Candidate B (Risk-Capped Pullback / Reclaim)

---

## Recommended E1 conclusion

### Preferred first implementation candidate
**Candidate A - Impulse-Aware Confirmation DCA**

Reason:
- safer
- simpler
- easier to validate
- lower risk of accidental over-averaging in weak trades

### Strong secondary candidate for later optimization
**Candidate B - Risk-Capped Pullback / Reclaim DCA**

Reason:
- may produce better average entries on dip-then-continue behavior
- strategically attractive if the stop remains fixed to the original invalidation price
- should be preserved for future testing and optimization

---

## Shared guardrails for any first-pass DCA model

The following should apply regardless of candidate chosen:

- maximum additional entries should be tightly capped
- no adds after BE is armed
- no adds after TP logic begins
- no adds after an opposite signal
- no silent risk expansion
- total committed size should remain bounded and explicit
- all DCA behavior should be easy to observe and test

---

## Recommendation for Milestone E progression

### E1 outcome
- document candidate strategies
- select the conservative first implementation
- preserve stronger but riskier alternatives for later optimization

### E2/E3 focus
- implement the chosen first-pass DCA strategy cleanly
- keep the alternative strategies documented for later experimentation once the base system is stable
