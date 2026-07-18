const fs = require('fs');
const path = require('path');

const MAX_FILE_COUNT = 200;
const MAX_FILE_SIZE_MB = 100;
const MAX_TOTAL_MB = 1024;

class BenchmarkValidationError extends Error {}

function parseInteger(name, value, defaultValue, maximum) {
  const candidate = value === undefined ? defaultValue : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate)) {
    throw new BenchmarkValidationError(`${name} must be an integer`);
  }
  if (candidate < 1 || candidate > maximum) {
    throw new BenchmarkValidationError(`${name} must be between 1 and ${maximum}`);
  }
  return candidate;
}

function canonicalDirectory(label, value, accessMode) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BenchmarkValidationError(`${label} is required`);
  }

  try {
    const canonicalPath = fs.realpathSync(value);
    if (!fs.statSync(canonicalPath).isDirectory()) {
      throw new BenchmarkValidationError(`${label} is not a directory`);
    }
    fs.accessSync(canonicalPath, accessMode);
    return canonicalPath;
  } catch (error) {
    if (error instanceof BenchmarkValidationError) throw error;
    throw new BenchmarkValidationError(`${label} is not accessible`);
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

function pathsOverlap(leftPath, rightPath) {
  return containsPath(leftPath, rightPath) || containsPath(rightPath, leftPath);
}

function validateBenchmarkRequest(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BenchmarkValidationError('Body must be a JSON object');
  }

  const fileCount = parseInteger('fileCount', body.fileCount, 20, MAX_FILE_COUNT);
  const fileSizeMB = parseInteger('fileSizeMB', body.fileSizeMB, 5, MAX_FILE_SIZE_MB);
  if (fileCount * fileSizeMB > MAX_TOTAL_MB) {
    throw new BenchmarkValidationError(`Benchmark data must not exceed ${MAX_TOTAL_MB} MB`);
  }

  const sourcePath = canonicalDirectory('sourcePath', body.sourcePath, fs.constants.R_OK);
  const destPath = canonicalDirectory(
    'destPath',
    body.destPath,
    fs.constants.R_OK | fs.constants.W_OK,
  );
  if (pathsOverlap(sourcePath, destPath)) {
    throw new BenchmarkValidationError('Source and destination must be disjoint folders');
  }

  return { sourcePath, destPath, fileCount, fileSizeMB };
}

module.exports = {
  BenchmarkValidationError,
  MAX_FILE_COUNT,
  MAX_FILE_SIZE_MB,
  MAX_TOTAL_MB,
  pathsOverlap,
  validateBenchmarkRequest,
};