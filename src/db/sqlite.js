const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDatabase(dbPath) {
  ensureParentDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      request_path TEXT NOT NULL,
      method TEXT NOT NULL,
      auth_ok INTEGER NOT NULL,
      parse_ok INTEGER NOT NULL,
      raw_body TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS normalized_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      signal TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      raw_input TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS price_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      symbol TEXT NOT NULL,
      last_price REAL NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      signal TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL,
      qty TEXT NOT NULL,
      notional_usd REAL NOT NULL,
      status TEXT NOT NULL,
      response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS exit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      bot_id TEXT NOT NULL DEFAULT 'Bot1',
      symbol TEXT NOT NULL,
      exit_reason TEXT NOT NULL,
      trigger_percent REAL NOT NULL,
      close_percent REAL NOT NULL,
      side TEXT NOT NULL,
      qty TEXT NOT NULL,
      mark_price REAL NOT NULL,
      response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS break_even_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      bot_id TEXT NOT NULL DEFAULT 'Bot1',
      symbol TEXT NOT NULL,
      event_type TEXT NOT NULL,
      trigger_percent REAL NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL,
      response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS staged_entry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      symbol TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      stage_name TEXT NOT NULL,
      delay_seconds INTEGER NOT NULL,
      qty TEXT NOT NULL,
      status TEXT NOT NULL,
      response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS dca_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      event_type TEXT NOT NULL,
      candle_delay INTEGER NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS heartbeat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      source TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS trade_state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_key TEXT NOT NULL,
      state TEXT NOT NULL,
      level_name TEXT,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS s3_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scored_at TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      signal TEXT NOT NULL,
      score INTEGER NOT NULL,
      components_json TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      data_available INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS native_sl_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      event_type TEXT NOT NULL,
      sl_price TEXT NOT NULL,
      sl_percent REAL,
      side TEXT,
      response_json TEXT
    );

    CREATE TABLE IF NOT EXISTS signal_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      s6_directive TEXT,
      conviction_score INTEGER,
      analysis_text TEXT,
      chart_image_path TEXT,
      processed_at TEXT NOT NULL
    );
  `);

  const ensureColumn = (tableName, columnName, columnSql) => {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some(column => column.name === columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
    }
  };

  ensureColumn('exit_events', 'bot_id', "TEXT NOT NULL DEFAULT 'Bot1'");
  ensureColumn('break_even_events', 'bot_id', "TEXT NOT NULL DEFAULT 'Bot1'");
}

function buildPersistence(db) {
  const insertWebhookEvent = db.prepare(`
    INSERT INTO raw_webhook_events (
      received_at, request_path, method, auth_ok, parse_ok, raw_body, error_message
    ) VALUES (
      @received_at, @request_path, @method, @auth_ok, @parse_ok, @raw_body, @error_message
    )
  `);

  const insertNormalizedSignal = db.prepare(`
    INSERT INTO normalized_signals (
      received_at, signal, bot_id, raw_input
    ) VALUES (
      @received_at, @signal, @bot_id, @raw_input
    )
  `);

  const findRecentNormalizedSignalStmt = db.prepare(`
    SELECT * FROM normalized_signals
    WHERE signal = @signal
      AND bot_id = @bot_id
      AND received_at >= datetime('now', '-' || @window_seconds || ' seconds')
    ORDER BY id DESC
    LIMIT 1
  `);

  const insertSystemEvent = db.prepare(`
    INSERT INTO system_events (
      created_at, level, event_type, message, details_json
    ) VALUES (
      @created_at, @level, @event_type, @message, @details_json
    )
  `);

  const insertPriceTick = db.prepare(`
    INSERT INTO price_ticks (
      received_at, symbol, last_price, source
    ) VALUES (
      @received_at, @symbol, @last_price, @source
    )
  `);

  const insertOrderAttempt = db.prepare(`
    INSERT INTO order_attempts (
      created_at, signal, bot_id, symbol, side, order_type, qty, notional_usd, status, response_json
    ) VALUES (
      @created_at, @signal, @bot_id, @symbol, @side, @order_type, @qty, @notional_usd, @status, @response_json
    )
  `);

  const insertExitEvent = db.prepare(`
    INSERT INTO exit_events (
      created_at, bot_id, symbol, exit_reason, trigger_percent, close_percent, side, qty, mark_price, response_json
    ) VALUES (
      @created_at, @bot_id, @symbol, @exit_reason, @trigger_percent, @close_percent, @side, @qty, @mark_price, @response_json
    )
  `);

  const insertBreakEvenEvent = db.prepare(`
    INSERT INTO break_even_events (
      created_at, bot_id, symbol, event_type, trigger_percent, side, entry_price, mark_price, response_json
    ) VALUES (
      @created_at, @bot_id, @symbol, @event_type, @trigger_percent, @side, @entry_price, @mark_price, @response_json
    )
  `);

  const insertStagedEntryEvent = db.prepare(`
    INSERT INTO staged_entry_events (
      created_at, symbol, bot_id, stage_name, delay_seconds, qty, status, response_json
    ) VALUES (
      @created_at, @symbol, @bot_id, @stage_name, @delay_seconds, @qty, @status, @response_json
    )
  `);

  const insertDcaEvent = db.prepare(`
    INSERT INTO dca_events (
      created_at, bot_id, symbol, event_type, candle_delay, status, details_json
    ) VALUES (
      @created_at, @bot_id, @symbol, @event_type, @candle_delay, @status, @details_json
    )
  `);

  const insertHeartbeatEvent = db.prepare(`
    INSERT INTO heartbeat_events (
      received_at, source, raw_input, status, details_json
    ) VALUES (
      @received_at, @source, @raw_input, @status, @details_json
    )
  `);

  const insertTradeStateEvent = db.prepare(`
    INSERT INTO trade_state_events (
      created_at, trade_id, bot_id, symbol, action_type, action_key, state, level_name, details_json
    ) VALUES (
      @created_at, @trade_id, @bot_id, @symbol, @action_type, @action_key, @state, @level_name, @details_json
    )
  `);

  const insertS3Score = db.prepare(`
    INSERT INTO s3_scores (
      scored_at, bot_id, symbol, signal, score, components_json, latency_ms, data_available
    ) VALUES (
      @scored_at, @bot_id, @symbol, @signal, @score, @components_json, @latency_ms, @data_available
    )
  `);

  const insertNativeSLEvent = db.prepare(`
    INSERT INTO native_sl_events (
      created_at, bot_id, symbol, event_type, sl_price, sl_percent, side, response_json
    ) VALUES (
      @created_at, @bot_id, @symbol, @event_type, @sl_price, @sl_percent, @side, @response_json
    )
  `);

  const getRecentExitEventsForBotStmt = db.prepare(`
    SELECT * FROM exit_events
    WHERE bot_id = @bot_id
    ORDER BY id DESC
    LIMIT @limit
  `);

  const findTradeStateEventByKeyStmt = db.prepare(`
    SELECT * FROM trade_state_events
    WHERE trade_id = @trade_id
      AND action_key = @action_key
    ORDER BY id DESC
    LIMIT 1
  `);

  const getTradeStateEventsStmt = db.prepare(`
    SELECT * FROM trade_state_events
    ORDER BY id ASC
  `);

  return {
    recordWebhookEvent(event) {
      return insertWebhookEvent.run(event);
    },
    recordNormalizedSignal(signal) {
      return insertNormalizedSignal.run(signal);
    },
    findRecentNormalizedSignal(params) {
      return findRecentNormalizedSignalStmt.get(params) || null;
    },
    recordSystemEvent(event) {
      return insertSystemEvent.run({
        ...event,
        details_json: event.details_json || null,
      });
    },
    recordPriceTick(tick) {
      return insertPriceTick.run(tick);
    },
    recordOrderAttempt(attempt) {
      return insertOrderAttempt.run(attempt);
    },
    recordExitEvent(event) {
      return insertExitEvent.run(event);
    },
    recordBreakEvenEvent(event) {
      return insertBreakEvenEvent.run(event);
    },
    recordStagedEntryEvent(event) {
      return insertStagedEntryEvent.run(event);
    },
    recordDcaEvent(event) {
      return insertDcaEvent.run(event);
    },
    recordHeartbeatEvent(event) {
      return insertHeartbeatEvent.run({
        ...event,
        details_json: event.details_json || null,
      });
    },
    recordTradeStateEvent(event) {
      return insertTradeStateEvent.run({
        ...event,
        level_name: event.level_name || null,
        details_json: event.details_json || null,
      });
    },
    findTradeStateEventByKey(params) {
      return findTradeStateEventByKeyStmt.get(params) || null;
    },
    getWebhookEvents() {
      return db.prepare('SELECT * FROM raw_webhook_events ORDER BY id ASC').all();
    },
    getNormalizedSignals() {
      return db.prepare('SELECT * FROM normalized_signals ORDER BY id ASC').all();
    },
    getSystemEvents() {
      return db.prepare('SELECT * FROM system_events ORDER BY id ASC').all();
    },
    getPriceTicks() {
      return db.prepare('SELECT * FROM price_ticks ORDER BY id ASC').all();
    },
    getOrderAttempts() {
      return db.prepare('SELECT * FROM order_attempts ORDER BY id ASC').all();
    },
    getExitEvents() {
      return db.prepare('SELECT * FROM exit_events ORDER BY id ASC').all();
    },
    getBreakEvenEvents() {
      return db.prepare('SELECT * FROM break_even_events ORDER BY id ASC').all();
    },
    getStagedEntryEvents() {
      return db.prepare('SELECT * FROM staged_entry_events ORDER BY id ASC').all();
    },
    getDcaEvents() {
      return db.prepare('SELECT * FROM dca_events ORDER BY id ASC').all();
    },
    getHeartbeatEvents() {
      return db.prepare('SELECT * FROM heartbeat_events ORDER BY id ASC').all();
    },
    getTradeStateEvents() {
      return getTradeStateEventsStmt.all();
    },
    getLatestHeartbeatEvent() {
      return db.prepare('SELECT * FROM heartbeat_events ORDER BY id DESC LIMIT 1').get() || null;
    },
    recordS3Score(result) {
      return insertS3Score.run({
        scored_at: result.scoredAt,
        bot_id: result.botId,
        symbol: result.symbol,
        signal: result.signal,
        score: result.score,
        components_json: JSON.stringify(result.components),
        latency_ms: result.latencyMs,
        data_available: result.dataAvailable ? 1 : 0,
      });
    },
    getS3Scores() {
      return db.prepare('SELECT * FROM s3_scores ORDER BY id DESC').all();
    },
    getRecentExitEventsForBot({ bot_id, limit }) {
      return getRecentExitEventsForBotStmt.all({ bot_id, limit });
    },
    recordNativeSLEvent(event) {
      return insertNativeSLEvent.run({
        ...event,
        sl_percent: event.sl_percent ?? null,
        side: event.side || null,
        response_json: event.response_json || null,
      });
    },
  };
}

module.exports = {
  createDatabase,
  initSchema,
  buildPersistence,
};
