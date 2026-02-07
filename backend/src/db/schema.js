/**
 * SQLite schema initialisation (better-sqlite3, WAL mode).
 *
 * Tables:
 *   jobs      – organizer runs (pending → running → done/error)
 *   photos    – every image discovered or copied
 *   duplicates – pairs flagged by the dedup engine
 *   settings  – key/value configuration store
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function initDb(dbPath) {
  /* Ensure the data directory exists */
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  /* Performance: WAL mode + synchronous NORMAL */
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  /* ---- jobs ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      source_dir    TEXT NOT NULL,
      dest_dir      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
      mode          TEXT NOT NULL DEFAULT 'normal',   -- normal | manual | resume
      min_width     INTEGER NOT NULL DEFAULT 600,
      min_height    INTEGER NOT NULL DEFAULT 600,
      min_filesize  INTEGER NOT NULL DEFAULT 51200,
      total_files   INTEGER NOT NULL DEFAULT 0,
      processed     INTEGER NOT NULL DEFAULT 0,
      copied        INTEGER NOT NULL DEFAULT 0,
      skipped       INTEGER NOT NULL DEFAULT 0,
      errors        INTEGER NOT NULL DEFAULT 0,
      total_bytes   INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      started_at    TEXT,
      finished_at   TEXT
    );
  `);

  /* ---- photos ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      src_path      TEXT NOT NULL,
      dest_path     TEXT,
      filename      TEXT NOT NULL,
      extension     TEXT NOT NULL,
      file_size     INTEGER NOT NULL DEFAULT 0,
      width         INTEGER,
      height        INTEGER,
      date_taken    TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',  -- pending | copied | skipped | error
      skip_reason   TEXT,
      hash          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_photos_job    ON photos(job_id);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_hash   ON photos(hash);
  `);

  /* ---- duplicates ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS duplicates (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      photo_id      TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      matched_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
      src_path      TEXT NOT NULL,
      matched_path  TEXT,
      similarity    REAL NOT NULL DEFAULT 0,
      resolution    TEXT,           -- keep | delete | undecided
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dup_job ON duplicates(job_id);
  `);

  /* ---- settings ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  /* Seed default settings if empty */
  const count = db.prepare('SELECT COUNT(*) AS c FROM settings').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    const defaults = {
      min_width: '600',
      min_height: '600',
      min_filesize: '51200',
      dedup_strict_threshold: '90',
      dedup_log_threshold: '70',
      enable_fast_hash: 'true',
      fast_hash_bytes: '8192',
      enable_csv_log: 'false',
    };
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(defaults)) {
        insert.run(k, v);
      }
    });
    tx();
  }

  return db;
}

module.exports = { initDb };
