# Sprint F3C Recap - Active Validation Set Repo Sync

_Last updated: 2026-03-31 UTC._

## Context

After the mobile heartbeat update was deployed, the mobile page correctly showed only 1 enabled bot again. The page itself was not wrong: the live runtime had been reset back to the repo defaults during repo-to-runtime sync.

## Root cause

`config/bots.json` in the repo still carried the older enablement state:

- Bot1 enabled = true
- Bot2 enabled = false
- Bot4 enabled = false

At the same time, the intended live validation set had already been restored manually in the runtime as:

- Bot1 enabled = true
- Bot2 enabled = true
- Bot4 enabled = true

So each repo sync/deploy reintroduced the old one-bot state into runtime.

## Fix applied

Updated repo `config/bots.json` so the intended active validation set is now explicitly:

- Bot1 enabled = true
- Bot2 enabled = true
- Bot4 enabled = true
- all other bots disabled

## Validation

This resolves the identified drift source between repo and runtime for the current controlled live validation set.

## Interpretation

The issue was not caused by the mobile page or deploy helper. The system was faithfully reflecting runtime state. The actual problem was that the repo default config still encoded the older one-bot validation phase and was overwriting runtime on deploy.
