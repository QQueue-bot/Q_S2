# E2 - DCA Runtime Model (Candidate A)

_Last updated: 2026-03-30 UTC._

## Purpose

This document defines the fixed first-pass DCA config/runtime model for Candidate A:

- **Impulse-Aware Confirmation DCA**

E2 deliberately models the chosen first implementation only. It does not attempt to create a generic multi-style DCA framework.

---

## Candidate A model

```json
{
  "dcaStrategy": {
    "enabled": true,
    "mode": "impulse_aware_confirmation",
    "profile": "balanced",
    "entries": {
      "initialEntryPercent": 50,
      "addEntryPercent": 50,
      "maxAdds": 1
    },
    "impulseDetection": {
      "enabled": true,
      "lookbackCandles": 10,
      "rangeMultiplier": 1.5
    },
    "addTiming": {
      "minDelayCandles": 1,
      "maxDelayCandles": 2
    },
    "guards": {
      "blockIfBreakEvenArmed": true,
      "blockIfTakeProfitStarted": true,
      "blockIfOppositeSignal": true,
      "blockIfRegimeInvalid": true
    },
    "stopBehavior": {
      "alterStopOnAdd": false,
      "notes": "DCA does not alter stop structure in Candidate A."
    }
  }
}
```

---

## Meaning of fields

### `entries`
- `initialEntryPercent`: percent of planned position opened on initial trigger
- `addEntryPercent`: percent of planned position reserved for the second add
- `maxAdds`: maximum additional entries allowed

### `impulseDetection`
- `lookbackCandles`: recent candles used to determine normal range behavior
- `rangeMultiplier`: threshold for classifying the trigger candle as impulsive

### `addTiming`
- `minDelayCandles`: earliest eligible add timing after initial trigger
- `maxDelayCandles`: latest eligible add timing after initial trigger

### `guards`
- `blockIfBreakEvenArmed`: do not add once break-even is armed
- `blockIfTakeProfitStarted`: do not add after TP logic begins
- `blockIfOppositeSignal`: do not add if opposite signal appears
- `blockIfRegimeInvalid`: do not add if original signal regime is invalidated

### `stopBehavior`
- `alterStopOnAdd = false`: adding does not alter the stop structure in Candidate A

---

## E2 decisions captured

- Candidate A is modeled as a fixed first-pass strategy shape
- no generic multi-style DCA framework is introduced yet
- total planned entry split is fixed at 50/50 for the first-pass model
- max adds is fixed at 1 for the first-pass model
- impulse detection is a first-class configuration element
- cancellation rules are explicit and machine-usable
- DCA does not alter stop structure in Candidate A

---

## Validation expectations

A valid Candidate A strategy must:

- use `mode = impulse_aware_confirmation`
- have initial and add entry percents summing exactly to 100
- use `maxAdds = 1`
- define valid impulse detection settings
- define valid delay settings
- define explicit boolean guard flags
- keep `alterStopOnAdd = false`

---

## Recommended next step

Proceed to **Sprint E3 - DCA Execution Logic Implementation** using this Candidate A model as the implementation contract.
