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

function createJob(db, { sourceDir, destDir, mode = 'normal', minWidth = 600, minHeight = 600, minFilesize = 51200, performanceProfile = null }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO jobs (id, source_dir, dest_dir, mode, min_width, min_height, min_filesize, performance_profile)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sourceDir, destDir, mode, minWidth, minHeight, minFilesize, performanceProfile);
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

function listPhotoPaths(db, jobId) {
  return db.prepare(
    "SELECT dest_path FROM photos WHERE job_id = ? AND dest_path IS NOT NULL AND status = 'copied'"
  ).all(jobId).map((r) => r.dest_path);
}

/* ================================================================== */
/*  PHOTOS                                                             */
/* ================================================================== */

function insertPhoto(db, photo) {
  const id = photo.id || uuidv4();
  db.prepare(`
    INSERT INTO photos (id, job_id, src_path, dest_path, filename, extension, file_size, width, height, date_taken, status, skip_reason, hash, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, photo.jobId, photo.srcPath, photo.destPath || null,
    photo.filename, photo.extension, photo.fileSize || 0,
    photo.width || null, photo.height || null, photo.dateTaken || null,
    photo.status || 'pending', photo.skipReason || null, photo.hash || null,
    new Date().toISOString()
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

function listDuplicates(db, { jobId, resolution, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM duplicates WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  if (resolution) { sql += ' AND COALESCE(resolution, \'undecided\') = ?'; params.push(resolution); }
  sql += ' ORDER BY similarity DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function resolveDuplicate(db, id, resolution) {
  db.prepare('UPDATE duplicates SET resolution = ? WHERE id = ?').run(resolution, id);
}

function countDuplicates(db, { jobId, resolution } = {}) {
  let sql = 'SELECT COUNT(*) AS count FROM duplicates WHERE 1=1';
  const params = [];
  if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
  if (resolution) { sql += ' AND COALESCE(resolution, \'undecided\') = ?'; params.push(resolution); }
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
/*  PERFORMANCE PROFILES                                               */
/* ================================================================== */

function listProfiles(db) {
  return db.prepare('SELECT * FROM performance_profiles ORDER BY is_builtin DESC, name ASC').all();
}

function getProfile(db, id) {
  return db.prepare('SELECT * FROM performance_profiles WHERE id = ?').get(id) || null;
}

function createProfile(db, { id, name, description, max_workers, batch_size, hash_bytes, concurrent_copies, enable_multithreading, sequential_processing }) {
  const profileId = id || uuidv4();
  db.prepare(`
    INSERT INTO performance_profiles (id, name, description, max_workers, batch_size, hash_bytes, concurrent_copies, enable_multithreading, sequential_processing, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(profileId, name, description || '', max_workers || 4, batch_size || 25, hash_bytes || 4096, concurrent_copies || 2, enable_multithreading ? 1 : 0, sequential_processing ? 1 : 0);
  return getProfile(db, profileId);
}

function updateProfile(db, id, updates) {
  const sets = [];
  const params = [];
  const allowed = ['name', 'description', 'max_workers', 'batch_size', 'hash_bytes', 'concurrent_copies', 'enable_multithreading', 'sequential_processing'];
  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      params.push(key === 'enable_multithreading' || key === 'sequential_processing' ? (value ? 1 : 0) : value);
    }
  }
  if (sets.length === 0) return getProfile(db, id);
  params.push(id);
  db.prepare(`UPDATE performance_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getProfile(db, id);
}

function deleteProfile(db, id) {
  // Don't delete built-in profiles
  db.prepare('DELETE FROM performance_profiles WHERE id = ? AND is_builtin = 0').run(id);
}

/* ================================================================== */
/*  PHOTO OVERRIDES                                                    */
/* ================================================================== */

function getPhotosByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM photos WHERE id IN (${placeholders})`).all(...ids);
}

function updatePhotoOverride(db, id, { status, destPath, overriddenAt }) {
  db.prepare(`
    UPDATE photos SET status = ?, dest_path = ?, skip_reason = NULL, overridden_at = ?
    WHERE id = ?
  `).run(status, destPath || null, overriddenAt, id);
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
  insertPhoto, listPhotos, countPhotos, getPhoto, listPhotoPaths,
  getPhotosByIds, updatePhotoOverride,
  insertDuplicate, listDuplicates, resolveDuplicate, countDuplicates,
  getAllSettings, getSetting, upsertSetting, bulkUpsertSettings,
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getDashboardStats,
};
