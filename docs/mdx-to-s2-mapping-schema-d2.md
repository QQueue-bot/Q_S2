# D2 - MDX-to-S2 Mapping Schema

_Last updated: 2026-03-29 UTC._

## Purpose

This document defines the first-pass translation schema from MDX source fields into normalized S2 settings concepts.

D2 builds on D1.

D1 answered:
- what exists on the MDX settings page
- how the source should be structured

D2 answers:
- what maps directly into S2 settings
- what maps indirectly / derivatively
- what remains metadata only
- what is not supported yet
- when warnings or hard failures should occur

---

## Core D2 decisions

### 1. Default profile selection
The default MDX profile is:

- `balanced`

Unless later bot-specific logic says otherwise, D2 assumes S2 should map from the selected/default MDX profile, which is currently `balanced`.

### 2. Top-half page values are metadata only
The top-half TradingView signal-bot fields are recorded but are not mapped directly into S2 runtime execution settings in D2.

These fields remain useful for:
- change tracking
- drift detection
- audit/reference

### 3. Profile strategy settings are the main runtime mapping source
The MDX profile cards are the primary source for runtime-relevant S2 settings in D2.

### 4. `SL to BE = TP1` mapping rule
Confirmed D2 rule:

- if MDX says `SL to BE = TP1`
- then S2 `breakEven.triggerPercent` = selected profile `TP1 target percent`

Interpretation:
- move/arm break-even when price reaches TP1 target percent

---

## Mapping categories

D2 uses four categories:

### A. Direct runtime mappings
Fields that map directly into current S2 settings structure.

### B. Derived runtime mappings
Fields that require interpretation or transformation before landing in S2.

### C. Metadata-only fields
Fields that are stored/referenced but do not affect current S2 runtime settings directly.

### D. Unsupported / deferred fields
Fields that are visible in MDX but should not be mapped into runtime settings yet.

---

## A. Direct runtime mappings

### 1. TP ladder targets
MDX source:
- `tp1TargetPercent`
- `tp2TargetPercent`
- `tp3TargetPercent`
- `tp4TargetPercent`
- `tp5TargetPercent`
- `tp6TargetPercent`

S2 target:
- `takeProfit.levels[n].triggerPercent`

Rule:
- `tpNTargetPercent -> takeProfit.levels[N].triggerPercent`

### 2. TP ladder allocations
MDX source:
- `tp1AllocationPercent`
- `tp2AllocationPercent`
- `tp3AllocationPercent`
- `tp4AllocationPercent`
- `tp5AllocationPercent`
- `tp6AllocationPercent`

S2 target:
- `takeProfit.levels[n].closePercent`

Rule:
- `tpNAllocationPercent -> takeProfit.levels[N].closePercent`

### 3. Stop loss
MDX source:
- `stopLossPercent`

S2 target:
- `stopLoss.triggerPercent`

Rule:
- `stopLossPercent -> stopLoss.triggerPercent`

### 4. Leverage
MDX source:
- `leverage`

S2 target:
- `positionSizing.leverage`

Rule:
- `leverage -> positionSizing.leverage`

---

## B. Derived runtime mappings

### 1. Break-even trigger
MDX source:
- `slToBeTrigger = TP1 | TP2 | TP3`

S2 target:
- `breakEven.triggerPercent`

Rule:
- if `slToBeTrigger = TP1`, then:
  - `breakEven.triggerPercent = tp1TargetPercent`
- if `slToBeTrigger = TP2`, then:
  - `breakEven.triggerPercent = tp2TargetPercent`
- if `slToBeTrigger = TP3`, then:
  - `breakEven.triggerPercent = tp3TargetPercent`

General interpretation:
- the break-even trigger is derived from a symbolic MDX reference to a TP milestone

### 2. TP level enablement
MDX source:
- visible TP target/allocation pairs in the selected profile

S2 target:
- `takeProfit.levels[n].enabled`

Rule:
- if a TP level has both:
  - target percent > 0
  - allocation percent > 0
- then that TP level is enabled
- otherwise disabled

### 3. Take-profit enablement overall
S2 target:
- `takeProfit.enabled`

Rule:
- enabled if one or more mapped TP levels are enabled

### 4. Stop-loss enablement overall
S2 target:
- `stopLoss.enabled`

Rule:
- enabled if `stopLossPercent > 0`

### 5. Break-even enablement overall
S2 target:
- `breakEven.enabled`

Rule:
- enabled if `slToBeTrigger` resolves successfully to a supported TP reference

---

## C. Metadata-only fields

These fields should be stored/referenced but not mapped into current S2 runtime settings in D2.

### Top-half TradingView signal-bot metadata
- `optimizedPeriod`
- `exchange`
- `timeframe`
- `signalSetting`
- `baseline`
- `baselineValue`
- `slType`
- `slValue`

### Top-level source performance metadata
- `performance30d`
- `performance90d`
- `performance180d`
- `performance360d`
- `winrate`
- `profitFactor`

### Profile-level performance metadata
- `tradeCount`
- `winrate`
- `netProfit`
- `maxDrawdown`
- `avgTradeProfit`

Reason:
- useful for source tracking and future analysis
- not part of the current S2 runtime settings contract

---

## D. Unsupported / deferred fields

These are not runtime-mapped in D2 and should be surfaced explicitly where relevant.

### 1. `slType`
Observed example:
- `ATR`

Why deferred:
- current S2 stop-loss model is a simple percentage trigger
- S2 does not yet support ATR-based stop-loss semantics directly

Treatment:
- metadata only
- warn if later mapping attempts try to force semantic equivalence

### 2. `slValue`
Observed example:
- `5`

Why deferred:
- tied to `slType`
- not clearly equivalent to current S2 stop-loss semantics

Treatment:
- metadata only
- warning if a runtime mapping is expected without a later semantic rule

### 3. `baseline` / `baselineValue`
Why deferred:
- appear to describe TradingView/source-side logic
- not part of current S2 runtime trade-management config

Treatment:
- metadata only

### 4. `signalSetting`
Why deferred:
- appears source-side, not runtime-side

Treatment:
- metadata only

---

## Mapping table

| MDX field | Category | S2 target | Rule |
|---|---|---|---|
| `tpNTargetPercent` | Direct | `takeProfit.levels[N].triggerPercent` | copy numeric percent |
| `tpNAllocationPercent` | Direct | `takeProfit.levels[N].closePercent` | copy numeric percent |
| `stopLossPercent` | Direct | `stopLoss.triggerPercent` | copy numeric percent |
| `leverage` | Direct | `positionSizing.leverage` | copy numeric leverage |
| `slToBeTrigger=TP1|TP2|TP3` | Derived | `breakEven.triggerPercent` | set to selected profile referenced TP target percent |
| visible TP level pair | Derived | `takeProfit.levels[N].enabled` | enabled when target and allocation > 0 |
| selected profile exists | Derived | profile selection | use `balanced` by default |
| top-half settings | Metadata only | none | store only |
| performance metrics | Metadata only | none | store only |
| `slType` / `slValue` | Unsupported / deferred | none | keep as metadata; do not runtime-map yet |

---

## Example D2 mapping result (Balanced profile)

Given the observed Balanced profile values:

- TP1: `4.27%` / `8%`
- TP2: `6.98%` / `40%`
- TP3: `9.91%` / `12%`
- TP4: `15.03%` / `12%`
- TP5: `33.21%` / `14%`
- TP6: `53.87%` / `14%`
- Stop Loss: `6%`
- SL to BE: `TP1`
- Leverage: `4x`

The first-pass normalized S2-shaped mapping result would be:

```json
{
  "positionSizing": {
    "leverage": 4
  },
  "takeProfit": {
    "enabled": true,
    "levels": [
      { "index": 1, "triggerPercent": 4.27, "closePercent": 8,  "enabled": true },
      { "index": 2, "triggerPercent": 6.98, "closePercent": 40, "enabled": true },
      { "index": 3, "triggerPercent": 9.91, "closePercent": 12, "enabled": true },
      { "index": 4, "triggerPercent": 15.03, "closePercent": 12, "enabled": true },
      { "index": 5, "triggerPercent": 33.21, "closePercent": 14, "enabled": true },
      { "index": 6, "triggerPercent": 53.87, "closePercent": 14, "enabled": true }
    ]
  },
  "stopLoss": {
    "enabled": true,
    "triggerPercent": 6
  },
  "breakEven": {
    "enabled": true,
    "triggerPercent": 4.27,
    "sourceRule": "slToBeTrigger=TP1"
  }
}
```

---

## Hard-fail versus warning behavior

### Hard fail
Use hard fail when:
- selected/default profile is missing
- TP reference used in `slToBeTrigger` cannot be resolved
- TP target/allocation fields needed for the selected profile are malformed
- stop-loss value intended for runtime mapping is missing or non-numeric
- leverage intended for runtime mapping is missing or non-numeric

### Warning only
Use warning when:
- top-half source metadata changes
- metadata-only fields are present but not runtime-mapped
- profile performance metrics are present but unused
- unsupported source fields exist but are being preserved as metadata

---

## What D2 does not do yet

D2 does **not** yet:
- implement resolver code
- wire the mapping into runtime
- decide how accountPercent should be derived from MDX
- decide how DCA concepts beyond the current visible TP/SL/BE structure should map
- decide whether ATR-style stop-loss should be added to S2 in the future

Those belong to later sprints.

---

## Recommended next step

Proceed to **Sprint D3 - MDX Mapping Resolver**.

D3 should take this mapping schema and turn it into code that:
- accepts an MDX source object
- selects the active profile (`balanced` by default)
- emits normalized S2-shaped config output
- fails or warns according to the D2 rules above
