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
const fs = require('fs');
const { listJobs } = require('./db/dao');

/**
 * Canonicalize a path, resolving symlinks. For paths that do not exist yet
 * (e.g. a destination file about to be written), the deepest existing ancestor
 * is realpath'd and the missing tail re-appended, so a symlinked prefix cannot
 * be used to smuggle a write into a source directory.
 */
function canonicalize(p) {
  const resolved = path.resolve(p);
  let current = resolved;
  const tail = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved; // nothing along the path exists
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Collect every source directory that has ever been used in a job.
 * Returns a Set of canonical absolute paths.
 */
function getSourceDirs(db) {
  const jobs = listJobs(db, { limit: 10000 });
  const dirs = new Set();
  for (const job of jobs) {
    if (job.source_dir) dirs.add(canonicalize(job.source_dir));
  }
  return dirs;
}

/**
 * Returns true if `filePath` lives inside any known source directory.
 * Comparison is done on canonical (symlink-resolved) paths.
 */
function isInSourceDir(db, filePath) {
  const resolved = canonicalize(filePath);
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

module.exports = { isInSourceDir, assertNotInSource, getSourceDirs, canonicalize };
