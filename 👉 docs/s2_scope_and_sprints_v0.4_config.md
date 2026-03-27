S2 Trading System – Scope & Sprint Plan (v0.4 Config-Driven)
1. Scope Summary
S2 is a controlled, incremental trading execution system using TradingView alerts and Bybit Testnet. The system is fully config-driven, allowing easy changes to tokens, alerts, TP/SL/BE settings without code changes. Built in 30–60 minute sprints with strong focus on safety, observability, and step-by-step validation.
2. Core Design Principle (NEW)
All variable parameters MUST be stored in a central settings file from the start.  This includes: - Trading pairs (e.g., BTCUSDT) - Signal types (ENTER/EXIT LONG/SHORT) - Position sizing - Leverage - Stop Loss values - Take Profit levels - Break-even trigger levels - DCA levels  No hardcoding allowed in logic. All sprints must read from settings.
3. Sprint Structure Rules
- Each sprint = 30–60 minutes - One clear outcome - Must be testable - Must produce a GitHub commit - Must update Kanban status - Do NOT combine tasks 
4. Detailed Sprint Plan
Sprint 1 – Scope Review
- Q reads scope
- Confirms config-driven approach
- Outputs risks and validation
Sprint 2 – Load Sprints
- Populate Kanban
- Confirm sprint structure
- No coding yet
Sprint 3 – Settings File (CRITICAL)
- Create central config file (JSON)
- Define structure for all parameters
- Load settings into system
- Test read access
- No trading logic yet
Sprint 4 – Webhook Intake
- Receive TradingView alerts
- Support ENTER/EXIT LONG/SHORT
- Store in SQLite
- Use symbol from config
Sprint 5 – Price Monitoring
- Connect to Bybit WebSocket
- Subscribe to configured symbol
- Log price during trade lifecycle
Sprint 6 – Execute Trade
- Use config for size, leverage
- Execute paper trade
- Record entry details
Sprint 7 – Trade Summary
- Track trade lifecycle
- Generate summary after close
- Use config thresholds where needed
Sprint 8 – Close Opposite Signal
- Close existing position before reverse
- Use config rules
- Log actions
Sprint 9 – Micro TP/SL
- Use config-defined 0.25% values
- Internal monitoring only
Sprint 10 – Stop Loss
- Replace micro SL with config SL
Sprint 11 – Take Profits
- Load TP levels from config
Sprint 12 – Move SL to BE
- Use config BE trigger
Sprint 13 – DCA
- Use config-defined levels
