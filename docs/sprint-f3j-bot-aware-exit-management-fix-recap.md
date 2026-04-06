# Sprint F3J - Bot-Aware Exit Management Fix

## Problem

Bot4 / `CRVUSDT` entered correctly using bot-resolved MDX settings, but its live TP/BE management did not use those same resolved settings.

This created a critical runtime inconsistency:

- entry path used bot-aware MDX settings
- ongoing TP/SL/BE management still read the shared runtime `config/settings.json`

For Bot4, that meant the live management loop used the shared demo validation profile instead of the intended CRV MDX profile.

## What was observed

Bot4 should have been operating under its balanced MDX profile:

- TP1 = `3.24%`
- TP1 close = `7%`
- break-even trigger = `TP1`
- stop loss = `6%`

But the live shared runtime file was still configured as:

- TP1 = `0.4%`
- TP1 close = `50%`
- TP2 = `0.8%`
- break-even = `0.3%`

As a result, Bot4 hit the shared TP/BE thresholds and was partially closed repeatedly even though its MDX-defined TP1 should not yet have been reached.

## Root cause

`startTradeManagementLoop()` passed a shared `settingsPath` into:

- `manageTpSl()`
- `manageBreakEven()`

And those management functions loaded the shared settings file directly instead of resolving per-bot settings through the existing MDX-aware bot settings path.

So the earlier F3E fix brought bot-aware parity to entry/risk evaluation, but exit management still lagged behind.

## Fix

Updated TP/SL/BE management to resolve bot-aware settings with `resolveBotSettings(botId)` before evaluating live position management.

This restores parity between:

- bot-aware entry execution
- bot-aware TP/SL management
- bot-aware break-even management

## Expected result

For active MDX-driven bots such as Bot4:

- TP triggers should now match the bot’s MDX profile
- close percentages should now match the bot’s MDX profile
- break-even should arm at the correct mapped trigger
- shared demo validation values in `config/settings.json` should no longer incorrectly drive live bot exit management

## Remaining note

This fix addresses the major configuration-source mismatch.

A separate smaller cleanup issue may still remain around repeated tiny TP exits / near-zero quantity handling, but that is distinct from the much larger bug fixed here.
