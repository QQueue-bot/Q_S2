# Sprint F3L - Accept All Bot Signals, Separate Execution Gate

## Goal

Decouple S2 signal acceptance/logging from execution permission so all configured bot signals can be observed even when only a subset is allowed to trade.

## Problem before fix

Webhook parsing used the enabled-bot set as the allowed-bot set.

That meant disabled bots were rejected too early with parse errors such as:

- `Bot is not allowed: Bot5`
- `Bot is not allowed: Bot7`

This blocked observability because signals for configured bots outside the current active trading subset never reached normalized signal persistence.

## Change

### 1. Parsing/logging allowlist

`resolveBotContext()` now exposes:

- `allowedBots` = all bots configured in `config/bots.json`
- `executionEnabledBots` = only bots with `enabled: true`

### 2. Execution gating

Risk evaluation now treats execution enablement as a separate control:

- configured bot signals can parse and persist
- execution is blocked if the bot is not in `executionEnabledBots`

## Result

S2 now supports the desired model:

- accept and log signals for all configured bots
- keep trading permission as a separate gate

This improves observability and review quality without forcing all bots to execute live trades.
