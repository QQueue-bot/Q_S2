# LLM payload reduction plan 2026-04-08

## Goal

Reduce LLM token usage in the S2 workflow by shrinking recurring prompt/context payloads without losing operational usefulness.

This plan is intentionally practical. It focuses on what to stop sending, what to summarize earlier, what to move into files/scripts, and which prompt patterns are likely inflating cost.

---

## 1. What to stop sending

### A. Stop sending full TradingView CSV/log exports into chat by default

Current issue:
- large raw TradingView CSV exports can be extremely token-heavy
- once pasted or attached and then discussed, they often remain part of long session context

New rule:
- do not feed full TradingView CSV/log exports into the main conversation unless a one-off forensic review is explicitly needed
- prefer local parsing/script output instead of raw CSV content in prompt context

Replacement:
- use a script to extract only:
  - time window
  - bot ids
  - signal types
  - delivery failures
  - duplicates
- then provide only the reduced result to the LLM

### B. Stop sending full DB query dumps when counts or recent rows are enough

Current issue:
- raw DB row dumps can balloon context quickly
- repeated query output compounds session growth

New rule:
- default to counts, latest row, and narrow filtered slices
- only dump full rows when the exact row content is required for diagnosis

Replacement:
- use fixed query patterns such as:
  - latest 5 rows
  - count by bot
  - count by status
  - one specific bot over one time window

### C. Stop pasting long Trello specs into the chat once they are already written to Trello/docs

Current issue:
- long structured backlog/spec text is useful once, then becomes repeated prompt ballast

New rule:
- once a spec is stored in Trello or a repo doc, reference it by card/file instead of re-pasting the whole spec

Replacement:
- ask for:
  - “implement card X”
  - “review file Y”
  - “update the existing F3L card”

### D. Stop re-sending full daily review packs for follow-up questions

Current issue:
- full review packs are medium/large payloads
- then follow-up questions only need one small section

New rule:
- for follow-ups, send only the specific section or ask against the saved file

Replacement:
- “check the execution integrity section in today’s review pack”
- “update only the proposed risk table”

### E. Stop mixing multiple tasks into one huge analysis turn when they can be split

Current issue:
- large mixed requests pull in more history, more files, and broader context than needed

New rule:
- split:
  - diagnosis
  - reporting
  - Trello updates
  - deployment
into separate smaller turns when possible

---

## 2. What to summarize earlier

### A. Summarize long operational investigations into one durable repo note quickly

Current issue:
- investigations often stay alive across many messages
- the same facts get restated repeatedly

New rule:
- once a diagnosis is stable, write it to a repo summary/recap file immediately
- then refer to that file instead of re-explaining the full thread

Best targets:
- bug root cause
- deployment state
- mapping decisions
- DCA decisions
- ops findings

### B. Summarize screenshot-derived settings once into structured source files

Current issue:
- screenshots are expensive to reason over repeatedly
- the extracted values then get discussed again and again

New rule:
- once settings are extracted, convert them to JSON or a small recap doc immediately
- after that, refer only to the structured file

### C. Summarize signal reconciliation into compact tables, not prose

Current issue:
- long prose explanations of signal history are token inefficient

New rule:
- use compact tables or bullet summaries with:
  - bot
  - signal
  - timestamp
  - source
  - result

### D. Summarize sprint completion into one-liners after docs/Trello are updated

Current issue:
- once work is committed and documented, long conversational recap adds little value

New rule:
- after completion, respond with:
  - file changed
  - commit
  - deploy needed or not
  - Trello state

---

## 3. What to move into files/scripts instead of prompt context

### A. Move recurring reviews into fixed-format scripts/output files

Use scripts for:
- S2-only signal dumps
- execution tables
- raw webhook ingress extraction
- duplicate signal detection
- counts by bot / status / time window

Why:
- keeps the prompt small
- makes output reproducible
- avoids hand-built narrative every time

### B. Move canonical mappings and policies into versioned files

Keep these in files, not chat memory:
- bot-to-symbol mapping
- per-bot DCA policy
- active validation set
- current proposed risk table
- market classification definitions if formalized

Why:
- avoids repeated restatement
- reduces ambiguity
- reduces prompt size

### C. Move common operator flows into scripts

Examples:
- post-change ops check
- runtime sync + restart
- dashboard deploy + smoke test
- review-pack generation

Why:
- script output is smaller than long manual instructions
- repeatability reduces explanatory overhead

### D. Move recurring prompt templates into Trello Q prompts or repo prompt files

Why:
- prompt can be referenced by name
- avoids re-pasting full instruction blocks into chat repeatedly

---

## 4. Prompt patterns likely inflating cost the most

### A. “Generate the full review pack” style prompts

These tend to inflate cost because they invite:
- broad context recall
- multiple source reads
- large structured output
- comparisons across systems

Mitigation:
- use narrower variants when possible:
  - “generate S2-only raw signal output”
  - “update only the risk table”
  - “check last 6 hours Bot2/Bot4 only”

### B. Multi-file forensic debugging with pasted evidence

These turns often combine:
- screenshots
- logs
- DB dumps
- config files
- previous history

Mitigation:
- narrow scope before opening the turn
- use scripts to preprocess evidence first

### C. Repeated long Trello/spec authoring in chat

Mitigation:
- keep a short summary in chat
- write the full spec directly to Trello/doc once
- refer back by card/file

### D. Open-ended retrospective questions over a long session

Examples:
- “what happened over the last few days?”
- “summarize everything around this bug”

These encourage broad history inclusion.

Mitigation:
- ask against a known file or date range
- ask for a narrow scope first

### E. Large-context follow-ups after compaction

Once a session is already huge, even small follow-ups can be more expensive because the context base is large.

Mitigation:
- deliberately pivot to file-based state and short prompts
- start a fresh thread/session for a new major workstream if needed

---

## 5. Concrete low-cost operating rules

### Rule 1
For signal checks, default to:
- last N hours
- one or two bots
- counts + latest rows
not full arrays unless explicitly needed

### Rule 2
For reviews, prefer S2-only first.
Only bring in TradingView or external comparison when explicitly required.

### Rule 3
After a diagnosis is stable, store it in:
- repo doc
- Trello card
- memory note
then stop re-litigating it in chat

### Rule 4
Use scripts for repetitive checks.
Do not rebuild the same data tables manually in chat every day.

### Rule 5
Use short operator prompts.
Examples:
- `Ops check`
- `S2 raw output last 6h Bot2`
- `Check Bot5/Bot7 post-F3L`
- `Update today review file only`

### Rule 6
When asking for changes, specify the minimum output needed.
Examples:
- “commit only”
- “no narrative”
- “Trello + file only”
- “short PASS/FAIL only”

---

## 6. Best opportunities to reduce payload immediately

### Highest impact
1. stop using full TradingView CSV content in chat by default
2. narrow DB outputs to counts/latest rows
3. reduce full-review-pack generation frequency
4. stop re-pasting full specs once stored in Trello/docs
5. use more script-generated factual outputs and fewer narrative reconstructions

### Medium impact
6. ask about one bot or one time window instead of all bots by default
7. keep follow-up questions anchored to saved files
8. split deploy/diagnosis/reporting into separate turns

### Lower but still useful impact
9. use Q prompt cards for standard workflows
10. close or pivot sessions after major workstreams instead of carrying giant context indefinitely

---

## 7. Recommended next operational pattern

### For daily work
- use saved prompt cards
- use file/script references
- request only the smallest needed output

### For debugging
- preprocess with scripts first
- then ask the LLM to interpret reduced outputs

### For reviews
- generate one durable file
- refer back to that file for follow-ups

### For long-running sessions
- prefer fresh threads/sessions for distinct workstreams once a big sprint cluster is complete

---

## Bottom line

The biggest likely cost drivers in this workflow are:
- very large retained session context
- raw CSV/log/config/debug payloads
- repeated long review/spec turns
- broad multi-topic prompts

The biggest reductions will come from:
- preprocessing data with scripts
- using saved files instead of repeated chat restatement
- narrowing scope by bot/time/system
- keeping reviews and ops checks structured and minimal
