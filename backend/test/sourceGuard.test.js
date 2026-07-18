const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDb } = require('../src/db/schema');
const { createJob } = require('../src/db/dao');
const { isInSourceDir, assertNotInSource } = require('../src/sourceGuard');

function withGuardFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-source-guard-'));
  const sourcePath = path.join(root, 'source');
  const destPath = path.join(root, 'destination');
  fs.mkdirSync(sourcePath);
  fs.mkdirSync(destPath);
  const db = initDb(path.join(root, 'guard.db'));
  createJob(db, { sourceDir: sourcePath, destDir: destPath });
  try {
    callback({ db, root, sourcePath, destPath });
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('recognizes the canonical source root and nested paths', () => {
  withGuardFixture(({ db, sourcePath }) => {
    assert.equal(isInSourceDir(db, sourcePath), true);
    assert.equal(isInSourceDir(db, path.join(sourcePath, 'nested', 'photo.jpg')), true);
    assert.throws(() => assertNotInSource(db, sourcePath), /SOURCE SAFETY VIOLATION/);
  });
});

test('recognizes a symlink alias of a source directory', (t) => {
  if (process.platform === 'win32') t.skip('Symlink creation requires elevated privileges on Windows');
  withGuardFixture(({ db, root, sourcePath }) => {
    const aliasPath = path.join(root, 'source-alias');
    fs.symlinkSync(sourcePath, aliasPath, 'dir');
    assert.equal(isInSourceDir(db, path.join(aliasPath, 'photo.jpg')), true);
  });
});

test('recognizes canonical aliases stored in a job', (t) => {
  if (process.platform !== 'darwin') t.skip('macOS exposes /var through the /private/var alias');
  const root = fs.mkdtempSync(path.join('/var/tmp', 'snapsort-source-alias-'));
  const sourcePath = path.join(root, 'source');
  const destPath = path.join(root, 'destination');
  fs.mkdirSync(sourcePath);
  fs.mkdirSync(destPath);
  const db = initDb(path.join(root, 'guard.db'));
  createJob(db, { sourceDir: sourcePath, destDir: destPath });
  try {
    const canonicalSource = fs.realpathSync(sourcePath);
    assert.notEqual(sourcePath, canonicalSource);
    assert.equal(isInSourceDir(db, canonicalSource), true);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps a missing historical source protected lexically', () => {
  withGuardFixture(({ db, root }) => {
    const missingSource = path.join(root, 'missing-source');
    createJob(db, { sourceDir: missingSource, destDir: path.join(root, 'other-destination') });
    assert.equal(isInSourceDir(db, path.join(missingSource, 'photo.jpg')), true);
  });
});

test('does not classify a disjoint destination as source', () => {
  withGuardFixture(({ db, destPath }) => {
    assert.equal(isInSourceDir(db, destPath), false);
  });
});