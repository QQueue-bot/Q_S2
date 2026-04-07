# Sprint F3K - Bot1 STX / Bot6 IP Mapping Correction (Pre-Deploy)

## Intent

Apply the intended operator bot mapping inside the S2 repo without deploying yet.

Confirmed intended mapping:

- Bot1 = STX
- Bot2 = NEAR
- Bot3 = PAXG
- Bot4 = CRV
- Bot5 = WIF
- Bot6 = IP
- Bot7 = FLOKI
- Bot8 = PumpFun

## Problem found

The repo/runtime had drifted to:

- Bot1 = IPUSDT
- Bot6 = IPUSDT

That mismatch was visible in:

- `config/bots.json`
- `mdx/Bot1.source.json`
- dashboard/runtime behaviour
- current live Bot1 IP position provenance

## Repo-side correction applied

### 1. Bot1 MDX source replaced with STX settings

`mdx/Bot1.source.json` now contains the STX source data extracted from the operator-provided settings screenshot:

- asset: `STX`
- exchange: `Bitget`
- timeframe: `95m`
- balanced profile leverage: `5x`
- balanced TP ladder: `0.85, 2.15, 3.84, 6.48, 9.50, 18.01`
- balanced TP allocations: `8, 21, 23, 24, 11, 13`
- stop loss: `5%`
- SL to BE: `TP2`

### 2. Bot1 registry symbol corrected

`config/bots.json`:

- Bot1 symbol changed from `IPUSDT` to `STXUSDT`

### 3. Bot6 remains IP

`mdx/Bot6.source.json` still contains the IP source and Bot6 still maps to `IPUSDT`.

### 4. Shared settings active-set note aligned

`config/settings.json` was updated so the active validation baseline now reflects:

- Bot1 = `STXUSDT`
- Bot2 = `NEARUSDT`
- Bot4 = `CRVUSDT`

## Important live caution

This patch is repo-side only so far.

It has **not** been deployed yet.

That is deliberate because the current live runtime previously opened a Bot1 short on `IPUSDT` under the old, incorrect mapping. A controlled cutover/review is required before syncing `/tmp/qs2_review` and restarting services.

## Next review question before deploy

Confirm the desired live cutover behaviour:

- whether Bot1 should immediately start resolving to `STXUSDT`
- whether the currently open/misrouted IP Bot1 position needs a manual/operator close or separate handling first
- whether Bot6/IP should be explicitly enabled/observed as the replacement IP identity in future runtime validation
