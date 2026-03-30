# Sprint E4 Recap

_Last updated: 2026-03-30 UTC._

## Scope

Sprint E4 reviewed whether the first DCA strategy implementation (Candidate A) is safe and useful enough for controlled Bot1 DCA validation.

## Review areas covered

- Candidate A config/runtime model
- impulse classification behavior
- add-delay behavior
- add-block conditions
- DCA persistence / visibility
- interaction with TP, SL, and BE
- current runtime caveats affecting operational interpretation

## Findings

### 1. Architecture and model readiness

**Status: strong**

Confirmed:

- Candidate A is now represented as a machine-usable runtime model
- validation rules are explicit
- add timing and guard rules are explicit
- stop behavior is explicit (`alterStopOnAdd = false`)

Interpretation:

The first-pass DCA strategy contract is clear and implementation-ready.

### 2. Local execution-logic readiness

**Status: good**

Confirmed:

- normal trigger candles resolve to 1-candle delayed add timing
- impulsive trigger candles resolve to 2-candle delayed add timing
- break-even armed blocks the add correctly
- clear state leaves add eligibility open

Interpretation:

The local Candidate A execution behavior is coherent and understandable.

### 3. Persistence / operator visibility readiness

**Status: partially ready**

Confirmed:

- staged entry history exists and is understandable
- E3 added explicit DCA event persistence model (`dca_events`)

Caveat:

- the live runtime database has not yet been re-initialized under the updated code path, so `dca_events` is not yet present in the current runtime DB snapshot

Interpretation:

The persistence design is good, but live operator visibility is not fully proven until the updated runtime code has actually run against the live DB and produced `dca_events` rows.

### 4. Runtime policy readiness

**Status: not yet clean**

Observed caveats:

- runtime sizing still carries temporary proof settings from earlier live validation (`accountPercent = 5`)
- stop loss in runtime config is still placeholder (`triggerPercent = 0.0`)
- take-profit / break-even notes still contain older demo-validation wording
- historical exit/break-even rows still reflect earlier 0.15-era behavior, which can confuse operator review

Interpretation:

The DCA logic itself is promising, but the surrounding runtime policy state is not yet clean enough for comfortable controlled Bot1 DCA validation.

## Readiness decision

### Recommendation: **Not ready; blockers listed**

Candidate A itself looks viable, but controlled Bot1 DCA validation should wait until the surrounding runtime/persistence state is cleaned up enough to make the test interpretable.

## Blockers before controlled Bot1 DCA validation

1. restart / run the updated runtime code so the live DB initializes the new `dca_events` table and produces real DCA persistence rows
2. normalize runtime settings away from temporary proof-state leftovers where appropriate
3. replace placeholder stop-loss runtime value with a real reviewed policy before combining it with DCA validation
4. reduce operator confusion by reconciling outdated note text / legacy historical interpretation where needed

## Safe next actions

- boot the updated runtime path and verify `dca_events` persistence exists in the live DB
- review/fix the live runtime settings bundle before turning on controlled Bot1 DCA validation
- then re-run a focused DCA readiness checkpoint if needed

## Final assessment

### DCA architecture readiness
- **Ready**

### DCA local execution-logic readiness
- **Ready**

### Controlled Bot1 DCA validation readiness
- **Not yet**
