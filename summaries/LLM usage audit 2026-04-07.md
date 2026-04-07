# LLM usage audit 2026-04-07

## Availability note

A full per-request token ledger for the last 24–48h is **not available locally** from the artifacts currently accessible.

What is available:
- current session aggregate usage/status
- current session context size
- current session compaction count
- current model config/defaults
- structural evidence about prompt/context components

What is not currently available from local inspection:
- a complete historical per-call export with `input_tokens / output_tokens / total_tokens` for every request over the last 24–48h
- a built-in local table of per-request endpoint/function/token usage history

This report therefore separates exact measured facts from data that is not available locally.

---

## 1. Per-request metrics

### Status
Full per-request metrics for the last 24–48h are **not fully available** from local telemetry currently accessible.

### What is available from the current sampled tool-using turn
- timestamp: `2026-04-07 22:23 UTC`
- model: `openai/gpt-5.4`
- input tokens: `493`
- output tokens: `161`
- cache read: `201,856`
- estimated cost for that sampled turn: `$0.0541115`
- stop reason: `toolUse`

### Important caveat
The `totalTokens` field exposed in the sampled session message appears to reflect session/context-scale accounting rather than a clean per-request token total suitable for historical rollup.

---

## 2. Aggregated stats

### Exact available aggregates for the current session
From session status / session listing:

- model: `openai/gpt-5.4`
- current session context: `202k / 272k`
- current session cached tokens: `201k cached`
- current session reported tokens:
  - `1.4k in`
  - `277 out`
- current session reported cost:
  - `$0.0076`
- current session total tokens:
  - `201,955`
- current session estimated total cost:
  - `$197.9048795`
- compactions:
  - `3`

### Availability caveat
These are session-level status values, not a clean per-request historical rollup for the last 24–48h.

Requested fields not exactly available from local telemetry:
- total number of LLM calls
- average input tokens per call
- average output tokens per call
- max input tokens observed
- max output tokens observed
- exact total tokens used over the requested 24–48h window as a per-call ledger

---

## 3. Payload composition

### System prompt size
Exact token count is **not available** from local telemetry.

Known components include:
- OpenClaw platform/system instructions
- tool policy and tool descriptions
- skill instructions
- workspace/project context files
- AGENTS / SOUL / USER / MEMORY context
- prior compacted conversation state when present

### User prompt size
Exact per-request token count is **not available**.

Observed contributors include:
- current user message text
- attached files/media content shown in chat
- quoted prior messages / summaries injected into conversation

### Context/history size
Exact measured session fact:
- current context footprint: `~202k tokens used out of 272k`
- compactions so far: `3`

### Data payload size
Exact per-request token breakdown by component is **not available**.

Recent examples of included data types:
- long Trello card descriptions
- large TradingView CSV content
- repo docs and summary files
- runtime logs
- DB query outputs
- config files
- screenshots/media-derived extracted text

---

## 4. Context behaviour

### Are previous messages/history being sent?
Yes.

Factual evidence:
- current session context is `~202k tokens`
- compactions have happened `3` times
- session is carrying substantial accumulated context/history

### How much prior history on average?
Exact per-request average is **not available**, but current session state shows a large retained context window plus periodic compaction/summarisation.

### Is there truncation or token limiting?
Yes, effectively.

Factual evidence:
- context window reported: `272k`
- current usage: `202k`
- compactions: `3`

So there is clearly:
- a context limit
- and a compaction mechanism once context grows too large

---

## 5. Data inclusion check

### full signal arrays
Yes, sometimes.

Examples from recent work:
- recent signal lists from DB
- TradingView signal lists
- bot-by-bot signal summaries

### full normalized_signals datasets
Not usually full table dumps, but slices / query outputs from `normalized_signals` have definitely been included.

### full review packs
Yes.

Recent examples:
- full daily review pack content
- dated summary files
- recap docs

### logs or debug output
Yes.

Recent examples:
- systemctl output
- runtime error logs
- raw webhook rows
- SQL query output
- parser/risk/runtime traces

### config files
Yes.

Recent examples:
- `bots.json`
- `settings.json`
- systemd unit files
- run scripts
- dashboard source files
- webhook source files

### Typical size estimate
Exact token counts are **not available**, but observed size tendencies are:
- config files: small to medium
- logs/query outputs: small to very large, depending on query/result dump
- review packs: medium to large
- TradingView CSV: large
- current accumulated session context: very large

---

## 6. Changes over time

### Has average input token size increased in the last 3–7 days?
Exact measured average is **not available** from local per-call telemetry.

### Factual likely contributors to larger payloads in recent work
These are real workflow/content changes in recent work:
- long project summaries injected after compaction
- multiple dated summary files created and discussed
- large TradingView CSV content reviewed
- Trello card creation/updates with long structured specs
- repeated runtime/log/DB inspections
- audit-style analysis requests
- review-pack generation requests
- image/screenshot-based settings extraction
- large workspace/project context retained in session

This report does not attach a measured numeric trend line because that exact telemetry is not locally available.

---

## 7. Safeguards

### Is there currently any max token budget per request?
No explicit per-request budget was found in the inspected config.

Visible controls instead:
- context window: `272k`
- compaction behaviour: present
- model default: `openai/gpt-5.4`
- subagent default: `openai/gpt-5.4-mini`

### Is there any summarisation or compression before sending data?
Yes, some.

Factual evidence:
- session compactions occur
- conversation history has been compacted into summaries
- some tasks used summarized prior state rather than raw full history

However:
- there is no evidence of a strict payload minimizer automatically preventing large logs/files/review packs from being included
- large inputs can still clearly be sent when the task asks for them

---

## Bottom-line factual findings

1. Current session context is very large
   - `~202k tokens in context`
   - `3 compactions`

2. A full historical per-call token ledger is not locally available from current accessible telemetry

3. Large payload contributors are real
   - TradingView CSV review
   - long summary docs
   - Trello specs
   - config/log/DB dumps
   - sustained session history carryover

4. History is definitely being retained
   - this is not stateless per-message usage

5. There is compaction, but not a strict low-payload discipline
   - large data artifacts are still being brought into context during analysis-heavy work
