# D1 - MDX Settings Source Model

_Last updated: 2026-03-29 UTC._

## Purpose

This document captures the first-pass source model for MDX bot settings as observed from the MDX bot settings page.

The immediate goal of D1 is not to define the final S2 runtime mapping. It is to define:

- what fields exist in the MDX source page
- which fields appear operationally relevant to S2 runtime behavior
- which values are profile-specific versus top-level bot metadata
- which fields are likely TradingView signal-bot inputs or optimization metadata
- what a normalized MDX source object should look like before any S2 mapping is applied

---

## Source observation basis

Current source basis:

- screenshot of the MDX bot settings page for the `IP` token bot (`IPUSDT`)
- user guidance that the page format is the same across bots
- user guidance that **Balanced** should be treated as the default risk profile
- user guidance that the top-half settings are used in the TradingView signal bot and are worth recording for change tracking even if they do not directly drive S2 runtime behavior

---

## High-level source structure

The MDX page appears to contain three logical sections:

1. **Top-half bot / TradingView settings metadata**
2. **Performance / optimization metadata**
3. **Risk profile strategy settings**

These should be modeled separately.

---

## 1. Top-half bot / TradingView settings metadata

These fields appear in the upper part of the page.

Observed fields:

- `botName`: `IP`
- `asset`: `IPUSDT`
- `optimizedPeriod`: `180 Days`
- `exchange`: `Bybit`
- `timeframe`: `165m`
- `signalSetting`: `4`
- `baseline`: `TMA`
- `baselineValue`: `45`
- `slType`: `ATR`
- `slValue`: `5`

### Interpretation

Per user guidance, these are likely settings loaded into the **TradingView signal bot** rather than directly into the S2 runtime execution layer.

Therefore:

- they should still be recorded in the MDX source model
- they should **not** automatically be treated as direct S2 execution settings
- they may be useful later for:
  - change tracking
  - drift detection
  - user notification when MDX source settings change

### D1 modeling recommendation

Treat these fields as:

- `signalBotSourceMeta`

and explicitly distinguish them from runtime-execution settings.

---

## 2. Performance / optimization metadata

Observed top-level fields:

- `performance30d`: `19.12%`
- `performance90d`: `75.09%`
- `performance180d`: `653.34%`
- `performance360d`: `N/A`
- `winrate`: `75%`
- `profitFactor`: `3.543`

Observed profile-level fields:

- `leverage`
- `tradeCount`
- `winrate`
- `netProfit`
- `maxDrawdown`
- `avgTradeProfit`

### Interpretation

These are best treated as **performance / optimization metadata**, not direct runtime execution settings.

They may still be useful later for:

- operator review
- source auditing
- selecting default profiles
- reporting / comparison against S1 or future S2 variants

### D1 modeling recommendation

Treat these fields as:

- `sourcePerformanceMeta`
- `profilePerformanceMeta`

and keep them separate from runtime-usable settings.

---

## 3. Risk profile strategy settings

The most important runtime-relevant section of the page is the risk-profile configuration.

Observed profiles:

- `safe`
- `balanced`
- `aggressive`

User guidance:

- **Balanced is the default profile**

### Common observed per-profile fields

Each profile appears to define:

- `tp1TargetPercent`
- `tp1AllocationPercent`
- `tp2TargetPercent`
- `tp2AllocationPercent`
- `tp3TargetPercent`
- `tp3AllocationPercent`
- `tp4TargetPercent`
- `tp4AllocationPercent`
- `tp5TargetPercent`
- `tp5AllocationPercent`
- `tp6TargetPercent`
- `tp6AllocationPercent`
- `stopLossPercent`
- `slToBeTrigger`
- `leverage`
- `tradeCount`
- `winrate`
- `netProfit`
- `maxDrawdown`
- `avgTradeProfit`

### Observed values

#### Safe
- TP1: `3.74%` / `26%`
- TP2: `5.17%` / `25%`
- TP3: `9.14%` / `15%`
- TP4: `13.61%` / `14%`
- TP5: `23.57%` / `11%`
- TP6: `49%` / `9%`
- Stop Loss: `6%`
- SL to BE: `TP1`
- Leverage: `2x`

#### Balanced
- TP1: `4.27%` / `8%`
- TP2: `6.98%` / `40%`
- TP3: `9.91%` / `12%`
- TP4: `15.03%` / `12%`
- TP5: `33.21%` / `14%`
- TP6: `53.87%` / `14%`
- Stop Loss: `6%`
- SL to BE: `TP1`
- Leverage: `4x`

#### Aggressive
- TP1: `4.51%` / `8%`
- TP2: `7.67%` / `27%`
- TP3: `10.34%` / `16%`
- TP4: `15.6%` / `15%`
- TP5: `35.4%` / `24%`
- TP6: `57.35%` / `10%`
- Stop Loss: `6%`
- SL to BE: `TP1`
- Leverage: `6x`

---

## Typed field inventory

### Bot metadata
| Field | Type | Example | Notes |
|---|---|---:|---|
| `botName` | string | `IP` | MDX bot label |
| `asset` | string | `IPUSDT` | Trading pair / asset label |

### Signal-bot source metadata
| Field | Type | Example | Notes |
|---|---|---:|---|
| `optimizedPeriod` | string | `180 Days` | Source/optimization metadata |
| `exchange` | string | `Bybit` | Signal-bot source metadata |
| `timeframe` | string | `165m` | TradingView timeframe representation |
| `signalSetting` | integer | `4` | TradingView/source-side setting |
| `baseline` | string | `TMA` | Source-side indicator label |
| `baselineValue` | number | `45` | Source-side parameter |
| `slType` | string | `ATR` | Source-side stop-loss type |
| `slValue` | number | `5` | Source-side stop-loss parameter |

### Top-level performance metadata
| Field | Type | Example | Notes |
|---|---|---:|---|
| `performance30d` | percent or null | `19.12` | Store as numeric percent |
| `performance90d` | percent or null | `75.09` | Store as numeric percent |
| `performance180d` | percent or null | `653.34` | Store as numeric percent |
| `performance360d` | percent or null | `null` | `N/A` becomes null |
| `winrate` | percent | `75` | Numeric percent |
| `profitFactor` | number | `3.543` | Decimal metric |

### Per-profile strategy settings
| Field | Type | Example | Notes |
|---|---|---:|---|
| `tpNTargetPercent` | percent | `4.27` | N = 1..6 |
| `tpNAllocationPercent` | percent | `8` | N = 1..6 |
| `stopLossPercent` | percent | `6` | Common across visible profiles |
| `slToBeTrigger` | string enum/reference | `TP1` | Trigger reference, not yet mapped semantically |
| `leverage` | integer | `4` | Profile-specific leverage |
| `tradeCount` | integer | unknown | Visible on profile cards but not captured numerically from screenshot |
| `winrate` | percent | unknown | Profile metric |
| `netProfit` | percent or number | unknown | Profile metric |
| `maxDrawdown` | percent | unknown | Profile metric |
| `avgTradeProfit` | percent or number | unknown | Profile metric |

---

## Source-model recommendation

A first-pass MDX source object should be modeled like this:

```json
{
  "botMeta": {
    "botName": "IP",
    "asset": "IPUSDT"
  },
  "signalBotSourceMeta": {
    "optimizedPeriod": "180 Days",
    "exchange": "Bybit",
    "timeframe": "165m",
    "signalSetting": 4,
    "baseline": "TMA",
    "baselineValue": 45,
    "slType": "ATR",
    "slValue": 5
  },
  "sourcePerformanceMeta": {
    "performance30d": 19.12,
    "performance90d": 75.09,
    "performance180d": 653.34,
    "performance360d": null,
    "winrate": 75,
    "profitFactor": 3.543
  },
  "defaultProfile": "balanced",
  "profiles": {
    "safe": {
      "strategy": {
        "tpTargetsPercent": [3.74, 5.17, 9.14, 13.61, 23.57, 49.0],
        "tpAllocationsPercent": [26, 25, 15, 14, 11, 9],
        "stopLossPercent": 6,
        "slToBeTrigger": "TP1",
        "leverage": 2
      },
      "performanceMeta": {}
    },
    "balanced": {
      "strategy": {
        "tpTargetsPercent": [4.27, 6.98, 9.91, 15.03, 33.21, 53.87],
        "tpAllocationsPercent": [8, 40, 12, 12, 14, 14],
        "stopLossPercent": 6,
        "slToBeTrigger": "TP1",
        "leverage": 4
      },
      "performanceMeta": {}
    },
    "aggressive": {
      "strategy": {
        "tpTargetsPercent": [4.51, 7.67, 10.34, 15.6, 35.4, 57.35],
        "tpAllocationsPercent": [8, 27, 16, 15, 24, 10],
        "stopLossPercent": 6,
        "slToBeTrigger": "TP1",
        "leverage": 6
      },
      "performanceMeta": {}
    }
  }
}
```

### Why this shape is useful

- it preserves raw source semantics
- it separates source metadata from runtime-usable strategy settings
- it keeps profiles explicit and comparable
- it leaves D2 free to define mapping rules cleanly

---

## D1 decisions captured

### 1. Balanced is the default profile
This should be recorded explicitly as:

- `defaultProfile = balanced`

### 2. Top-half settings should be recorded but not assumed to be runtime settings
These should be treated as:

- signal-bot source metadata

not direct S2 execution settings unless later mapping work proves otherwise.

### 3. Safe / Balanced / Aggressive values should all be stored
This avoids future remapping churn and makes profile comparison possible later.

### 4. Performance / optimization metadata should be stored but separated
This preserves useful source information without confusing it with runtime strategy config.

### 5. Runtime mapping is deferred to later D-family sprints
D1 records the source model only.

- D2 will define mapping semantics
- D3 will implement resolver logic
- D4 will add validation and safety guards

---

## What D1 does not conclude yet

D1 does **not** yet decide:

- which top-half TradingView settings should influence S2 runtime directly
- how `SL to BE = TP1` should map into S2 logic exactly
- how the TP ladder should map into the current S2 TP implementation
- how profile performance metrics should influence runtime decisions
- whether profile performance metadata should become part of dashboards or operator tooling

Those decisions belong to later sprints.

---

## Recommended next step

Proceed to **Sprint D2 - MDX-to-S2 Mapping Schema** with the following explicit distinction:

- source metadata
- runtime-usable settings
- profile analytics metadata

That distinction is the key lesson from this first MDX source capture.
