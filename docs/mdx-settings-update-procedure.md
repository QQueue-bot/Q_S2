# MDX Settings Update Procedure

_Last updated: 2026-04-24 UTC._

This document describes the exact steps to perform two types of MDX-driven configuration updates without service interruption:

- **Scenario A:** Swap Bot4's trading symbol (CRVUSDT → new token)
- **Scenario B:** Change Bot2's MDX profile (aggressive → balanced)

Both procedures assume the operator has already obtained the new MDX source data from the TradingView strategy (typically as a screenshot or JSON export).

---

## How MDX Settings Flow Into Execution

Understanding this prevents mistakes:

1. `config/bots.json` — maps each bot to its symbol, credential env vars, MDX source file, and profile name
2. `mdx/BotN.source.json` — the MDX strategy export: performance metadata, and `profiles.balanced/aggressive/safe` blocks with `tpTargetsPercent`, `tpAllocationsPercent`, `stopLossPercent`, `slToBeTrigger`, `leverage`
3. `config/settings.json` → `trading.allowedSymbols` — symbol whitelist enforced by the risk engine; must include the bot's symbol or execution is blocked
4. `src/config/resolveMdxSettings.js` — reads the source file and profile, converts to runtime format (`takeProfit.levels`, `stopLoss.triggerPercent`, `breakEven.triggerPercent`, `positionSizing.leverage`)
5. `src/config/resolveBotSettings.js` — merges the MDX-derived values over the global base settings; `accountPercent` is hardcoded to 10

**What does NOT propagate from MDX:** `trading.allowedSymbols`, `accountPercent`, the `dca` block, S3 scoring config. These come from `config/settings.json` or `config/bots.json` only.

**When do changes take effect:** Config files are read on every request (no in-memory caching for the registry and MDX files). A service restart is not strictly required for most config changes, but one is recommended to ensure a clean state after any structural change.

## Deploy Mechanism (Critical)

The EC2 runtime reads files directly from:
```
/home/ubuntu/.openclaw/workspace/Q_S2/
```

`deploy.sh` does:
```bash
git -C /home/ubuntu/.openclaw/workspace/Q_S2 pull    # pulls current branch (sprint-scope-review)
rsync -a workspace/ /tmp/qs2_review/                  # no-op: service doesn't read /tmp
sudo systemctl restart q-s2-webhook
```

**Key implication:** The service runs from the workspace git checkout. Deploying means committing to the repo, pushing to the remote, SSHing to EC2, and running `deploy.sh` (or running `git pull` + `systemctl restart` directly). GitHub Actions triggers `deploy.sh` on push to `main`, but `deploy.sh` pulls from whatever branch the EC2 is on (`sprint-scope-review`) — not from `main`. Pushing to `main` triggers a pull of sprint-scope-review and a restart.

**Always verify the EC2 branch before any deploy:** `ssh openclaw "git -C /home/ubuntu/.openclaw/workspace/Q_S2 branch --show-current"`

---

## Scenario A: Bot4 Symbol Swap (CRVUSDT → New Token)

Bot4 is currently `enabled: false` and holds no open position. This makes the swap low-risk.

### Pre-conditions to verify

```bash
# 1. Confirm Bot4 is disabled
grep -A3 '"Bot4"' /Users/ianhenderson/Q_S2/config/bots.json | grep enabled
# Expected: "enabled": false

# 2. Confirm Bot4 has no open position on Bybit
# (Do this via the Bybit subaccount dashboard or API — the Bot4 subaccount uses S2_BOT4_API_KEY)
# If Bot4 has any CRVUSDT position, close it manually before proceeding.
```

### Step 1 — Update `mdx/Bot4.source.json`

Replace the entire file with the new MDX data for the new token. The format must match the existing schema exactly:

```json
{
  "botMeta": {
    "botName": "<NEW_TOKEN>",
    "asset": "<NEW_TOKEN>"
  },
  "signalBotSourceMeta": {
    "optimizedPeriod": "<date>",
    "exchange": "<exchange>",
    "timeframe": "<timeframe>",
    "signalSetting": <number>,
    "baseline": "<type>",
    "baselineValue": <number>,
    "slType": "<type>",
    "slValue": <number>
  },
  "sourcePerformanceMeta": {
    "performance30d": <number or null>,
    "performance90d": <number or null>,
    "performance180d": <number or null>,
    "performance360d": <number or null>,
    "winrate": <number>,
    "profitFactor": <number or null>
  },
  "defaultProfile": "balanced",
  "profiles": {
    "safe": { "strategy": { ... }, "performanceMeta": { ... } },
    "balanced": { "strategy": { ... }, "performanceMeta": { ... } },
    "aggressive": { "strategy": { ... }, "performanceMeta": { ... } }
  }
}
```

Each `strategy` block requires exactly:
- `tpTargetsPercent`: array of **6** numbers (percent move from entry)
- `tpAllocationsPercent`: array of **6** numbers (percent of position to close at each level)
- `stopLossPercent`: number > 0
- `slToBeTrigger`: `"TP1"`, `"TP2"`, or `"TP3"` (sets the break-even trigger level)
- `leverage`: number > 0

`tpTargetsPercent` and `tpAllocationsPercent` must each have exactly 6 elements — `resolveMdxSettings.js` validates with `validatePercentArray` and throws if the count is wrong.

If a profile is not available from the source (e.g., no safe profile), populate it with the balanced values as a placeholder rather than leaving nulls — any null value will cause a runtime throw if that profile is ever selected.

### Step 2 — Update `config/bots.json`

Change the Bot4 `symbol` field:

```json
{
  "botId": "Bot4",
  "enabled": false,
  "symbol": "<NEWTOKENUSDT>",   ← change this
  ...
}
```

Do **not** change `credentialRef` — Bot4's Bybit subaccount keys remain unchanged. The same subaccount will trade the new symbol.

### Step 3 — Update `config/settings.json` allowedSymbols (if needed)

Check whether the new symbol is already in the allowedSymbols list:

```bash
grep -A10 '"allowedSymbols"' /Users/ianhenderson/Q_S2/config/settings.json
```

Current EC2 allowedSymbols (from commit `e5f0398`):
```json
["STXUSDT","NEARUSDT","PAXGUSDT","CRVUSDT","WIFUSDT","IPUSDT","FLOKIUSDT","PUMPFUNUSDT"]
```

- If the new token is already in the list: no change needed.
- If the new token is not in the list: add it. CRVUSDT can remain in the list (harmless if no bot uses it, the check only blocks symbols that are absent).

**Do not remove CRVUSDT from the list** unless you are certain no other bot or future use references it. Removing a symbol that no bot currently uses has no effect but avoids future confusion.

### Step 4 — Verify Bybit-side readiness

Before enabling Bot4 to trade:
- Confirm the new symbol is available as a USDT Perpetual on Bybit
- Confirm the Bot4 Bybit subaccount has USDT margin available
- Confirm no existing position in CRVUSDT remains on the Bot4 subaccount (it was disabled, but verify)
- Note: the Bot4 credential (`S2_BOT4_API_KEY`) does not change

### Step 5 — Update TradingView

Bot4 receives signals from a TradingView bot configured to send `ENTER_LONG_Bot4`, `EXIT_LONG_Bot4`, etc. to the webhook. That alert must be updated to reflect the new symbol on TradingView's side. This is a TradingView-side action; no code change.

### Step 6 — Enable Bot4 in registry (when ready to go live)

This is a separate step from the symbol swap. Only enable after all above steps are confirmed:

```json
{
  "botId": "Bot4",
  "enabled": true,   ← flip this only when ready
  "symbol": "<NEWTOKENUSDT>",
  ...
}
```

### Step 7 — Commit, push, and deploy

```bash
# From local Mac clone, on sprint-scope-review branch
git add config/bots.json mdx/Bot4.source.json config/settings.json
git commit -m "Bot4: swap symbol from CRVUSDT to <NEWTOKENUSDT>, update MDX source"
git push origin sprint-scope-review

# Then on EC2:
ssh openclaw "cd /home/ubuntu/.openclaw/workspace/Q_S2 && git pull && sudo systemctl restart q-s2-webhook"
```

Verify service restarted:
```bash
ssh openclaw "systemctl status q-s2-webhook --no-pager"
```

### Step 8 — Post-deploy verification

Send a test signal using the existing test webhook script (using valid auth), or check the next real signal:

```bash
# On EC2: tail service log for Bot4 entry signal
ssh openclaw "journalctl -u q-s2-webhook -f --no-pager | grep Bot4"
```

The log should show `resolvedBotContext` with the new symbol and the new MDX profile values. If Bot4 is still `enabled: false`, signals will be received and logged but not executed.

---

## Scenario B: Bot2 Profile Change (aggressive → balanced)

Bot2 is currently `enabled: true` and may have an open NEAR position.

### Behavioral change

| Field | aggressive (current) | balanced (new) |
|---|---|---|
| Leverage | 6x | 4x |
| TP1 trigger | 4.87% | 4.22% |
| TP1 close% | 8% | 8% |
| TP2 trigger | 5.44% | 5.40% |
| TP2 close% | 28% | 42% |
| TP3 trigger | 7.18% | 6.73% |
| TP4 trigger | 10.96% | 10.81% |
| TP5 trigger | 16.23% | 16.20% |
| TP6 trigger | 24.03% | 23.96% |
| SL | 6% | 6% |
| BE trigger | TP1 → 4.87% | TP1 → 4.22% |
| DCA | On (via `dcaPolicy.enabled: true`) | On (unchanged — not MDX-controlled) |

**DCA note:** `dcaPolicy.enabled` is in `bots.json`, not the MDX profile. It remains `true` regardless of profile change. The DCA add will be sized based on the new leverage (4x) and the new 10% accountPercent, same formula.

### Pre-conditions to check

```bash
# Check if Bot2 has an open NEAR position
# Via Bybit subaccount dashboard or API (S2_BOT2_API_KEY)
```

**If Bot2 has an open NEAR position:**

The management loop will switch to balanced profile settings immediately after restart. This affects:
- BE trigger: if BE was already armed at 4.87%, it will now be evaluated at 4.22% — slightly earlier (moves in favor, so still directionally correct)
- TP evaluation: if position is between TP1 balanced (4.22%) and TP1 aggressive (4.87%), a TP1 close could trigger immediately on the next management loop tick after restart

**Recommendation:** If a NEAR position is open, wait for it to close (hit SL or all TPs) before changing the profile, OR close it manually via Bybit before the restart.

If Bot2 is flat, the profile change takes effect cleanly on the next entry signal.

### Step 1 — Update `config/bots.json`

Change the Bot2 `mdxProfile` field from `"aggressive"` to `"balanced"`:

```json
{
  "botId": "Bot2",
  "enabled": true,
  "symbol": "NEARUSDT",
  ...
  "mdxProfile": "balanced",   ← change from "aggressive"
  "dcaPolicy": {
    "enabled": true            ← leave unchanged
  },
  ...
}
```

**No change to `mdx/Bot2.source.json` is needed.** The `balanced` profile block already exists in that file.

### Step 2 — Commit, push, and deploy

```bash
git add config/bots.json
git commit -m "Bot2: switch MDX profile from aggressive to balanced"
git push origin sprint-scope-review

ssh openclaw "cd /home/ubuntu/.openclaw/workspace/Q_S2 && git pull && sudo systemctl restart q-s2-webhook"
```

### Step 3 — Post-deploy verification

```bash
# Confirm resolved settings show balanced profile
ssh openclaw "journalctl -u q-s2-webhook --since '1 minute ago' --no-pager | grep Bot2"
```

Or trigger a test signal and check the webhook log for `leverage: 4` (was 6) and BE trigger `4.22` (was `4.87`).

Alternatively, run the resolve script locally (after `git pull`):
```bash
node -e "
const { resolveBotSettings } = require('./src/config/resolveBotSettings');
resolveBotSettings('Bot2').then(ctx => {
  console.log('leverage:', ctx.settings.positionSizing.leverage);
  console.log('BE trigger:', ctx.settings.breakEven.triggerPercent);
  console.log('profile:', ctx.mdxSelectedProfile);
}).catch(console.error);
"
```

Expected output: `leverage: 4`, `BE trigger: 4.22`, `profile: balanced`.

---

## Quick Reference: Which Files Change for Each Scenario

| File | Bot4 symbol swap | Bot2 profile change |
|---|---|---|
| `config/bots.json` | Bot4 `symbol` (+ `enabled` when going live) | Bot2 `mdxProfile` |
| `mdx/Bot4.source.json` | Full replacement | No change |
| `mdx/Bot2.source.json` | No change | No change |
| `config/settings.json` | `allowedSymbols` if new symbol not present | No change |
| Bybit | Verify subaccount, new pair available | Wait for NEAR position to close (if open) |
| TradingView | Update Bot4 alert to new symbol | No change |
| EC2 `.env` | No change | No change |

---

## Rollback

For either scenario: the config files are version-controlled. To revert:

```bash
git revert HEAD   # or git checkout <prior-commit> -- <file>
git push origin sprint-scope-review
ssh openclaw "cd /home/ubuntu/.openclaw/workspace/Q_S2 && git pull && sudo systemctl restart q-s2-webhook"
```

The service will return to prior settings on restart. No DB migration is required for either change.
