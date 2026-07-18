const fs = require('fs');
const path = require('path');
const { canonicalizePath, pathIsWithin } = require('../sourceGuard');

const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
const PREVIEW_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff',
  '.heic', '.heif', '.avif',
]);
const METADATA_EXTENSIONS = new Set([
  ...PREVIEW_EXTENSIONS,
  '.cr2', '.nef', '.arw', '.rw2', '.orf', '.dng',
]);

class UnsafePhotoFileError extends Error {}

function validatePhotoFile(filePath, allowedRoot, allowedExtensions) {
  if (!filePath || !allowedRoot) {
    throw new UnsafePhotoFileError('Photo path is unavailable');
  }
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    throw new UnsafePhotoFileError('Photo file does not exist');
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new UnsafePhotoFileError('Photo path must be a regular non-symlink file');
  }
  if (stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
    throw new UnsafePhotoFileError('Photo file size is outside preview limits');
  }

  const canonicalPath = canonicalizePath(filePath);
  if (!pathIsWithin(allowedRoot, canonicalPath)) {
    throw new UnsafePhotoFileError('Photo path is outside its registered job root');
  }
  const extension = path.extname(canonicalPath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new UnsafePhotoFileError('Photo format is not permitted');
  }
  return canonicalPath;
}

function resolvePhotoFile(photo, job, allowedExtensions) {
  if (photo.dest_path && fs.existsSync(photo.dest_path)) {
    return validatePhotoFile(photo.dest_path, job.dest_dir, allowedExtensions);
  }
  return validatePhotoFile(photo.src_path, job.source_dir, allowedExtensions);
}

module.exports = {
  MAX_IMAGE_BYTES,
  METADATA_EXTENSIONS,
  PREVIEW_EXTENSIONS,
  UnsafePhotoFileError,
  resolvePhotoFile,
  validatePhotoFile,
};