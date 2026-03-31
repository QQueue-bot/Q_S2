# Sprint H1 Recap - Repo Hygiene for Dashboard and F2 Leftovers

_Last updated: 2026-03-31 UTC._

## Objective

Review and reconcile older uncommitted leftovers in `Q_S2` so the repository better reflects the real dashboard/F2 state without mixing in unrelated or misleading drift.

## Files reviewed

- `scripts/run-dashboard.js`
- `deploy/systemd/q-s2-dashboard.service`
- `docs/milestone-f-roadmap.md`
- `docs/milestone-f-trello-seed.md`
- `docs/sprint-f2-recap.md`

## Result

All reviewed leftovers were determined to be valid repo content rather than junk.

### `scripts/run-dashboard.js`
Kept and committed.

Reason:
- the only outstanding tracked change was a sensible dashboard host binding update from `127.0.0.1` to `0.0.0.0`, matching the systemd runtime usage.

### `deploy/systemd/q-s2-dashboard.service`
Kept and committed.

Reason:
- reflects the real dashboard service shape used by the runtime.

### `docs/milestone-f-roadmap.md`
Kept and committed.

Reason:
- valid planning context for Milestone F.

### `docs/milestone-f-trello-seed.md`
Kept and committed.

Reason:
- useful sprint-card seed/reference for Milestone F.

### `docs/sprint-f2-recap.md`
Kept and committed.

Reason:
- valid recap of runtime persistence/observability activation.

## Interpretation

Sprint H1 removed this small pocket of repo ambiguity by converting the reviewed leftovers into intentional repo state.

This was a hygiene/continuity cleanup, not a runtime behavior change sprint.
