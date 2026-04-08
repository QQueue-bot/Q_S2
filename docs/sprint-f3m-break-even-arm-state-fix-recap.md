# Sprint F3M - Break-Even Arm State Fix

## Problem

Bot4 / `CRVUSDT` was closing at break-even almost immediately after fresh entry even though the corrected MDX-derived break-even trigger value (`3.24`) was now in use.

Observed pattern:
- fresh entry submitted
- break-even close fired seconds later
- mark price equal to entry price
- no plausible new trade path had actually earned a valid break-even arm first

## Root cause

Break-even armed state was being checked only at the symbol level:

- any historical `armed` event for the symbol could satisfy the current trade's `armed` condition
- a new trade on the same symbol could therefore inherit stale break-even state from an older trade
- if price was at/near entry, the runtime could immediately treat the new position as returned-to-entry and close it

## Fix

Updated break-even armed-state resolution so it is scoped to the current live position lifecycle:

- when Bybit provides `livePosition.createdTime`, only `armed` events at or after that position entry time count for the current trade
- stale armed events from older trades on the same symbol no longer arm a fresh position by accident

## Expected result

A fresh Bot4 trade should no longer close immediately at break-even solely because a previous CRV trade had once armed break-even.

## Scope note

Current live evidence showed this on Bot4, but the underlying logic was generic. This fix therefore protects any bot from inheriting stale symbol-level break-even arm state across trade lifecycles.
