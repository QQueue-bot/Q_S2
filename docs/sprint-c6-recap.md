# Sprint C6 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint C6 executed the first true live routed Bot1 proof using Bot1's own mapped credential pair, while also validating per-bot enable/disable enforcement in the active execution path.

## What was delivered

### Live credential routing

Updated:

- `config/bots.json`
- `src/config/resolveBotCredentials.js`
- `src/config/resolveBotContext.js`
- `src/webhook/createServer.js`
- `src/execution/bybitExecution.js`
- `src/signals/parseSignal.js`

Changes:

- Bot1 now references its true live credential env vars:
  - `S2_BOT1_API_KEY`
  - `S2_BOT1_API_SECRET`
- credential resolution now reads from `~/.openclaw/.env`
- active execution path now uses resolved live bot credentials instead of shared default credentials
- active execution path now uses live Bybit endpoint routing for Bot1 proof flows

### Operator control enforcement

Validated and fixed:

- disabled bots are excluded from allowed bot admission
- disabled bots fail context resolution cleanly
- disabled bots are rejected at signal admission cleanly

### Live routed proof

Preflight passed for Bot1 on live Bybit:

- wallet auth OK
- position endpoint OK
- instrument endpoint OK

Initial live order attempt proved routing but failed due to live-account balance constraints:

- `retCode: 110007`
- `retMsg: ab not enough for new order`

A temporary runtime sizing reduction was then applied for the C6 proof:

- runtime `accountPercent` reduced to `5`

Retried live routed execution then succeeded:

- `retCode: 0`
- `retMsg: OK`
- order submitted in the intended live Bot1 subaccount
- Bybit portal confirmation verified the order appeared in the correct account

Successful order details:

- symbol: `BTCUSDT`
- side: `Buy`
- qty: `0.002`
- notionalUsd: `723.203`
- orderId: `6300b224-cfe4-43aa-a056-6745b260dad0`

## Validation

Added / used:

- `scripts/test-bot1-mapped-auth.js`
- `scripts/test-bot-enable-disable.js`
- `scripts/test-live-bot1-routed-execution.js`
- `docs/sprint-c6-progress-note.md`

Validation confirmed:

- Bot1 credential refs resolve successfully
- Bot1 authenticates successfully against live Bybit
- Bot1 is blocked cleanly when disabled
- Bot1 can be re-enabled and route correctly
- active execution uses mapped live credentials
- routed live execution succeeds in the intended live account
- portal verification confirmed the correct subaccount received the order

## Interpretation

Sprint C6 is complete for the agreed live Bot1 routing proof scope.

This is the first confirmed end-to-end proof that S2 can:

- resolve bot identity
- resolve bot settings
- resolve bot credentials
- enforce per-bot operator control
- route execution into the intended live account

That materially de-risks later expansion to broader multi-bot account routing.

## Important note

The C6 proof used a temporary runtime sizing reduction (`accountPercent = 5`) to fit the live Bot1 balance while staying above exchange minimum order thresholds. This was a controlled proof-setting adjustment, not a milestone-wide final sizing policy.

## Non-goals respected

Sprint C6 did not attempt to add:

- 8-bot rollout
- simultaneous multi-bot live routing
- broader mainnet activation beyond Bot1 proof
