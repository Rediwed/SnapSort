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
      performance_profile TEXT,                       -- null = use global defaults
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

  /* Migration: add performance_profile column to existing jobs tables */
  try {
    const cols = db.pragma('table_info(jobs)').map((c) => c.name);
    if (!cols.includes('performance_profile')) {
      db.exec('ALTER TABLE jobs ADD COLUMN performance_profile TEXT');
    }
  } catch { /* table doesn't exist yet — CREATE above handled it */ }

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
      dpi           INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at  TEXT,
      overridden_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photos_job    ON photos(job_id);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_hash   ON photos(hash);
  `);

  /* Migration: add processed_at / overridden_at columns to existing photos tables */
  try {
    const photoCols = db.pragma('table_info(photos)').map((c) => c.name);
    if (!photoCols.includes('processed_at')) {
      db.exec('ALTER TABLE photos ADD COLUMN processed_at TEXT');
    }
    if (!photoCols.includes('overridden_at')) {
      db.exec('ALTER TABLE photos ADD COLUMN overridden_at TEXT');
    }
    if (!photoCols.includes('dpi')) {
      db.exec('ALTER TABLE photos ADD COLUMN dpi INTEGER');
    }
  } catch { /* table doesn't exist yet — CREATE above handled it */ }

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
    CREATE INDEX IF NOT EXISTS idx_dup_job   ON duplicates(job_id);
    CREATE INDEX IF NOT EXISTS idx_dup_photo ON duplicates(photo_id);
  `);

  /* ---- settings ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  /* ---- performance_profiles ---- */
  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_profiles (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      description     TEXT,
      max_workers     INTEGER NOT NULL DEFAULT 4,
      batch_size      INTEGER NOT NULL DEFAULT 25,
      hash_bytes      INTEGER NOT NULL DEFAULT 4096,
      concurrent_copies INTEGER NOT NULL DEFAULT 2,
      enable_multithreading INTEGER NOT NULL DEFAULT 1,
      sequential_processing INTEGER NOT NULL DEFAULT 0,
      is_builtin      INTEGER NOT NULL DEFAULT 0
    );
  `);

  /* Seed built-in profiles if empty */
  const profileCount = db.prepare('SELECT COUNT(*) AS c FROM performance_profiles').get();
  if (profileCount.c === 0) {
    const insertProfile = db.prepare(`
      INSERT INTO performance_profiles (id, name, description, max_workers, batch_size, hash_bytes, concurrent_copies, enable_multithreading, sequential_processing, is_builtin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const builtins = [
      ['nvme_gen4',     'NVMe Gen4 SSD',   'High-end NVMe Gen4 SSD — maximum parallelism',   16, 100, 16384, 8, 1, 0],
      ['nvme_gen3',     'NVMe Gen3 SSD',   'NVMe Gen3 SSD — high parallelism',                12,  75,  8192, 6, 1, 0],
      ['sata_ssd',      'SATA SSD',        'SATA SSD — balanced speed and concurrency',         8,  50,  4096, 4, 1, 0],
      ['hdd_7200rpm',   '7200 RPM HDD',    '7200 RPM HDD — optimised for sequential access',    1,  10,  4096, 1, 0, 1],
      ['hdd_5400rpm',   '5400 RPM HDD',    '5400 RPM HDD — slower mechanical drive',            1,   5,  2048, 1, 0, 1],
      ['usb_external',  'USB External',    'External USB drive — conservative settings',         2,  15,  2048, 1, 0, 1],
      ['default',       'Default',         'Default conservative settings',                      4,  25,  4096, 2, 1, 0],
    ];
    const tx2 = db.transaction(() => {
      for (const [id, name, desc, mw, bs, hb, cc, mt, sp] of builtins) {
        insertProfile.run(id, name, desc, mw, bs, hb, cc, mt, sp);
      }
    });
    tx2();
  }

  /* Seed default settings — INSERT OR IGNORE ensures new keys are added
     to existing databases without overwriting user-modified values */
  {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    const defaults = {
      min_width: '600',
      min_height: '600',
      min_filesize: '51200',
      dedup_strict_threshold: '90',
      dedup_log_threshold: '70',
      enable_fast_hash: 'true',
      fast_hash_bytes: '8192',
      enable_csv_log: 'false',
      /* Performance defaults */
      enable_multithreading: 'true',
      max_worker_threads: '4',
      parallel_hash_workers: '4',
      batch_size: '25',
      hash_bytes: '4096',
      concurrent_copies: '2',
      sequential_processing: 'false',
      default_performance_profile: 'default',
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
