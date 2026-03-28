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
  `);
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

  const insertSystemEvent = db.prepare(`
    INSERT INTO system_events (
      created_at, level, event_type, message, details_json
    ) VALUES (
      @created_at, @level, @event_type, @message, @details_json
    )
  `);

  return {
    recordWebhookEvent(event) {
      return insertWebhookEvent.run(event);
    },
    recordNormalizedSignal(signal) {
      return insertNormalizedSignal.run(signal);
    },
    recordSystemEvent(event) {
      return insertSystemEvent.run({
        ...event,
        details_json: event.details_json || null,
      });
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
  };
}

module.exports = {
  createDatabase,
  initSchema,
  buildPersistence,
};
