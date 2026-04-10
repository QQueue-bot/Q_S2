Project: Q_S2

Core rules

Never modify live execution behavior unless explicitly instructed.
All new strategy logic must start in shadow mode only.
Do not change runtime wiring, secrets, or deployment config unless explicitly requested.
Keep changes tightly scoped to the task.
Prefer minimal edits over broad refactors.
Always report: files changed, summary, risks, and test steps.

S3 rules

S3 is scoring and filtering only at first.
No live trade blocking yet.
No position sizing changes yet.
Log-only / shadow-mode first.`
Save the file.
In the Claude panel on the right, send this exact prompt:

`Read this repo and propose the safest implementation plan for S3 Shadow Scoring v1.
Do not modify any files yet.

Goal:
Add a log-only scoring layer for incoming MDX signals.

Inputs to score:

RSI position
distance from VWAP
volume spike
HTF trend alignment
recent win/loss streak
major support/resistance context

Requirements:

no live execution changes
no S1/S2 behavior changes
config-driven where practical
log score and score components only

Output format:

what files you would inspect
what files you would likely change
safest implementation sequence
risks / assumptions
exact questions if anything is missing