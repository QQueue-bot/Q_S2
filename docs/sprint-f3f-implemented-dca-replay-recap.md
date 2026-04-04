# Sprint F3F Recap - Implemented Adaptive DCA Replay

_Last updated: 2026-04-04 UTC._

## Objective

Replay the actual implemented adaptive DCA logic on recent received S2 entry signals using public Bybit candle data, so the DCA-vs-no-DCA comparison is based on the implemented strategy rather than a simplified staged-entry approximation.

## What was added

Added:

- `scripts/analyze-f3f-implemented-dca.js`

## What the replay uses

The replay combines:

- real received S2 entry signals
- bot/symbol mapping from the registry
- public Bybit 15m candles as the post-signal price path
- the implemented S2 DCA decision logic elements currently available for replay:
  - trigger-candle classification
  - impulse-aware 1 vs 2 candle delay
  - staged-entry averaging

## Result summary

Across 7 recent received entry signals:

- DCA better: 4
- Non-DCA better: 2
- Neutral: 1

### By bot

- Bot2 / NEAR: DCA 2, Non-DCA 0, Neutral 0
- Bot1 / IP: DCA 1, Non-DCA 1, Neutral 1
- Bot4 / CRV: DCA 1, Non-DCA 1, Neutral 0

## Interpretation

The implemented-strategy replay still supports DCA overall, but the advantage is not uniform across all bots.

### Strongest support

- Bot2 / NEAR shows the clearest support for DCA

### Mixed / inconclusive

- Bot1 / IP
- Bot4 / CRV

This strengthens the case for **selective bot DCA** rather than assuming global DCA is optimal everywhere.

## Caveat

This is a stronger and more faithful comparison than the earlier simplified staged-entry approximation, but it is still not a full live execution replay. It uses public Bybit candles and simplified path metrics rather than full fill-quality and downstream exit execution replay.
