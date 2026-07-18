'use strict';

/**
 * Validation for benchmark requests.
 *
 * Kept as a standalone, dependency-free module so it can be unit-tested
 * without spinning up Express. Every numeric field is coerced to a bounded
 * integer; anything else is rejected. This is the first line of defense that
 * makes it impossible for request fields to reach the benchmark engine as
 * anything other than validated integers.
 */

const LIMITS = {
  fileCount: { min: 1, max: 200, default: 20 },
  fileSizeMB: { min: 1, max: 256, default: 5 },
  repeats: { min: 1, max: 5, default: 1 },
};

function validateBoundedInt(value, name) {
  const { min, max, default: fallback } = LIMITS[name];
  if (value === undefined || value === null || value === '') return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  if (num < min || num > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return num;
}

/**
 * Validate & normalize a benchmark request body.
 * Returns { sourcePath, destPath, fileCount, fileSizeMB, repeats }.
 * Throws Error (with a user-safe message) on invalid input.
 */
function validateBenchmarkRequest(body) {
  const src = body && body.sourcePath;
  const dst = body && body.destPath;
  if (!src || typeof src !== 'string') throw new Error('sourcePath is required');
  if (!dst || typeof dst !== 'string') throw new Error('destPath is required');
  return {
    sourcePath: src,
    destPath: dst,
    fileCount: validateBoundedInt(body.fileCount, 'fileCount'),
    fileSizeMB: validateBoundedInt(body.fileSizeMB, 'fileSizeMB'),
    repeats: validateBoundedInt(body.repeats, 'repeats'),
  };
}

module.exports = { validateBenchmarkRequest, validateBoundedInt, LIMITS };
