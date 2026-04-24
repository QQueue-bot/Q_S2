# HANDOVER_NOTES.md

## Scope of this pass
This cleanup pass was intentionally limited to:
- documentation
- labels
- non-code descriptive references

No `src/` code was modified.
No strategy parameters, DCA configs, validator logic, or sqlite location were intentionally changed.

---

## Noted contradictions / follow-up items not fixed in this pass

### 1. Repo config label vs validator semantics
`config/settings.json` now labels `environment.mode` as `mainnet` for documentation accuracy, but validator and surrounding repo assumptions may still reflect older validation-era expectations elsewhere.
This pass did not change validator logic.

### 2. Mainnet operational reality vs validation-era config language
The repo still contains older validation/testnet/demo wording in various docs and scripts.
Some of that language is clearly stale, but not every reference was changed in this pass because the scope was documentation/labels only and ambiguous references were left alone.

### 3. Historical `/tmp/qs2_review` references still exist in the repo
There are still likely references to `/tmp/qs2_review` in:
- scripts
- deploy helpers
- older recap docs
- service examples

Many of those may be historical rather than currently authoritative.
This pass avoided broad script/ops edits to prevent accidental runtime-impacting changes.

### 4. Real exchange usage vs repo environment text
Bybit account review on 2026-04-24 showed current bot credentials working on Bybit mainnet and returning live balances, positions, executions, and closed PnL.
That operational truth is stronger than older repo text that still described demo/testnet execution.

### 5. Runtime durability remains an ops concern
The 2026-04-24 outage showed that prior dependence on `/tmp/qs2_review` was fragile and cost the richer local runtime DB history.
This pass did not redesign runtime storage or backup policy.

### 6. Uncommitted local runtime wrapper edit exists in working tree
A local modification to `scripts/run-webhook-with-env.sh` already existed before this pass.
It was not changed here, but should be reviewed intentionally before any future branch cleanup/merge work.
