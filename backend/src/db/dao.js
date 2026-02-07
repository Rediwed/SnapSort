/**
 * Data-access helpers for jobs, photos, duplicates, and settings.
 *
 * Every function takes a `db` (better-sqlite3 instance) as its first argument
 * so it stays stateless and easy to test.
 */

const { v4: uuidv4 } = require('uuid');

/* ================================================================== */
/*  JOBS                                                               */
/* ================================================================== */

function createJob(db, { sourceDir, destDir, mode = 'normal', minWidth = 600, minHeight = 600, minFilesize = 51200 }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO jobs (id, source_dir, dest_dir, mode, min_width, min_height, min_filesize)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sourceDir, destDir, mode, minWidth, minHeight, minFilesize);
  return getJob(db, id);
}

function getJob(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null;
}

function listJobs(db, { limit = 50, offset = 0, status } = {}) {
  let sql = 'SELECT * FROM jobs';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function updateJobStatus(db, id, status, extra = {}) {
  const sets = ['status = ?'];
  const params = [status];

  for (const [key, value] of Object.entries(extra)) {
    /* Only allow known columns */
    const allowed = ['processed', 'copied', 'skipped', 'errors', 'total_files', 'total_bytes', 'error_message', 'started_at', 'finished_at'];
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  params.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getJob(db, id);
}

function deleteJob(db, id) {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

/* ================================================================== */
/*  PHOTOS                                                             */
/* ================================================================== */

function insertPhoto(db, photo) {
  const id = photo.id || uuidv4();
  db.prepare(`
    INSERT INTO photos (id, job_id, src_path, dest_path, filename, extension, file_size, width, height, date_taken, status, skip_reason, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, photo.jobId, photo.srcPath, photo.destPath || null,
    photo.filename, photo.extension, photo.fileSize || 0,
    photo.width || null, photo.height || null, photo.dateTaken || null,
    photo.status || 'pending', photo.skipReason || null, photo.hash || null
  );
  return id;
}

function listPhotos(db, { jobId, status, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM photos WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function countPhotos(db, { jobId, status } = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM photos WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  return db.prepare(sql).get(...params).count;
}

function getPhoto(db, id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id) || null;
}

/* ================================================================== */
/*  DUPLICATES                                                         */
/* ================================================================== */

function insertDuplicate(db, dup) {
  const id = dup.id || uuidv4();
  db.prepare(`
    INSERT INTO duplicates (id, job_id, photo_id, matched_photo_id, src_path, matched_path, similarity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, dup.jobId, dup.photoId, dup.matchedPhotoId || null, dup.srcPath, dup.matchedPath || null, dup.similarity);
  return id;
}

function listDuplicates(db, { jobId, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM duplicates WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  sql += ' ORDER BY similarity DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function resolveDuplicate(db, id, resolution) {
  db.prepare('UPDATE duplicates SET resolution = ? WHERE id = ?').run(resolution, id);
}

function countDuplicates(db, { jobId } = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM duplicates WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  return db.prepare(sql).get(...params).count;
}

/* ================================================================== */
/*  SETTINGS                                                           */
/* ================================================================== */

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const row of rows) obj[row.key] = row.value;
  return obj;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function upsertSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

function bulkUpsertSettings(db, pairs) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(pairs)) {
      stmt.run(k, String(v));
    }
  });
  tx();
}

/* ================================================================== */
/*  DASHBOARD                                                          */
/* ================================================================== */

function getDashboardStats(db) {
  const totalJobs = db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
  const activeJobs = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending','running')").get().c;
  const totalPhotos = db.prepare('SELECT COUNT(*) AS c FROM photos').get().c;
  const copiedPhotos = db.prepare("SELECT COUNT(*) AS c FROM photos WHERE status = 'copied'").get().c;
  const skippedPhotos = db.prepare("SELECT COUNT(*) AS c FROM photos WHERE status = 'skipped'").get().c;
  const errorPhotos = db.prepare("SELECT COUNT(*) AS c FROM photos WHERE status = 'error'").get().c;
  const totalDuplicates = db.prepare('SELECT COUNT(*) AS c FROM duplicates').get().c;
  const totalBytes = db.prepare('SELECT COALESCE(SUM(total_bytes),0) AS s FROM jobs').get().s;

  const recentJobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5').all();

  return {
    totalJobs,
    activeJobs,
    totalPhotos,
    copiedPhotos,
    skippedPhotos,
    errorPhotos,
    totalDuplicates,
    totalBytes,
    recentJobs,
  };
}

module.exports = {
  createJob, getJob, listJobs, updateJobStatus, deleteJob,
  insertPhoto, listPhotos, countPhotos, getPhoto,
  insertDuplicate, listDuplicates, resolveDuplicate, countDuplicates,
  getAllSettings, getSetting, upsertSetting, bulkUpsertSettings,
  getDashboardStats,
};
