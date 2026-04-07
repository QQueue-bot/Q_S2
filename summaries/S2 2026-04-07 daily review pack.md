# S2 2026-04-07 daily review pack

## 1. EXECUTIVE SUMMARY (FACTS ONLY)
- total_tradingview_signals_active_set: 28
- total_s2_received_signals: 9
- total_s2_executed_order_attempts: 8
- total_failed_order_attempts: 0
- current_active_bots: Bot1, Bot2, Bot4
- current_open_positions: none confirmed from current S2 DB output

## 2. SIGNAL SUMMARY (FACTS)
### Bot1 (IPUSDT)
- tradingview_signals_count: 10
- tradingview_signals: ['ENTER_LONG@2026-04-06T01:35:00Z', 'EXIT_SHORT@2026-04-06T00:00:25Z', 'ENTER_SHORT@2026-04-04T03:10:00Z', 'EXIT_LONG@2026-04-04T02:12:40Z', 'ENTER_LONG@2026-04-03T12:40:00Z', 'EXIT_SHORT@2026-04-03T11:41:52Z', 'ENTER_SHORT@2026-04-01T23:45:00Z', 'EXIT_LONG@2026-04-01T22:31:10Z', 'ENTER_LONG@2026-03-31T22:10:00Z', 'EXIT_SHORT@2026-03-31T21:36:01Z']
- s2_received_signals_count: 4
- s2_received_signals: ['ENTER_LONG@2026-03-29T07:15:42.492Z', 'ENTER_LONG@2026-03-29T07:31:37.628Z', 'EXIT_LONG@2026-04-07T02:00:48.685Z', 'ENTER_SHORT@2026-04-07T03:10:01.525Z']
- s2_executed_signals_count: 3
- mismatch_count: 6

### Bot2 (NEARUSDT)
- tradingview_signals_count: 8
- tradingview_signals: ['ENTER_LONG@2026-04-06T10:00:00Z', 'EXIT_SHORT@2026-04-06T09:06:56Z', 'ENTER_SHORT@2026-04-05T15:00:00Z', 'EXIT_LONG@2026-04-05T12:33:42Z', 'ENTER_LONG@2026-04-03T15:00:00Z', 'EXIT_SHORT@2026-04-03T12:30:12Z', 'ENTER_SHORT@2026-04-02T07:30:00Z', 'EXIT_LONG@2026-04-02T05:08:59Z']
- s2_received_signals_count: 2
- s2_received_signals: ['EXIT_LONG@2026-04-07T05:31:43.286Z', 'ENTER_SHORT@2026-04-07T07:30:05.731Z']
- s2_executed_signals_count: 2
- mismatch_count: 6

### Bot3 (PAXGUSDT)
- tradingview_signals_count: 0
- tradingview_signals: []
- s2_received_signals_count: 0
- s2_received_signals: []
- s2_executed_signals_count: 0
- mismatch_count: 0

### Bot4 (CRVUSDT)
- tradingview_signals_count: 10
- tradingview_signals: ['ENTER_LONG@2026-04-06T02:40:01Z', 'EXIT_SHORT@2026-04-06T02:11:14Z', 'ENTER_SHORT@2026-04-05T08:00:01Z', 'EXIT_LONG@2026-04-05T07:35:45Z', 'ENTER_LONG@2026-04-04T21:20:01Z', 'EXIT_SHORT@2026-04-04T19:14:45Z', 'ENTER_SHORT@2026-04-02T05:20:01Z', 'EXIT_LONG@2026-04-02T02:44:16Z', 'ENTER_LONG@2026-04-01T05:20:01Z', 'EXIT_SHORT@2026-04-01T05:17:15Z']
- s2_received_signals_count: 3
- s2_received_signals: ['ENTER_LONG@2026-04-06T19:38:21.423Z', 'EXIT_LONG@2026-04-06T23:30:16.112Z', 'ENTER_SHORT@2026-04-07T00:00:14.515Z']
- s2_executed_signals_count: 3
- mismatch_count: 7

### Bot5 (WIFUSDT)
- tradingview_signals_count: 0
- tradingview_signals: []
- s2_received_signals_count: 0
- s2_received_signals: []
- s2_executed_signals_count: 0
- mismatch_count: 0

### Bot6 (IPUSDT)
- tradingview_signals_count: 0
- tradingview_signals: []
- s2_received_signals_count: 0
- s2_received_signals: []
- s2_executed_signals_count: 0
- mismatch_count: 0

### Bot7 (FLOKIUSDT)
- tradingview_signals_count: 0
- tradingview_signals: []
- s2_received_signals_count: 0
- s2_received_signals: []
- s2_executed_signals_count: 0
- mismatch_count: 0

### Bot8 (PUMPFUNUSDT)
- tradingview_signals_count: 0
- tradingview_signals: []
- s2_received_signals_count: 0
- s2_received_signals: []
- s2_executed_signals_count: 0
- mismatch_count: 0

## 3. SIGNAL TIMING (FACTS)
- duplicate_or_missing_signals: TradingView active-set log shows more delivered S2 bot alerts than are present in the aligned S2 DB; this remains a reconciliation gap.
- tv_to_s2_delay_detail: precise per-signal delay cannot be computed reliably from current DB because several expected TradingView-delivered signals are absent from normalized_signals.

## 4. EXECUTION INTEGRITY (FACTS)
- failed_orders_count: 0
- failed_orders: []
- rejected_signals: no explicit rejected-signal rows in current aligned DB snapshot
- routing_or_parsing_issues: active-set reconciliation gap still exists between TradingView-delivered signals and normalized_signals coverage
- mdx_management_consistency_note: pre-fix Bot4 trade was managed incorrectly under shared TP/BE thresholds; fix deployed in commit 41cc74e before current post-fix observation window

## 5. MARKET CLASSIFICATION (LIGHT INTERPRETATION)
- market_state: MIXED
- reason: recent active-set behaviour shows flip sequences and uneven continuation rather than a clean broad trend; prior review also identified choppy conditions, especially around NEAR.

## 6. SIGNAL BEHAVIOUR (FACTS + LIGHT INTERPRETATION)
- Bot1: flip_count=5, overtrading=yes, signal_count=10
- Bot2: flip_count=4, overtrading=yes, signal_count=8
- Bot4: flip_count=5, overtrading=yes, signal_count=10
- unusual_behaviour: Bot2 showed the clearest flip activity in the reviewed TradingView window; Bot4 has the most important recent lifecycle anomaly due to the now-fixed pre-fix exit-management bug.

## 7. CURRENT PROPOSED RISK TABLE (TRACKING ONLY)
current_proposed_risk_settings
- Bot1 | IPUSDT | 70% / 4x | 60% / 3x | ⬇️
- Bot2 | NEARUSDT | 60% / 4x | 50% / 3x | ⬇️
- Bot3 | PAXGUSDT | 60% / 7x | 0–20% / 1–2x | ⛔⬇️
- Bot4 | CRVUSDT | 70% / 6x | 40% / 3x | ⬇️⬇️
- Bot5 | WIFUSDT | 70% / 5x | 50% / 3x | ⬇️
- Bot6 | IPUSDT | 70% / 3x | 50% / 2x | ⬇️
- Bot7 | FLOKIUSDT | 70% / 6x | 50% / 4x | ⬇️
- Bot8 | PUMPFUNUSDT | 70% / 5x | 60% / 4x | ⬇️

## 8. DCA STATUS (FACTS)
- Bot1 / IPUSDT: dca_status=not confirmed from current aligned DB, recent_dca_executions=0
- Bot2 / NEARUSDT: dca_status=selective candidate / monitoring, recent_dca_executions=0 in current aligned DB
- Bot4 / CRVUSDT: dca_status=enabled in recent staged-entry path, recent_dca_executions=1
- Other bots: not active in controlled validation set during most of reviewed period

## 9. OPEN POSITIONS (FACTS)
- none_confirmed_from_current_aligned_s2_db

## 10. BUG / FIX CONTINUITY (FACTS)
- bug_found: bot-aware exit management mismatch
- bug_detail: TP/SL/BE management had been reading shared config/settings.json instead of bot-resolved MDX settings
- observed_impact: Bot4 / CRVUSDT closed incorrectly under shared demo TP/BE thresholds instead of its balanced MDX profile
- fix_deployed_commit: 41cc74e
- runtime_deploy_status: deployed to /tmp/qs2_review and q-s2-webhook.service restarted on 2026-04-06
- reviewed_period_relation_to_fix: mixed; the Bot4 erroneous close was pre-fix, any new management behaviour after restart should be considered post-fix

## 11. NOTES (FACTS)
- TradingView operational finding: alerts can expire after about 1 month and silently deactivate unless manually renewed; this explains part of the broader signal drop-off and is separate from S2 runtime behaviour.
- As of 2026-04-07 Ian restarted previously stopped S2 TradingView signals outside the active 1/2/4 set and also restarted several S1 trigger alerts due to missed sell entries.
