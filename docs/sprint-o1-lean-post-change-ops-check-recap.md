# Sprint O1 - Lean Post-Change Ops Check Framework

## Goal

Implement a cheap, low-overhead post-change ops check so meaningful S2 changes can be verified quickly without burning unnecessary LLM tokens.

## Design constraint

Keep O1 lean:
- short pass/fail checklist
- minimal local checks
- no long narrative report
- no repeated historical analysis
- intended for post-change use, not constant background execution

## Implementation

Added:
- `scripts/post-change-ops-check.sh`

Updated runbook:
- `docs/dashboard-runbook.md`

## What the script checks

- repo/runtime git sync
- runtime config file presence
- webhook service active
- dashboard service active
- sqlite DB readable
- local webhook endpoint responds
- local dashboard responds
- local mobile page responds
- local mobile API responds

## Result

O1 now exists as a practical lightweight operational verification step with negligible extra daily LLM cost when used only after meaningful changes.
