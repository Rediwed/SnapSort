const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BenchmarkValidationError,
  validateBenchmarkRequest,
} = require('../src/services/benchmarkConfig');

function withDirectories(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-benchmark-config-'));
  const sourcePath = path.join(root, 'source');
  const destPath = path.join(root, 'destination');
  fs.mkdirSync(sourcePath);
  fs.mkdirSync(destPath);
  try {
    callback({ root, sourcePath, destPath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('accepts canonical disjoint directories and defaults', () => {
  withDirectories(({ sourcePath, destPath }) => {
    assert.deepEqual(validateBenchmarkRequest({ sourcePath, destPath }), {
      sourcePath: fs.realpathSync(sourcePath),
      destPath: fs.realpathSync(destPath),
      fileCount: 20,
      fileSizeMB: 5,
    });
  });
});

test('rejects executable expressions in numeric fields', () => {
  withDirectories(({ sourcePath, destPath }) => {
    assert.throws(
      () => validateBenchmarkRequest({
        sourcePath,
        destPath,
        fileCount: "1; __import__('os').system('touch /tmp/snapsort-pwned')",
      }),
      BenchmarkValidationError,
    );
  });
});

test('rejects benchmark sizes above the total data cap', () => {
  withDirectories(({ sourcePath, destPath }) => {
    assert.throws(
      () => validateBenchmarkRequest({ sourcePath, destPath, fileCount: 200, fileSizeMB: 100 }),
      /must not exceed 1024 MB/,
    );
  });
});

test('rejects nested source and destination directories', () => {
  withDirectories(({ sourcePath }) => {
    const nestedDestination = path.join(sourcePath, 'organized');
    fs.mkdirSync(nestedDestination);
    assert.throws(
      () => validateBenchmarkRequest({ sourcePath, destPath: nestedDestination }),
      /disjoint folders/,
    );
  });
});

test('rejects a symlink alias of the source directory', (t) => {
  if (process.platform === 'win32') t.skip('Symlink creation requires elevated privileges on Windows');
  withDirectories(({ root, sourcePath }) => {
    const aliasPath = path.join(root, 'source-alias');
    fs.symlinkSync(sourcePath, aliasPath, 'dir');
    assert.throws(
      () => validateBenchmarkRequest({ sourcePath, destPath: aliasPath }),
      /disjoint folders/,
    );
  });
});