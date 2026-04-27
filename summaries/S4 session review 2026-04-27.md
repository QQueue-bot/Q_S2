# S4 Session Review — 2026-04-27

**Prepared for:** CC S4 review  
**Session scope:** Analysis, backtest expansion, and tooling improvements on the S4 EMA pump-short system  
**No live execution changes were made.**

---

## 1. Scenario Tracking Page — Built and Deployed

A new web page (`s4_scenarios.html`, served at port 8080) tracks all parameter experiments.

**What was built:**
- `scenarios.json` — canonical store of all scenario definitions, results, and explanations
- `generate_scenarios_page.py` — generates the HTML page; hooked into `s4_live.py` so it rebuilds on every pump/trade event
- Navigation button added to main `s4_live_review.html` header ("Scenarios →")

**Page layout:**
1. Summary comparison table (quick at-a-glance, click ID to jump to card)
2. Scenario cards — each shows status badge, result pills, and a full plain-English explanation of the logic and findings
3. EMA gate analysis section (crossover stats + per-pump timing table)

---

## 2. EMA Gate Analysis — Key Finding

Investigated whether the `ema4_declining` gate in the crossover condition adds latency.

**Finding: gate delay = 0 candles on all 35 pumps analysed.**

When EMA(2) first crosses below EMA(4) after a pump, EMA(4) is already declining on that same candle — making the third crossover condition redundant in practice. The gate is harmless but adds zero selectivity.

**Root cause of late entries:** Not the gate. It is the continuation pump pattern (Category B) — price keeps rising for 2–5 candles after detection before reversing, pushing both EMAs upward and delaying crossover until the move is largely exhausted.

---

## 3. Trade #13 NOTUSDT Deep-Dive

Full timeline reconstructed:

| Time | Event |
|------|-------|
| 05:55 UTC | Pump detected (+10.9%) |
| 05:56–05:59 | Continuation pump — price adds +24% above detection level |
| 06:00 | Price begins reverting, EMA2 ≈ EMA4 (visual convergence) |
| 06:01 | Genuine EMA(2)/EMA(4) crossover fires |
| 06:02 | Entry at 0.0004862 (162ms from crossover log to OPEN) |
| ~06:03 | Post-entry bounce hits SL (2.5% above entry) → $25 loss |

Code introduced zero delay — the 162ms is network + order execution, not algorithmic lag. The late entry was caused entirely by the 4-candle continuation pump, not the gate.

A precision canvas chart was built and is accessible at `http://16.192.15.119:8080/trade13_detail.html`.

---

## 4. New Scenarios Added (V, W, W2, VW, VS)

Computed on all 9 historically traded pumps ($1000 stake, all-in short):

| Scenario | Description | PnL | WR |
|----------|-------------|-----|----|
| V | Skip entry if price > pump_close at post[2] (continuation guard) | +$5 | 60% (5 trades) |
| W | 2% TP — captures near-guaranteed post-entry volatility dip | **+$135** | **89%** |
| W2 | 2.5% TP (1:1 R:R) | +$125 | 78% |
| VW | V filter + 2% TP | +$95 | 100% (5 trades) |
| VS | V filter + EMA13 exit + SL 3% | +$120 | 75% (4 trades) |

Key insight on W (2% TP): after almost any EMA-crossover entry on a pump pattern, price almost always has a dip of ≥2% within 3 candles. Only exception in historical data: BSBUSDT (immediate reversal, no dip at all).

---

## 5. EMA Parameter Comparison — Major Finding

**Question:** Could faster EMA parameters trigger entry sooner and improve results?

Tested three methods across all 36 pumps with post-candle data:

| Method | Description | Fires vs current | False triggers |
|--------|-------------|-----------------|----------------|
| Current | EMA(2)/EMA(4) | baseline | 0 |
| Slope B | EMA2 slope peak | mean −2.1c earlier | 0 — but erratic |
| **EMA(2)/EMA(3)** | Tighter slow EMA | mean −1.3c earlier | **0** |

**EMA slope was discarded:** fires on momentary EMA2 pauses mid-continuation-pump. Caused LABUSDT to flip from TP → SL (entered too early, price continued up and hit SL before reversing).

**EMA(2)/EMA(3) results on 9 traded pumps:**

| Config | PnL | WR | vs Baseline |
|--------|-----|----|-------------|
| Current EMA(2)/EMA(4) SL 2.5% | $0 | 33% | — |
| EMA(2)/EMA(3) SL 2.5% (scenario X) | +$150 | 56% | +$150 |
| **EMA(2)/EMA(3) SL 3% (scenario X3)** | **+$210** | **67%** | **+$210** |

**Key trade conversions:**
- **NOTUSDT #13** — 1c earlier entry at 0.000551 vs 0.0004862. SL at 0.000565 — post-entry bounce never reached it. Loss → TP win.
- **OLUSDT #7** — Same: 1c earlier, different entry price, SL not reached. Loss → TP win.
- **AIOZUSDT #2** — EMA2/3 fires same candle as current (no help). Adding SL 3% gives enough room for recovery. Loss → TP win.

The improvements stack cleanly because they target different failure modes:
- EMA(2)/EMA(3): fixes late-entry on continuation pump reversals
- SL 3%: fixes tight-stop-outs on borderline entries with short-term volatility

Remaining 3 losses (BSBUSDT, HIGHUSDT, PRLUSDT): no clean fix — immediate moves against position with no recovery.

---

## 6. Current Scenario Leaderboard

| Rank | ID | Description | PnL | WR |
|------|----|-------------|-----|----|
| 1 | X3 | EMA(2)/EMA(3) + SL 3% | **+$210** | **67%** |
| 2 | X | EMA(2)/EMA(3) + SL 2.5% | +$150 | 56% |
| 3 | W | 2% TP (all trades, no filter) | +$135 | 89% |
| 4 | W2 | 2.5% TP | +$125 | 78% |
| 5 | VS | V filter + EMA13 exit + SL 3% | +$120 | 75% (4 trades) |
| 6 | S | EMA13 exit + SL 3% | +$63 | 44% |
| 7 | Current (live) | EMA(2)/EMA(4) SL 2.5% | $0 | 33% |

---

## 7. Recommended Next Steps for CC S4

1. **Shadow test X3** (`EMA(2)/EMA(3)`, SL 3%): Log the would-have-been entry candle and price on every live pump. Compare against actual live entries for 2–4 weeks to validate the backtest holds on unseen data. No live execution change.

2. **Validate W (2% TP)** on next 5–10 live pumps in shadow: track whether the 2% dip is consistently available. BSBUSDT is the known failure mode — if failure rate stays <15%, W has strong R:R justification (89% WR > 56% required breakeven).

3. **Consider X3 + W combination**: EMA(2)/EMA(3) for entry timing, 2% TP for fast profit capture. Not yet backtested — would be scenario Y.

4. **Do not change live EMAs yet.** All changes above are shadow-mode candidates only. The live system uses EMA(2)/EMA(4) with SL 2.5% — this must remain unchanged until shadow validation on live data is complete.

---

## 8. Files Changed This Session

All changes on EC2 (`/home/ubuntu/s4_ema_live/`):

| File | Change |
|------|--------|
| `scenarios.json` | Added explanation fields to all A–U scenarios; added V, W, W2, VW, VS, X, X3 (28 total) |
| `generate_scenarios_page.py` | Full redesign — scenario cards with explanations, summary table, nav shortcuts |
| `s4_live.py` | Added "Scenarios →" nav button in header |

EC2 web (`/home/ubuntu/s4_2/`):
| File | Change |
|------|--------|
| `s4_scenarios.html` | Rebuilt (auto-generated) |
| `trade13_detail.html` | Precision canvas chart for NOTUSDT #13 (built in prior session) |

Analysis scripts run (not deployed):
- `/tmp/ema_compare.py` — full 3-method comparison across 36 pumps
- `/tmp/ema23_sl3.py` — X vs X3 SL comparison on traded pumps
