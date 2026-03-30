# Milestone G - Mobile Bot Status View Roadmap

_Last updated: 2026-03-30 UTC._

## Purpose

Milestone G adds a lightweight mobile-first operational view so the bot fleet can be checked quickly from an iPhone without reading the heavier dashboard.

The goal is not to replace the full dashboard. The goal is to provide a compact glance view that answers:

- how many bots exist
- which bots are enabled
- which bots are currently in trades
- what side those trades are on
- what the subaccount balances are per bot

This milestone should stay UI-light and operator-focused.

---

## Milestone G objective

Add a simple mobile-first HTML page that gives a clear at-a-glance picture of:

- bot enabled/disabled state
- live trade state
- per-bot subaccount balance

without requiring the operator to dig through data-heavy views.

---

## Sprint family

### Sprint G1 - Mobile Bot Status Overview
**Objective**
Create the first mobile-first status page for quick operator checks.

**Work**
- create a new lightweight page or route
- make the layout fit cleanly on an iPhone screen
- show top-level counts such as total bots, enabled bots, and bots in trade
- show per-bot compact rows/cards with:
  - bot name
  - enabled/disabled state
  - flat/long/short status
  - symbol if useful
  - subaccount balance
- keep the page simple and glanceable

**Output**
- mobile bot status MVP

**Validation**
- page fits on an iPhone-sized screen cleanly
- enabled/disabled state is visible per bot
- in-trade / flat state is visible per bot
- subaccount balance is visible per bot
- operator can tell the basic system state quickly

---

### Sprint G2 - Mobile Status Polish and Attention Signals
**Objective**
Polish the mobile status page so it is more robust and useful in daily operation.

**Work**
- improve spacing, readability, and touch-friendly layout
- improve refresh behavior and status freshness indicators
- add compact attention states / warnings where useful
- handle missing balance or unavailable status gracefully
- improve visual distinction between enabled/disabled and flat/in-trade states

**Output**
- polished mobile status view

**Validation**
- page remains compact and readable on iPhone
- status/balance refresh is understandable
- attention states are visible without creating clutter
- missing/unavailable data does not break the page

---

## Recommended execution order

1. G1 - Mobile Bot Status Overview
2. G2 - Mobile Status Polish and Attention Signals

---

## Success criterion

Milestone G is successful when the operator can open a single simple page on a phone and immediately understand:

- which bots are enabled
- which bots are currently in trades
- the rough balance state of each bot/account

without needing the heavier dashboard for a basic status check.
