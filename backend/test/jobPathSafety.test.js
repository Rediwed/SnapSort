const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDb } = require('../src/db/schema');
const { createJob } = require('../src/db/dao');
const {
  assertNoActiveJobConflict,
  validateNewJobPaths,
} = require('../src/services/jobPathSafety');

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-job-paths-'));
  const db = initDb(path.join(root, 'test.db'));
  try {
    callback({ db, root });
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('canonicalizes and accepts disjoint new job paths', () => {
  withFixture(({ db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const result = validateNewJobPaths(db, source, destination);
    assert.equal(result.sourcePath, fs.realpathSync(source));
    assert.equal(result.destinationPath, fs.realpathSync(destination));
  });
});

test('rejects destination inside a known source', () => {
  withFixture(({ db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    createJob(db, { sourceDir: source, destDir: destination });
    assert.throws(
      () => validateNewJobPaths(db, path.join(root, 'other-source'), path.join(source, 'nested')),
      /registered by another job/,
    );
  });
});

test('rejects source inside a known destination', () => {
  withFixture(({ db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    createJob(db, { sourceDir: source, destDir: destination });
    assert.throws(
      () => validateNewJobPaths(db, path.join(destination, 'nested'), path.join(root, 'other-destination')),
      /registered by another job/,
    );
  });
});

test('rejects path conflicts with an active job', () => {
  withFixture(({ db, root }) => {
    const active = createJob(db, {
      sourceDir: path.join(root, 'source-a'),
      destDir: path.join(root, 'destination-a'),
    });
    const pending = createJob(db, {
      sourceDir: path.join(root, 'source-b'),
      destDir: path.join(root, 'destination-a'),
    });
    assert.throws(
      () => assertNoActiveJobConflict(db, pending, [active.id]),
      /overlap active job/,
    );
  });
});