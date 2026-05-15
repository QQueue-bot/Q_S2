# Filter-Twin Replay — Internal Consistency

**Window used:** 2026-03-29T07:15:42.492Z → 2026-05-15T16:30:02.913Z  (signal history starts 2026-03-29; spec said 2026-03-01 or earliest available)
**Bots:** 8  ·  **Total signals:** 129  ·  **Sim:** 1h OHLC, MDX Balanced (SL 6%, TP 3.37/4.76/12.4/14.67/22.4/30.06 %, alloc 0.13/0.18/0.22/0.22/0.17/0.08, BE after TP1), fees taker 0.055%/maker 0.02% + funding 0.0001 /8h

## Per-bot

| bot | sym | signals | V trades | V wins | V P&L $ | V maxDD% | F trades | F wins | F P&L $ | F maxDD% | F skips |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bot1 | DEEPUSDT | 23 | 11 | 7 | 35.55 | -3.2 | 8 | 4 | 22.31 | -3.2 | skip_after_2L:2 skip_wednesday:1 |
| Bot2 | NEARUSDT | 12 | 5 | 3 | 2.17 | -6.2 | 4 | 3 | 8.90 | -4.6 | skip_wednesday:1 |
| Bot3 | PAXGUSDT | 21 | 10 | 4 | 1.27 | -2.8 | 8 | 3 | 0.11 | -1.8 | skip_after_2L:2 |
| Bot4 | ZECUSDT | 12 | 6 | 3 | -0.97 | -11.9 | 5 | 2 | -2.26 | -11.9 | skip_after_2L:1 |
| Bot5 | XLMUSDT | 18 | 9 | 3 | -10.37 | -10.6 | 6 | 2 | -12.46 | -12.7 | skip_wednesday:2 skip_after_2L:1 |
| Bot6 | JUPUSDT | 6 | 3 | 3 | 25.91 | 0.0 | 2 | 2 | 19.35 | 0.0 | skip_wednesday:1 |
| Bot7 | BERAUSDT | 22 | 11 | 1 | -37.54 | -37.7 | 6 | 1 | -19.91 | -20.1 | skip_after_2L:2 skip_wednesday:3 |
| Bot8 | PUMPFUNUSDT | 15 | 5 | 2 | 4.23 | -6.2 | 3 | 1 | 10.71 | -0.2 | skip_after_2L:1 skip_wednesday:1 |

## Portfolio aggregate ($100/bot → $800 baseline)

| path | trades | wins | final $ | profit $ | worst-bot maxDD% | skips |
|---|---|---|---|---|---|---|
| vanilla | 60 | 26 | 820.25 | +20.25 | -37.7 | - |
| filter  | 42 | 18 | 826.74 | +26.74 | -20.1 | skip_after_2L:9 skip_wednesday:9 |

## Verdict

- Filter fewer trades than vanilla: YES (42 vs 60)
- Filter smaller (less negative) portfolio maxDD: YES (-20.1% vs -37.7%)
- Filter net P&L ≥ vanilla: YES (26.74 vs 20.25)
- No nonsensical P&L: YES

## ✅ PASS
