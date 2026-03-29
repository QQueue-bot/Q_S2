# Sprint C5 Recap

_Last updated: 2026-03-29 UTC._

## Scope

Sprint C5 implemented the bot credential mapping model so each bot can reference env-backed API credentials without storing secrets in committed bot config.

## What was delivered

### Bot registry credential references

Updated:

- `config/bots.json`
- `src/config/botRegistry.js`

Changes:

- bot entries now require a `credentialRef` object
- `credentialRef` currently uses:
  - `apiKeyEnv`
  - `apiSecretEnv`
- registry validation now enforces presence of both env-var reference fields
- raw API secrets remain outside committed bot config

### Credential resolver

Added:

- `src/config/resolveBotCredentials.js`

This module now:

- resolves bot credential references from the registry
- loads `.env` as the master secret source
- reads the referenced env vars safely
- hard-fails when credential references are missing or invalid
- hard-fails when referenced env vars are missing

### Bot context integration

Updated:

- `src/config/resolveBotContext.js`

Changes:

- bot context now includes resolved credentials alongside bot/settings/symbol context

## Validation

Added:

- `scripts/test-bot-credential-mapping.js`

Validation confirmed:

- Bot1 resolves credential references successfully
- missing credential env mapping fails clearly
- invalid credential reference fails clearly
- no raw API secrets are stored in `bots.json`

## Interpretation

Sprint C5 is complete for the agreed credential-mapping-model scope.

The system now has a clean credential reference path from:

- bot registry entry

to:

- env-var credential references
- `.env` secret resolution
- hard-fail validation on missing/invalid mappings

This creates the right base for later subaccount/account-routing work without doing the live routing cutover inside C5.

## Non-goals respected

Sprint C5 did not attempt to add:

- live subaccount routing
- account switching
- 8-bot cutover
- secret storage redesign beyond env-backed references
