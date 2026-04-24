# S2 Full Bot and Trade Review Pack — 2026-04-24

## Executive summary

This review pack uses **Bybit mainnet account data** as the primary source of truth for trade history and current bot condition, because the original richer local runtime DB under `/tmp/qs2_review/data/s2.sqlite` appears to have been lost when the `/tmp` runtime disappeared. The current local workspace DB still exists, but it only preserves a tiny March slice plus fresh post-recovery trade-state events from 2026-04-24.

That means:
- **trade history in this pack is primarily exchange-side**
- **bot settings and runtime behaviour analysis is repo/config/code-side**
- **local DB-backed internal decision logging is incomplete for the lost April runtime window**

Even with that caveat, the current picture is strong enough for a meaningful full review.

## Top-line bot condition

### Bots with clear live exchange-side trading evidence
- **Bot1 / STXUSDT**
- **Bot2 / NEARUSDT**
- **Bot3 / PAXGUSDT**
- **Bot5 / WIFUSDT**
- **Bot6 / IPUSDT**
- **Bot8 / PUMPFUNUSDT**

### Bots with no visible exchange-side trading evidence in returned Bybit history
- **Bot4 / CRVUSDT**
- **Bot7 / FLOKIUSDT**

### Important operational note
Bot7 remains the main structural anomaly. Earlier investigation already showed `FLOKIUSDT` was invalid on Bybit demo/testnet. Its Bybit mainnet account currently also shows no trade history in the returned execution / closed-PnL window and a flat 50 USDT balance.

---

# 1. How S2 works

## 1.1 High-level flow

S2 is not a plain alert-forwarder. It is a bot-aware execution system that takes compact TradingView-style signal strings and then applies bot-specific routing, settings resolution, risk evaluation, execution, and trade management.

The broad path is:
1. TradingView sends a raw signal like `ENTER_LONG_Bot2`
2. S2 webhook receives it
3. parser extracts:
   - signal type
   - bot id
4. bot registry resolves:
   - symbol
   - credentials
   - MDX source/profile
   - enabled state
   - DCA policy
5. effective bot settings are resolved from:
   - shared base config
   - bot mapping
   - MDX-derived TP / SL / BE / leverage profile values
6. risk/actionability evaluation decides whether the signal should execute
7. if actionable, S2 places live Bybit orders
8. management loop handles:
   - opposite-signal reversal
   - staged entry / DCA
   - TP ladder exits
   - stop-loss
   - break-even
9. persistence and dashboard/mobile surfaces expose the outcome

## 1.2 What makes S2 different from standard MDX / WunderTrading use

The core idea is that S2 is an **operator-controlled execution layer**, not just a signal relay.

### Standard MDX / WunderTrading style
Typical platform flow is closer to:
- signal arrives
- platform forwards it into a preconfigured bot/account
- TP/SL/BE behaviour is largely whatever the platform or source-side setup supports
- limited bot-specific internal auditability
- limited ability to separate observability from execution
- weaker control over nuanced execution rules

### S2 differences
S2 introduced several important layers:

#### A. Bot-aware routing
Each bot has its own:
- symbol
- credential mapping
- MDX source/profile
- execution enablement
- DCA policy

This avoids a blended or ambiguous execution path.

#### B. MDX-derived runtime settings instead of a blunt shared config
One of the most important changes was moving execution logic toward **resolved per-bot settings** rather than letting all bots inherit the same shared TP/SL/BE assumptions.

That matters because otherwise:
- entries might route correctly by bot
- but management could still use the wrong TP / SL / BE rules

That mismatch was explicitly fixed during the project.

#### C. Accept/log all signals, execute selectively
S2 intentionally separated:
- **signal acceptance/logging**
- **execution permission**

So a bot can stay observable even when paused for live trading.

This is very useful for review and staged rollout.

#### D. App-managed lifecycle control
S2 owns important lifecycle decisions directly:
- opposite-signal close-first reversal logic
- app-managed TP ladder execution
- app-managed break-even
- staged-entry / DCA decisions
- execution-integrity / idempotency layer

This gives more nuance than a simple signal relay.

#### E. Selective DCA, not global DCA
A major project conclusion was that DCA should not be globally enabled.

Instead:
- **Bot2 / NEAR** keeps DCA enabled
- all others default OFF unless explicitly enabled

This is more disciplined and avoids blindly applying DCA where it hurts outcomes.

#### F. Execution integrity safeguards
Sprint 11 added a lightweight but important integrity layer:
- TP duplicate/re-fire protection
- break-even per-trade action keys
- minimal trade-state persistence
- cleaner audit trail for DCA decisions

This directly improves trustworthiness of lifecycle behaviour.

#### G. Better operator observability
S2 added a mobile/dashboard status layer showing things like:
- all bots
- enabled state
- balances
- open position state
- recent signals / orders / failures
- uPnL

This is a huge operational improvement over a black-box relay.

---

# 2. Why S2 can be more profitable / more useful than standard MDX/WunderTrading

The important claim is not that S2 magically changes alpha. The edge comes from **execution quality, control, and lifecycle handling**.

## 2.1 Where the improvement comes from

### 1. Better alignment between strategy source and execution behaviour
The MDX signal source may be good, but poor execution logic can leak edge.

S2 improves this by:
- preserving per-bot settings
- keeping TP / SL / BE bot-specific
- avoiding single shared management thresholds across all bots

### 2. Selective DCA rather than universal DCA
Earlier review work concluded:
- DCA should not be on for everyone
- Bot2 / NEAR was the strongest keep-DCA candidate

That means S2 is trying to use DCA only where it helps instead of treating it as universally beneficial.

### 3. Controlled staged entry
S2’s staged-entry logic can split entry exposure instead of always entering the full position immediately.

That improves flexibility around:
- impulse behaviour
- confirmation delay
- add-block conditions
- break-even interaction

### 4. Close-first reversal logic
When an opposite signal arrives, S2 can:
- close the current opposite live position first
- only proceed if that succeeds
- abort the new entry if close fails

That is safer and cleaner than sloppy flip behaviour.

### 5. App-managed TP / SL / break-even
Instead of relying only on an external platform’s generic handling, S2 manages:
- TP ladder triggers
- stop-loss trigger evaluation
- break-even arming and close logic

This created room for both fixes and improvements.

### 6. Execution integrity fixes prevent silent PnL leakage
Repeated TP re-fire, stale BE state reuse, or wrong shared settings can all quietly damage results. S2 explicitly addressed several of these bugs.

### 7. Better ability to pause live execution while keeping observability
That lets you validate signal quality and regime behaviour without blindly trading everything.

So profitability improvement is really a combination of:
- better execution discipline
- fewer lifecycle mistakes
- more selective feature use
- stronger observability and operator control

---

# 3. Current bot registry and effective trading setup

## Global shared baseline
The current repo-resolved shared baseline still says:
- environment.mode: `testnet`
- exchange: `bybit`
- marketType: `usdt_perpetual`
- position sizing mode: `account_percent`
- default `accountPercent`: `10`
- `allowedSymbols` contains all eight bot symbols

There is an important nuance:
- the repo settings object still validates into a `safeMode` warning because placeholder validation logic remains conservative
- but real exchange-side bot activity proves execution has in fact been occurring on mainnet accounts

So operationally, the actual live trade review should trust:
- **Bybit account evidence**
more than
- the symbolic `environment.mode` string in the repo file

## Per-bot DCA policy
- Bot1: OFF
- Bot2: ON
- Bot3: OFF
- Bot4: OFF
- Bot5: OFF
- Bot6: OFF
- Bot7: OFF
- Bot8: OFF

This is one of the most important strategic rules in current S2.

---

# 4. Bot-by-bot review

## Bot1 — STXUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **54.36007428**
- equity: **55.46787428**
- cumulative realized PnL: **4.36007428**
- current open position: **long**
  - size: **191**
  - avg price: **0.2238**
  - unrealized PnL: **+1.1078**

### Resolved S2 trading settings
- leverage: **5**
- account percent: **10**
- stop loss: **5%**
- break-even trigger: **2.15%** (`TP2`-based)
- TP ladder:
  - TP1: 0.85% / 8%
  - TP2: 2.15% / 21%
  - TP3: 3.84% / 23%
  - TP4: 6.48% / 24%
  - TP5: 9.50% / 11%
  - TP6: 18.01% / 13%

### Trade evidence
Recent closed PnL rows show realized STX partial exits and prior completed trade cycles.
Returned recent execution history contains both:
- market trade fills
- funding entries

### Assessment
Bot1 is clearly active and healthy from an exchange-side perspective. It appears to be one of the strongest operationally verified S2 bots.

---

## Bot2 — NEARUSDT

### Current condition
- enabled: **true**
- profile: **aggressive**
- DCA: **ON**
- wallet balance: **29.28990442**
- equity: **27.94582442**
- cumulative realized PnL: **-20.71009558**
- current open position: **short**
  - size: **42.4**
  - avg price: **1.3812**
  - unrealized PnL: **-1.34408**

### Resolved S2 trading settings
- leverage: **6**
- account percent: **10**
- stop loss: **6%**
- break-even trigger: **4.87%** (`TP1`-based)
- TP ladder:
  - TP1: 4.87% / 8%
  - TP2: 5.44% / 28%
  - TP3: 7.18% / 11%
  - TP4: 10.96% / 23%
  - TP5: 16.23% / 20%
  - TP6: 24.03% / 10%

### Trade evidence
- open short exists now
- one closed PnL row in recent returned history
- execution history includes trade fills consistent with entry / close-first / DCA flow

### Assessment
Bot2 is active but currently the weakest-looking financially in this snapshot. This is still the only bot with DCA enabled, which is operationally intentional. That makes Bot2 especially important in any later DCA-specific performance review.

---

## Bot3 — PAXGUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **50.12065176**
- equity: **49.38215176**
- cumulative realized PnL: **0.12065176**
- current open position: **long**
  - size: **0.01**
  - avg price: **4787.1**
  - unrealized PnL: **-0.7385**

### Resolved S2 trading settings
- leverage: **8**
- account percent: **10**
- stop loss: **3%**
- break-even trigger: **1.73%** (`TP3`-based)
- TP ladder:
  - TP1: 0.37% / 8%
  - TP2: 0.91% / 21%
  - TP3: 1.73% / 21%
  - TP4: 3.09% / 21%
  - TP5: 4.78% / 13%
  - TP6: 9.60% / 16%

### Trade evidence
- recent closed PnL rows exist
- execution history is substantial
- current open long exists

### Assessment
Bot3 is genuinely active. It is a good example of why local-DB-only review would have been misleading after the runtime loss.

---

## Bot4 — CRVUSDT

### Current condition
- enabled: **false**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **49.54544108**
- equity: **49.54544108**
- cumulative realized PnL: **-0.45455892**
- open position: **none**
- returned recent exchange execution history: **none**

### Resolved S2 trading settings
- leverage: **5**
- account percent: **10**
- stop loss: **6%**
- break-even trigger: **3.24%** (`TP1`-based)
- TP ladder starts at 3.24%

### Assessment
Bot4 is currently paused in S2 and there is no meaningful recent Bybit activity in the returned history window. Historically it was important in validation, but in the current snapshot it is inactive.

---

## Bot5 — WIFUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **51.37541871**
- equity: **53.85785871**
- cumulative realized PnL: **1.37541871**
- current open position: **short**
  - size: **137**
  - avg price: **0.19862**
  - unrealized PnL: **+2.48244**

### Resolved S2 trading settings
- leverage: **4**
- account percent: **10**
- stop loss: **2%**
- break-even trigger: **9.26%** (`TP3`-based)
- TP ladder:
  - TP1: 1.97% / 8%
  - TP2: 5.67% / 27%
  - TP3: 9.26% / 25%
  - TP4: 12.32% / 24%
  - TP5: 16.91% / 8%
  - TP6: 26.92% / 8%

### Trade evidence
- multiple recent partial close closed-PnL rows
- active open short still running
- rich recent execution history

### Assessment
Bot5 is healthy and meaningfully active. Earlier local-DB gaps had made Bot5 look ambiguous, but Bybit-side data shows clear live trading.

---

## Bot6 — IPUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **51.39881626**
- equity: **54.68393626**
- cumulative realized PnL: **1.39881626**
- current open position: **short**
  - size: **70.8**
  - avg price: **0.5694**
  - unrealized PnL: **+3.28512**

### Resolved S2 trading settings
- leverage: **3**
- account percent: **10**
- stop loss: **3%**
- break-even trigger: **3.43%** (`TP1`-based)
- TP ladder:
  - TP1: 3.43% / 8%
  - TP2: 5.26% / 21%
  - TP3: 9.33% / 21%
  - TP4: 14.57% / 21%
  - TP5: 31.29% / 13%
  - TP6: 52.88% / 16%

### Trade evidence
- open short in profit
- recent closed PnL exists
- extensive execution history returned

### Assessment
Bot6 is clearly live and doing well in the current snapshot.

---

## Bot7 — FLOKIUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **50**
- equity: **50**
- cumulative realized PnL: **0**
- open position: **none**
- returned recent executions: **none**
- returned recent closed PnL: **none**

### Resolved S2 trading settings
- leverage: **3**
- account percent: **10**
- stop loss: **5%**
- break-even trigger: **6.29%** (`TP2`-based)
- TP ladder starts at 3.03%

### Assessment
Bot7 remains the cleanest example of a structurally non-performing bot in live execution terms.

Earlier investigation strongly suggested the symbol mapping was problematic for Bybit environments. In current review terms:
- account still looks untouched
- no exchange-side trade evidence was returned
- balance remains exactly flat

This bot should be treated as needing explicit symbol / venue compatibility review before relying on it.

---

## Bot8 — PUMPFUNUSDT

### Current condition
- enabled: **true**
- profile: **balanced**
- DCA: **OFF**
- wallet balance: **51.91003575**
- equity: **54.10067575**
- cumulative realized PnL: **1.91003575**
- current open position: **short**
  - size: **19700**
  - avg price: **0.0018957**
  - unrealized PnL: **+2.19064**

### Resolved S2 trading settings
- leverage: **3**
- account percent: **10**
- stop loss: **5%**
- break-even trigger: **2.22%** (`TP1`-based)
- TP ladder:
  - TP1: 2.22% / 8%
  - TP2: 5.45% / 27%
  - TP3: 8.53% / 25%
  - TP4: 12.70% / 24%
  - TP5: 19.67% / 8%
  - TP6: 29.49% / 8%

### Trade evidence
- clear open short
- recent partial close closed-PnL row
- extensive returned execution history

### Assessment
Bot8 is clearly live and healthy. Earlier uncertainty about whether Bot8 was actually trading has been resolved by exchange-side data.

---

# 5. Trade history review

## 5.1 What the exchange-side trade log can show well
Bybit history gives us strong visibility into:
- actual market trade fills
- partial closes
- open position size and direction
- realized closed PnL snapshots
- current wallet / equity state

## 5.2 What the exchange-side log cannot fully restore
Because the richer local runtime DB was lost, we do not have a complete internal ledger of:
- every normalized signal
- every non-executed signal
- internal skip reasons
- full local DCA decision annotations for the lost window

So the trade log in this pack should be treated as:
- **exchange-executed truth**
not
- **full internal signal-and-decision truth**

## 5.3 Clear current open trades
At review time, open Bybit positions exist for:
- Bot1: long `STXUSDT`
- Bot2: short `NEARUSDT`
- Bot3: long `PAXGUSDT`
- Bot5: short `WIFUSDT`
- Bot6: short `IPUSDT`
- Bot8: short `PUMPFUNUSDT`

Flat bots:
- Bot4
n- Bot7

## 5.4 Full trade-history artifacts generated for this review
Supporting raw files created in `Q_S2/summaries/`:
- `bybit-review-data-2026-04-24.json`
- `resolved-bot-settings-2026-04-24.json`
- `local-db-snapshot-2026-04-24.json`

These should be preserved alongside this markdown review.

---

# 6. Important technical / operational findings

## 6.1 The local repo config still says `environment.mode = testnet`
But the API keys used for current live review are clearly valid on **Bybit mainnet**, not Bybit demo.

This means operational truth has drifted from the simple repo label.

That should be cleaned up later so future review does not depend on rediscovery.

## 6.2 `/tmp` as runtime source-of-truth was dangerous
This outage/recovery proved that using `/tmp/qs2_review` as the authoritative runtime path was a serious durability risk.

The system kept important live state there, including the runtime DB.
When `/tmp` vanished, the historical local ledger effectively vanished with it.

## 6.3 Bot7 remains unresolved
Bot7 still appears non-executing in practical terms.
This is the clearest remaining per-bot issue from a bot-condition perspective.

## 6.4 Bot2 is strategically important because it is the only DCA-enabled bot
Any future profitability / risk review around DCA should focus heavily on Bot2, because current selective-DCA policy makes it the sole live DCA case.

---

# 7. Recommendations

## Immediate recommendations
1. **Stop relying on `/tmp` for durable runtime state**
2. **Add scheduled DB backups / review exports to persistent storage**
3. **Clean up environment truth** so mainnet/testnet labels match reality
4. **Review Bot7 symbol / venue compatibility explicitly**
5. **Preserve this review pack plus raw JSON inputs in git or durable storage**

## Review/process recommendations
1. Generate a recurring daily or twice-daily review export with:
   - balances
   - open positions
   - recent closed PnL
   - recent executions
   - bot config snapshot
2. Add persistent archival of:
   - sqlite DB
   - review JSON outputs
   - service-level runtime metadata
3. Make Bybit-side extraction part of standard ops review, not a recovery-only step

---

# 8. Final assessment

S2 has clearly matured beyond a simple signal-forwarding bot wrapper.
Its most important strengths are:
- per-bot execution control
- bot-resolved MDX settings
- selective DCA policy
- app-managed lifecycle control
- execution integrity safeguards
- much better observability than a standard MDX/WunderTrading setup

From the current Bybit-backed live review, the strongest practical conclusion is:
- **S2 is genuinely trading across multiple bots**
- **Bot1, Bot3, Bot5, Bot6, and Bot8 currently look healthy**
- **Bot2 is live but financially weak in this snapshot and deserves DCA-focused scrutiny**
- **Bot4 is intentionally inactive**
- **Bot7 remains the main non-performing structural outlier**

This pack is the best currently reconstructable full review after the local runtime DB loss.
