# S2 offline trade review pack - last 24 hours

## 1. Overview
- timeframe_reviewed: from 2026-04-07T18:58:04Z to current UTC review time
- system_overview: TradingView sends bot-specific entry/exit signals. S2 receives and normalizes them. S2 opens trades from valid entry signals when execution is allowed. Once in a trade, S2 primarily manages exits using TP, SL, and break-even logic. Exit signals are secondary and may act as emergency or occasional signal-driven closes depending on runtime behaviour.
- review_objective: study each trade manually, understand bot behaviour by market regime, identify good vs poor entries, assess how S2 management affected outcomes, and build evidence for a future trading regime strategy and context-filter design.

## 2. Per-bot section
### Bot1 / STXUSDT
- enabled: True
- profile: balanced
- tp_targets_percent: [0.85, 2.15, 3.84, 6.48, 9.5, 18.01]
- tp_allocations_percent: [8, 21, 23, 24, 11, 13]
- stop_loss_percent: 5
- move_sl_to_be_trigger: TP2
- leverage: 5
- dca_enabled: False
- s2_signals_received_last_24h: ['EXIT_SHORT@2026-04-07T23:00:26.254Z', 'ENTER_LONG@2026-04-07T23:45:02.947Z', 'EXIT_LONG@2026-04-08T18:49:33.724Z']
- execution_events_last_24h: ['ENTER_LONG@2026-04-07T23:45:04.471Z status=submitted', 'ENTER_LONG_DCA_ADD@2026-04-07T23:46:04.704Z status=submitted']

### Bot2 / NEARUSDT
- enabled: True
- profile: balanced
- tp_targets_percent: [4.22, 5.4, 6.73, 10.81, 16.2, 23.96]
- tp_allocations_percent: [8, 42, 13, 13, 9, 15]
- stop_loss_percent: 6
- move_sl_to_be_trigger: TP1
- leverage: 4
- dca_enabled: True
- s2_signals_received_last_24h: ['EXIT_SHORT@2026-04-07T21:41:13.342Z', 'ENTER_LONG@2026-04-07T22:30:02.524Z']
- execution_events_last_24h: ['ENTER_LONG@2026-04-07T22:30:03.640Z status=submitted', 'ENTER_LONG_DCA_ADD@2026-04-07T22:31:03.879Z status=submitted']

### Bot3 / PAXGUSDT
- enabled: False
- profile: balanced
- tp_targets_percent: [0.37, 0.91, 1.73, 3.09, 4.78, 9.6]
- tp_allocations_percent: [8, 21, 21, 21, 13, 16]
- stop_loss_percent: 3
- move_sl_to_be_trigger: TP3
- leverage: 8
- dca_enabled: False
- s2_signals_received_last_24h: []
- execution_events_last_24h: []

### Bot4 / CRVUSDT
- enabled: True
- profile: balanced
- tp_targets_percent: [3.24, 6.08, 8.44, 10.99, 13.87, 20.47]
- tp_allocations_percent: [7, 38, 19, 18, 8, 10]
- stop_loss_percent: 6
- move_sl_to_be_trigger: TP1
- leverage: 5
- dca_enabled: False
- s2_signals_received_last_24h: ['EXIT_SHORT@2026-04-07T22:33:19.408Z', 'ENTER_LONG@2026-04-08T00:00:13.522Z']
- execution_events_last_24h: ['ENTER_LONG@2026-04-08T00:00:14.625Z status=submitted']

### Bot5 / WIFUSDT
- enabled: False
- profile: balanced
- tp_targets_percent: [1.97, 5.67, 9.26, 12.32, 16.91, 26.92]
- tp_allocations_percent: [8, 27, 25, 24, 8, 8]
- stop_loss_percent: 3
- move_sl_to_be_trigger: TP3
- leverage: 7
- dca_enabled: False
- s2_signals_received_last_24h: ['ENTER_LONG@2026-04-07T22:30:02.513Z']
- execution_events_last_24h: []

### Bot6 / IPUSDT
- enabled: False
- profile: balanced
- tp_targets_percent: [4.27, 6.98, 9.91, 15.03, 33.21, 53.87]
- tp_allocations_percent: [8, 40, 12, 12, 14, 14]
- stop_loss_percent: 6
- move_sl_to_be_trigger: TP1
- leverage: 4
- dca_enabled: False
- s2_signals_received_last_24h: []
- execution_events_last_24h: []

### Bot7 / FLOKIUSDT
- enabled: False
- profile: balanced
- tp_targets_percent: [3.03, 6.29, 8.17, 12.35, 17.8, 27.09]
- tp_allocations_percent: [8, 42, 13, 14, 8, 15]
- stop_loss_percent: 5
- move_sl_to_be_trigger: TP2
- leverage: 3
- dca_enabled: False
- s2_signals_received_last_24h: ['ENTER_LONG@2026-04-07T22:30:01.183Z']
- execution_events_last_24h: []

### Bot8 / PUMPFUNUSDT
- enabled: False
- profile: balanced
- tp_targets_percent: [2.12, 4.87, 7.88, 12.64, 19.64, 29.08]
- tp_allocations_percent: [8, 26, 25, 23, 9, 9]
- stop_loss_percent: 4
- move_sl_to_be_trigger: TP1
- leverage: 3
- dca_enabled: False
- s2_signals_received_last_24h: []
- execution_events_last_24h: []

## 3. Per-trade breakdown
### Trade 1: Bot2 NEARUSDT LONG
- signal_time: 2026-04-07T22:30:02.524Z
- entry_submission_time: 2026-04-07T22:30:03.640Z
- entry_status: submitted
- entry_qty: 33.7
- entry_notional_usd: 43.74597000000001
- dca_events: [{'id': 14, 'created_at': '2026-04-07T22:30:03.641Z', 'symbol': 'NEARUSDT', 'bot_id': 'Bot2', 'stage_name': 'initial_entry_50', 'delay_seconds': 0, 'qty': '33.7', 'status': 'submitted', 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"cb7c1b11-e763-4773-8eb4-351ce0fccd58","orderLinkId":""},"retExtInfo":{},"time":1775601003531}'}, {'id': 15, 'created_at': '2026-04-07T22:31:03.880Z', 'symbol': 'NEARUSDT', 'bot_id': 'Bot2', 'stage_name': 'dca_add_entry', 'delay_seconds': 60, 'qty': '33.7', 'status': 'submitted', 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"991c38a0-5d75-4bb5-b917-dcac5470c305","orderLinkId":""},"retExtInfo":{},"time":1775601063773}'}]
- break_even_events: [{'id': 4, 'created_at': '2026-04-08T08:20:08.907Z', 'symbol': 'NEARUSDT', 'event_type': 'armed', 'trigger_percent': 4.22, 'side': 'Buy', 'entry_price': 1.2981, 'mark_price': 1.3537, 'response_json': '{"action":"armed"}', 'bot_id': 'Bot2'}]
- exit_events: [{'id': 19, 'created_at': '2026-04-08T08:20:08.683Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '5.3', 'mark_price': 1.3537, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"605414af-7810-4aad-baba-5acac50b1505","orderLinkId":""},"retExtInfo":{},"time":1775636408575}', 'bot_id': 'Bot2'}, {'id': 20, 'created_at': '2026-04-08T08:20:23.666Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '4.9', 'mark_price': 1.3552, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"ad7d0789-3dd8-47ee-9b54-e783b0655913","orderLinkId":""},"retExtInfo":{},"time":1775636423561}', 'bot_id': 'Bot2'}, {'id': 21, 'created_at': '2026-04-08T08:20:38.665Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '4.5', 'mark_price': 1.3606, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"f0a9cfb3-e4e1-48ee-9ebd-f449a768d01b","orderLinkId":""},"retExtInfo":{},"time":1775636438561}', 'bot_id': 'Bot2'}, {'id': 22, 'created_at': '2026-04-08T08:20:54.864Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '4.2', 'mark_price': 1.36, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"1fced010-c391-451d-9114-e21679056db5","orderLinkId":""},"retExtInfo":{},"time":1775636454761}', 'bot_id': 'Bot2'}, {'id': 23, 'created_at': '2026-04-08T08:21:08.663Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '3.8', 'mark_price': 1.3601, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"50b85c9e-c26b-457a-885c-fe6b63096939","orderLinkId":""},"retExtInfo":{},"time":1775636468559}', 'bot_id': 'Bot2'}, {'id': 24, 'created_at': '2026-04-08T08:21:23.670Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '3.5', 'mark_price': 1.3601, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"60877ec4-b8de-4f0e-9309-fb3cfa2e141d","orderLinkId":""},"retExtInfo":{},"time":1775636483565}', 'bot_id': 'Bot2'}, {'id': 25, 'created_at': '2026-04-08T08:21:38.704Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '3.2', 'mark_price': 1.3602, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"6d4f63f3-173a-40cc-926e-c75b37b81595","orderLinkId":""},"retExtInfo":{},"time":1775636498600}', 'bot_id': 'Bot2'}, {'id': 26, 'created_at': '2026-04-08T08:21:53.659Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '3.0', 'mark_price': 1.3613, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"917fe742-a0d5-4167-9eed-35419a1eb1cd","orderLinkId":""},"retExtInfo":{},"time":1775636513556}', 'bot_id': 'Bot2'}, {'id': 27, 'created_at': '2026-04-08T08:22:08.687Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '2.8', 'mark_price': 1.3587, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"453f005e-4ea5-49a0-aeba-9f56a8ec0f70","orderLinkId":""},"retExtInfo":{},"time":1775636528583}', 'bot_id': 'Bot2'}, {'id': 28, 'created_at': '2026-04-08T08:22:23.688Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '2.5', 'mark_price': 1.3588, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"d010c8a0-2880-4399-9f56-1d6f973346ad","orderLinkId":""},"retExtInfo":{},"time":1775636543584}', 'bot_id': 'Bot2'}, {'id': 29, 'created_at': '2026-04-08T08:22:38.681Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '2.3', 'mark_price': 1.3587, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"29487642-3030-47c3-8f80-058e4f297feb","orderLinkId":""},"retExtInfo":{},"time":1775636558573}', 'bot_id': 'Bot2'}, {'id': 30, 'created_at': '2026-04-08T08:22:53.688Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '2.1', 'mark_price': 1.3581, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"9c65d845-a2a7-43e8-8d16-1b1f78bacc0f","orderLinkId":""},"retExtInfo":{},"time":1775636573585}', 'bot_id': 'Bot2'}, {'id': 31, 'created_at': '2026-04-08T08:23:08.683Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '2.0', 'mark_price': 1.3581, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"72d5186b-1ca5-4826-ac5c-f548e3614534","orderLinkId":""},"retExtInfo":{},"time":1775636588580}', 'bot_id': 'Bot2'}, {'id': 32, 'created_at': '2026-04-08T08:23:23.686Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.8', 'mark_price': 1.3585, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"31c450b6-9a17-4ec4-9a39-5d7192555b94","orderLinkId":""},"retExtInfo":{},"time":1775636603582}', 'bot_id': 'Bot2'}, {'id': 33, 'created_at': '2026-04-08T08:23:39.119Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.7', 'mark_price': 1.3582, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"7ed4257c-7a2e-4063-a288-189e4b4e79d3","orderLinkId":""},"retExtInfo":{},"time":1775636619014}', 'bot_id': 'Bot2'}, {'id': 34, 'created_at': '2026-04-08T08:23:53.706Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.5', 'mark_price': 1.358, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"a92ee570-95bc-46ef-a77c-0103b1dd6302","orderLinkId":""},"retExtInfo":{},"time":1775636633601}', 'bot_id': 'Bot2'}, {'id': 35, 'created_at': '2026-04-08T08:24:08.712Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.4', 'mark_price': 1.3584, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"24063295-7256-4585-aa24-cfac3952d08f","orderLinkId":""},"retExtInfo":{},"time":1775636648609}', 'bot_id': 'Bot2'}, {'id': 36, 'created_at': '2026-04-08T08:24:23.695Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.3', 'mark_price': 1.3586, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"24a16f2f-5be9-4583-9fe2-5c14386b666e","orderLinkId":""},"retExtInfo":{},"time":1775636663592}', 'bot_id': 'Bot2'}, {'id': 37, 'created_at': '2026-04-08T08:24:38.703Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.2', 'mark_price': 1.3585, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"8d31e913-f64f-4a4f-a109-35251b42085a","orderLinkId":""},"retExtInfo":{},"time":1775636678598}', 'bot_id': 'Bot2'}, {'id': 38, 'created_at': '2026-04-08T08:24:53.700Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.1', 'mark_price': 1.3581, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"4705d6e1-c989-4ed7-85c5-bda6c19e18e3","orderLinkId":""},"retExtInfo":{},"time":1775636693596}', 'bot_id': 'Bot2'}, {'id': 39, 'created_at': '2026-04-08T08:25:08.713Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '1.0', 'mark_price': 1.3586, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"ad3561f0-d2cb-4fe6-ab06-6e638f057c15","orderLinkId":""},"retExtInfo":{},"time":1775636708610}', 'bot_id': 'Bot2'}, {'id': 40, 'created_at': '2026-04-08T08:25:23.706Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.9', 'mark_price': 1.3588, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"0fea9bca-a75f-412c-b098-8953a0c5b3f4","orderLinkId":""},"retExtInfo":{},"time":1775636723602}', 'bot_id': 'Bot2'}, {'id': 41, 'created_at': '2026-04-08T08:25:38.713Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.9', 'mark_price': 1.3582, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"4a38cd4b-a1ae-4939-9807-02074eceaa24","orderLinkId":""},"retExtInfo":{},"time":1775636738610}', 'bot_id': 'Bot2'}, {'id': 42, 'created_at': '2026-04-08T08:25:53.726Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.8', 'mark_price': 1.3586, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"70a93bed-dfc0-462b-b827-b324f07c87d1","orderLinkId":""},"retExtInfo":{},"time":1775636753621}', 'bot_id': 'Bot2'}, {'id': 43, 'created_at': '2026-04-08T08:26:09.123Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.7', 'mark_price': 1.3594, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"37d31762-0b28-48f0-83a2-469ed23e70f6","orderLinkId":""},"retExtInfo":{},"time":1775636769018}', 'bot_id': 'Bot2'}, {'id': 44, 'created_at': '2026-04-08T08:26:23.726Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.7', 'mark_price': 1.3596, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"5dce06bc-3755-47a7-98a5-4a74864d608d","orderLinkId":""},"retExtInfo":{},"time":1775636783621}', 'bot_id': 'Bot2'}, {'id': 45, 'created_at': '2026-04-08T08:26:38.728Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.6', 'mark_price': 1.3595, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"c4ff78bb-4875-455a-863d-57cb7d5f6fb4","orderLinkId":""},"retExtInfo":{},"time":1775636798625}', 'bot_id': 'Bot2'}, {'id': 46, 'created_at': '2026-04-08T08:26:53.726Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.6', 'mark_price': 1.3588, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"0b3558e4-75bb-4b85-b444-76ce087b05e9","orderLinkId":""},"retExtInfo":{},"time":1775636813622}', 'bot_id': 'Bot2'}, {'id': 47, 'created_at': '2026-04-08T08:27:08.752Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.5', 'mark_price': 1.3591, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"218ef064-fb21-4aba-adbf-995e35eb09f3","orderLinkId":""},"retExtInfo":{},"time":1775636828647}', 'bot_id': 'Bot2'}, {'id': 48, 'created_at': '2026-04-08T08:27:23.734Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.5', 'mark_price': 1.3597, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"3de96ee6-ac37-4eb2-b87e-299b583d0364","orderLinkId":""},"retExtInfo":{},"time":1775636843630}', 'bot_id': 'Bot2'}, {'id': 49, 'created_at': '2026-04-08T08:27:38.755Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.4', 'mark_price': 1.3595, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"d49411f7-2457-4791-bfc0-75dd440b86a0","orderLinkId":""},"retExtInfo":{},"time":1775636858650}', 'bot_id': 'Bot2'}, {'id': 50, 'created_at': '2026-04-08T08:27:53.746Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.4', 'mark_price': 1.3594, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"64d6b13a-983c-4226-8ce8-1f857f6168ca","orderLinkId":""},"retExtInfo":{},"time":1775636873642}', 'bot_id': 'Bot2'}, {'id': 51, 'created_at': '2026-04-08T08:28:08.744Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.4', 'mark_price': 1.3594, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"34b37dd6-dae7-4218-8b37-1ff232c89b24","orderLinkId":""},"retExtInfo":{},"time":1775636888640}', 'bot_id': 'Bot2'}, {'id': 52, 'created_at': '2026-04-08T08:28:23.750Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.3', 'mark_price': 1.3595, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"cdaf060e-4288-4c5c-bee8-866581d3a4f8","orderLinkId":""},"retExtInfo":{},"time":1775636903646}', 'bot_id': 'Bot2'}, {'id': 53, 'created_at': '2026-04-08T08:28:38.748Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.3', 'mark_price': 1.3584, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"f9ebf9b7-bb91-4ee5-8372-17114fdcf648","orderLinkId":""},"retExtInfo":{},"time":1775636918644}', 'bot_id': 'Bot2'}, {'id': 54, 'created_at': '2026-04-08T08:28:53.756Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.3', 'mark_price': 1.358, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"959d6bbc-987d-49b6-816e-6e57f11043ed","orderLinkId":""},"retExtInfo":{},"time":1775636933652}', 'bot_id': 'Bot2'}, {'id': 55, 'created_at': '2026-04-08T08:29:08.750Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.3', 'mark_price': 1.3577, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"3026ed53-57ad-4ad6-aea8-5681664182bb","orderLinkId":""},"retExtInfo":{},"time":1775636948646}', 'bot_id': 'Bot2'}, {'id': 56, 'created_at': '2026-04-08T08:29:23.760Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3574, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"1b11adbc-0193-4a67-bbb2-364a10f4333b","orderLinkId":""},"retExtInfo":{},"time":1775636963657}', 'bot_id': 'Bot2'}, {'id': 57, 'created_at': '2026-04-08T08:29:38.763Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3577, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"7f60dd13-6ac9-4486-a027-ffa937a19990","orderLinkId":""},"retExtInfo":{},"time":1775636978659}', 'bot_id': 'Bot2'}, {'id': 58, 'created_at': '2026-04-08T08:29:53.766Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3555, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"db3a9ebe-91c0-465d-996b-2ff4314f4d1c","orderLinkId":""},"retExtInfo":{},"time":1775636993663}', 'bot_id': 'Bot2'}, {'id': 59, 'created_at': '2026-04-08T08:30:08.770Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3545, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"d0439a50-12a9-40d3-a329-4b2ec6e2533c","orderLinkId":""},"retExtInfo":{},"time":1775637008668}', 'bot_id': 'Bot2'}, {'id': 60, 'created_at': '2026-04-08T08:30:23.782Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3533, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"845ea616-2c12-42a3-b468-9405bc18671e","orderLinkId":""},"retExtInfo":{},"time":1775637023679}', 'bot_id': 'Bot2'}, {'id': 61, 'created_at': '2026-04-08T08:30:38.787Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3534, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"151b28cf-3543-4b4e-b93f-85bb83106937","orderLinkId":""},"retExtInfo":{},"time":1775637038684}', 'bot_id': 'Bot2'}, {'id': 62, 'created_at': '2026-04-08T08:30:53.768Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.2', 'mark_price': 1.3535, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"a8f918e6-fb29-4529-abae-05c83a8a6ff4","orderLinkId":""},"retExtInfo":{},"time":1775637053666}', 'bot_id': 'Bot2'}, {'id': 63, 'created_at': '2026-04-08T08:31:08.794Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3554, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"94d9ce5f-0022-4a93-8cd8-4cd33c31ea78","orderLinkId":""},"retExtInfo":{},"time":1775637068691}', 'bot_id': 'Bot2'}, {'id': 64, 'created_at': '2026-04-08T08:31:23.788Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3566, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"b383d139-7642-4a10-b0b5-a72cd20332f2","orderLinkId":""},"retExtInfo":{},"time":1775637083683}', 'bot_id': 'Bot2'}, {'id': 65, 'created_at': '2026-04-08T08:31:38.798Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3595, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"83ca4e16-b2a6-498b-ba9a-b2d77e445564","orderLinkId":""},"retExtInfo":{},"time":1775637098694}', 'bot_id': 'Bot2'}, {'id': 66, 'created_at': '2026-04-08T08:31:53.798Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3604, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"f9ac9cc8-9992-4a11-b1b1-19fd5721ed5b","orderLinkId":""},"retExtInfo":{},"time":1775637113693}', 'bot_id': 'Bot2'}, {'id': 67, 'created_at': '2026-04-08T08:32:08.807Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.36, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"99515348-820e-4c99-a587-6a42944d717b","orderLinkId":""},"retExtInfo":{},"time":1775637128703}', 'bot_id': 'Bot2'}, {'id': 68, 'created_at': '2026-04-08T08:32:23.799Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3598, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"44b24e06-1173-4961-a4dd-54af9320b244","orderLinkId":""},"retExtInfo":{},"time":1775637143696}', 'bot_id': 'Bot2'}, {'id': 69, 'created_at': '2026-04-08T08:32:38.834Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3596, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"5f365d96-af00-41e2-bfb8-0f100d06641d","orderLinkId":""},"retExtInfo":{},"time":1775637158731}', 'bot_id': 'Bot2'}, {'id': 70, 'created_at': '2026-04-08T08:32:53.800Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3597, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"afd668f6-cab1-4962-9239-736a359d1110","orderLinkId":""},"retExtInfo":{},"time":1775637173698}', 'bot_id': 'Bot2'}, {'id': 71, 'created_at': '2026-04-08T08:33:08.811Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3605, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"89d38cf8-232d-4f33-b61e-ae7da8815a10","orderLinkId":""},"retExtInfo":{},"time":1775637188701}', 'bot_id': 'Bot2'}, {'id': 72, 'created_at': '2026-04-08T08:33:23.806Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3607, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"12e12083-769a-49aa-a9ab-b20542c81f02","orderLinkId":""},"retExtInfo":{},"time":1775637203703}', 'bot_id': 'Bot2'}, {'id': 73, 'created_at': '2026-04-08T08:33:38.816Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.1', 'mark_price': 1.3604, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"1aa0c0b7-e166-40ed-97b5-bafd39846ca6","orderLinkId":""},"retExtInfo":{},"time":1775637218715}', 'bot_id': 'Bot2'}, {'id': 74, 'created_at': '2026-04-08T08:33:53.822Z', 'symbol': 'NEARUSDT', 'exit_reason': 'take_profit', 'trigger_percent': 4.22, 'close_percent': 8.0, 'side': 'Sell', 'qty': '0.0', 'mark_price': 1.36, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"97c30361-c621-4e38-b516-b28a032d206e","orderLinkId":""},"retExtInfo":{},"time":1775637233717}', 'bot_id': 'Bot2'}]
- current_open_closed_state: closed_or_flat_after_recorded_exit
- max_favorable_excursion: not available in current local review pack
- max_adverse_excursion: not available in current local review pack
- notes: ['Break-even events recorded after entry', 'Exit events recorded after entry']

### Trade 2: Bot1 STXUSDT LONG
- signal_time: 2026-04-07T23:45:02.947Z
- entry_submission_time: 2026-04-07T23:45:04.471Z
- entry_status: submitted
- entry_qty: 232.6
- entry_notional_usd: 52.89324
- dca_events: [{'id': 16, 'created_at': '2026-04-07T23:45:04.472Z', 'symbol': 'STXUSDT', 'bot_id': 'Bot1', 'stage_name': 'initial_entry_50', 'delay_seconds': 0, 'qty': '232.6', 'status': 'submitted', 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"5d638cfa-5d32-4778-bcc1-fd7394cf390b","orderLinkId":""},"retExtInfo":{},"time":1775605504367}'}, {'id': 17, 'created_at': '2026-04-07T23:46:04.705Z', 'symbol': 'STXUSDT', 'bot_id': 'Bot1', 'stage_name': 'dca_add_entry', 'delay_seconds': 60, 'qty': '232.7', 'status': 'submitted', 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"f9f437a6-74fc-4b07-a941-da49811e65f5","orderLinkId":""},"retExtInfo":{},"time":1775605564600}'}]
- break_even_events: []
- exit_events: []
- current_open_closed_state: no_recorded_exit_in_db_window
- max_favorable_excursion: not available in current local review pack
- max_adverse_excursion: not available in current local review pack
- notes: []

### Trade 3: Bot4 CRVUSDT LONG
- signal_time: 2026-04-08T00:00:13.522Z
- entry_submission_time: 2026-04-08T00:00:14.625Z
- entry_status: submitted
- entry_qty: 221.1
- entry_notional_usd: 49.614839999999994
- dca_events: [{'id': 18, 'created_at': '2026-04-08T00:00:14.626Z', 'symbol': 'CRVUSDT', 'bot_id': 'Bot4', 'stage_name': 'initial_entry_50', 'delay_seconds': 0, 'qty': '221.1', 'status': 'submitted', 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"81209686-0e92-4cf7-93ba-9273fb6e800b","orderLinkId":""},"retExtInfo":{},"time":1775606414520}'}, {'id': 19, 'created_at': '2026-04-08T00:01:14.634Z', 'symbol': 'CRVUSDT', 'bot_id': 'Bot4', 'stage_name': 'dca_add_entry', 'delay_seconds': 60, 'qty': '221.1', 'status': 'skipped_break_even_armed_take_profit_started', 'response_json': '{"skipped":true,"reasons":["break_even_armed","take_profit_started"]}'}]
- break_even_events: [{'id': 3, 'created_at': '2026-04-08T00:00:20.146Z', 'symbol': 'CRVUSDT', 'event_type': 'closed_at_break_even', 'trigger_percent': 3.24, 'side': 'Buy', 'entry_price': 0.2245, 'mark_price': 0.2245, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"14512549-41ac-4d60-960f-4fe289574bca","orderLinkId":""},"retExtInfo":{},"time":1775606420037}', 'bot_id': 'Bot4'}]
- exit_events: [{'id': 18, 'created_at': '2026-04-08T00:00:20.143Z', 'symbol': 'CRVUSDT', 'exit_reason': 'break_even', 'trigger_percent': 3.24, 'close_percent': 100.0, 'side': 'Sell', 'qty': '221.1', 'mark_price': 0.2245, 'response_json': '{"retCode":0,"retMsg":"OK","result":{"orderId":"14512549-41ac-4d60-960f-4fe289574bca","orderLinkId":""},"retExtInfo":{},"time":1775606420037}', 'bot_id': 'Bot4'}]
- current_open_closed_state: closed_or_flat_after_recorded_exit
- max_favorable_excursion: not available in current local review pack
- max_adverse_excursion: not available in current local review pack
- notes: ['Break-even events recorded after entry', 'Exit events recorded after entry']

## 4. Chart / market context material
- token_price_chart: not embedded in this file; use exchange/chart review alongside the timelines below
- chart_ready_event_timeline: use the signal_time, entry_submission_time, dca_events, break_even_events, and exit_events listed above as chart markers
- regime_context_note: add manual labels during offline chart review such as trend / mixed / chop / near support / near resistance / continuation / reversal attempt

## 5. Cross-bot observations
- total_s2_signals_last_24h: 9
- total_entry_order_attempts_last_24h: 3
- total_exit_events_last_24h: 58
- total_break_even_events_last_24h: 2
- trend_vs_chop_patterns: requires combined offline chart review; not inferred automatically here
- overtrading_flip_behaviour: infer from repeated entry/exit signal alternation in the per-bot sections
- management_logic_observations: recent live evidence includes Bot4 break-even behaviour, selective DCA policy, and bot-aware TP/SL/BE management fixes in the current runtime path
- early_regime_strategy_hypotheses: use per-trade chart review plus the per-bot TP/SL/BE setup to assess whether each bot behaves better in trend, mixed, or chop conditions

## 6. Source notes
- this file is built from S2 local runtime/db/config sources only
- TradingView signal lists are not independently reconciled here beyond what S2 persisted
- chart images are not auto-embedded; offline review should pair this file with exchange/TV charts
