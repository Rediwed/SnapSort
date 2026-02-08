/**
 * ⚠️  SOURCE SAFETY GUARD
 *
 * SnapSort's #1 invariant: source directories are STRICTLY READ-ONLY.
 * We never write to, modify, rename, move, or delete any file in a
 * source directory.  This module provides helpers that enforce that
 * guarantee across the entire backend.
 *
 * Every route that performs destructive file operations (unlink, write,
 * rename, rmdir) MUST call `assertNotInSource()` before proceeding.
 */

const path = require('path');
const { listJobs } = require('./db/dao');

/**
 * Collect every source directory that has ever been used in a job.
 * Returns a Set of resolved absolute paths.
 */
function getSourceDirs(db) {
  const jobs = listJobs(db, { limit: 10000 });
  const dirs = new Set();
  for (const job of jobs) {
    if (job.source_dir) dirs.add(path.resolve(job.source_dir));
  }
  return dirs;
}

/**
 * Returns true if `filePath` lives inside any known source directory.
 */
function isInSourceDir(db, filePath) {
  const resolved = path.resolve(filePath);
  const sourceDirs = getSourceDirs(db);
  for (const dir of sourceDirs) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) {
      return true;
    }
  }
  return false;
}

/**
 * Throws if `filePath` is inside a known source directory.
 * Call this before ANY destructive file operation.
 */
function assertNotInSource(db, filePath) {
  if (isInSourceDir(db, filePath)) {
    const msg = `SOURCE SAFETY VIOLATION: refusing to modify "${filePath}" — it is inside a source directory. SnapSort never writes to source directories.`;
    console.error(`🛑 ${msg}`);
    throw new Error(msg);
  }
}

module.exports = { isInSourceDir, assertNotInSource, getSourceDirs };
