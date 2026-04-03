# Sprint F3F Step Recap - S2 Signal Export Helper

_Last updated: 2026-04-03 UTC._

## Objective

Create the smallest useful helper script for the counterfactual DCA-vs-no-DCA review so recent S2 signals can be exported cleanly for external analysis without heavy manual DB wrangling.

## What was added

Added:

- `scripts/export-s2-signals-for-review.js`

## What it does

The script exports recent S2 signals from `normalized_signals` and enriches them using the bot registry.

It includes fields such as:

- `received_at`
- `bot_id`
- `symbol`
- `enabled`
- `mdxProfile`
- `signal`
- `direction`
- `eventType`
- `raw_input`

## Supported options

The script supports lightweight filtering, including:

- `--db`
- `--registry`
- `--since`
- `--enabled-only`
- `--out`

## Validation

Validation against the live S2 runtime DB confirmed:

- the helper exported a clean JSON dataset
- the dataset contained recent signals from enabled bots
- bot-to-symbol mapping was correctly attached
- direction / event-type derived fields were present

## Interpretation

This is the intended minimum automation for F3F.

It does not perform the actual DCA-vs-no-DCA comparison yet, but it creates a trustworthy signal dataset so the counterfactual analysis can proceed cleanly in external tooling or follow-up scripts.
