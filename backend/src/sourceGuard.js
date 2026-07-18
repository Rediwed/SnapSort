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
const { listSourceDirs } = require('./db/dao');

function normalizeCase(filePath) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

/**
 * Resolve symlinks and platform aliases even when the final path does not exist.
 * The deepest existing ancestor is canonicalized and missing path components are
 * appended afterward.
 */
function canonicalizePath(filePath) {
  const absolutePath = path.resolve(filePath);
  const missingComponents = [];
  let existingPath = absolutePath;

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) return normalizeCase(absolutePath);
    missingComponents.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  try {
    const canonicalAncestor = fs.realpathSync.native(existingPath);
    return normalizeCase(path.join(canonicalAncestor, ...missingComponents));
  } catch {
    return normalizeCase(absolutePath);
  }
}

function containsPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

/**
 * Collect every source directory that has ever been used in a job.
 * Returns a Set of resolved absolute paths.
 */
function getSourceDirs(db) {
  const dirs = new Set();
  for (const sourceDir of listSourceDirs(db)) {
    dirs.add(canonicalizePath(sourceDir));
  }
  return dirs;
}

/**
 * Returns true if `filePath` lives inside any known source directory.
 */
function isInSourceDir(db, filePath) {
  const resolved = canonicalizePath(filePath);
  const sourceDirs = getSourceDirs(db);
  for (const dir of sourceDirs) {
    if (containsPath(dir, resolved)) return true;
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

module.exports = { canonicalizePath, isInSourceDir, assertNotInSource, getSourceDirs };
