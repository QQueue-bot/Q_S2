# O2 rollout note 2026-04-08

## Implemented now

- Sprint O2 created and started
- lightweight token-logging / visibility policy documented
- soft payload gate documented
- no hard caps enabled

## What this means operationally

From now on, large prompt requests should be treated with an explicit payload warning mindset.

Main reductions to prefer:
- counts instead of full dumps
- latest rows instead of whole tables
- file references instead of re-pasting stored specs/reviews
- one bot / one time window instead of all-bot broad scans
- script preprocessing before LLM interpretation

## Hard limits status

Not enabled yet.
This rollout is intentionally warning-first and observation-first.
