const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initDb } = require('../src/db/schema');
const {
  countProtectedPhotoPaths,
  createJob,
  getJob,
  getPhoto,
  insertDuplicate,
  insertPhoto,
  listPhotoPaths,
  listJobsWithDuplicates,
  listJobsWithPhotos,
  markPhotoCopied,
  recordDuplicateResolution,
} = require('../src/db/dao');

function withDatabase(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-provenance-'));
  const db = initDb(path.join(root, 'test.db'));
  try {
    callback({ db, root });
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('migrates legacy tables with safe provenance defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-migration-'));
  const dbPath = path.join(root, 'legacy.db');
  initDb(dbPath).close();
  const legacy = new Database(dbPath);
  legacy.exec('ALTER TABLE jobs DROP COLUMN scanned');
  legacy.exec('ALTER TABLE photos DROP COLUMN output_owned');
  legacy.exec('ALTER TABLE photos DROP COLUMN output_operation');
  legacy.exec('ALTER TABLE duplicates DROP COLUMN applied_at');
  legacy.exec('ALTER TABLE duplicates DROP COLUMN operation_status');
  legacy.exec('ALTER TABLE duplicates DROP COLUMN operation_error');
  legacy.close();

  const db = initDb(dbPath);
  try {
    const jobColumns = db.pragma('table_info(jobs)').map((column) => column.name);
    const photoColumns = db.pragma('table_info(photos)').map((column) => column.name);
    const duplicateColumns = db.pragma('table_info(duplicates)').map((column) => column.name);
    assert.ok(jobColumns.includes('scanned'));
    assert.ok(photoColumns.includes('output_owned'));
    assert.ok(photoColumns.includes('output_operation'));
    assert.ok(duplicateColumns.includes('operation_status'));
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup selection includes only explicitly owned output', () => {
  withDatabase(({ db, root }) => {
    const job = createJob(db, { sourceDir: '/source', destDir: '/destination' });
    const ownedPath = path.join(root, 'owned.jpg');
    const protectedPath = path.join(root, 'protected.jpg');
    insertPhoto(db, {
      id: 'owned', jobId: job.id, srcPath: '/source/owned.jpg', destPath: ownedPath,
      filename: 'owned.jpg', extension: '.jpg', status: 'copied', outputOwned: true,
      outputOperation: 'organizer',
    });
    insertPhoto(db, {
      id: 'protected', jobId: job.id, srcPath: '/source/protected.jpg', destPath: protectedPath,
      filename: 'protected.jpg', extension: '.jpg', status: 'copied', outputOwned: false,
      outputOperation: 'overwrite',
    });

    assert.deepEqual(listPhotoPaths(db, job.id), [ownedPath]);
    assert.equal(countProtectedPhotoPaths(db, job.id), 1);
  });
});

test('markPhotoCopied applies exact skipped and scanned counter deltas', () => {
  withDatabase(({ db }) => {
    const job = createJob(db, { sourceDir: '/source', destDir: '/destination' });
    db.prepare('UPDATE jobs SET skipped = 1, scanned = 1 WHERE id = ?').run(job.id);
    insertPhoto(db, {
      id: 'skipped', jobId: job.id, srcPath: '/source/skipped.jpg', filename: 'skipped.jpg',
      extension: '.jpg', status: 'skipped',
    });
    insertPhoto(db, {
      id: 'scanned', jobId: job.id, srcPath: '/source/scanned.jpg', filename: 'scanned.jpg',
      extension: '.jpg', status: 'scanned',
    });

    const transaction = db.transaction(() => {
      markPhotoCopied(db, 'skipped', {
        destPath: '/destination/skipped.jpg', outputOwned: true, outputOperation: 'override',
      });
      markPhotoCopied(db, 'scanned', {
        destPath: '/destination/scanned.jpg', outputOwned: true, outputOperation: 'override',
      });
    });
    transaction();

    const updated = getJob(db, job.id);
    assert.equal(updated.copied, 2);
    assert.equal(updated.skipped, 0);
    assert.equal(updated.scanned, 0);
    assert.equal(getPhoto(db, 'skipped').output_owned, 1);
  });
});

test('records duplicate operation outcomes without changing provenance', () => {
  withDatabase(({ db }) => {
    const job = createJob(db, { sourceDir: '/source', destDir: '/destination' });
    insertPhoto(db, {
      id: 'photo', jobId: job.id, srcPath: '/source/photo.jpg', filename: 'photo.jpg',
      extension: '.jpg', status: 'skipped',
    });
    insertDuplicate(db, {
      id: 'duplicate', jobId: job.id, photoId: 'photo', srcPath: '/source/photo.jpg',
      similarity: 99,
    });

    recordDuplicateResolution(db, 'duplicate', {
      resolution: 'keep_rename', status: 'succeeded', appliedAt: '2026-07-18T12:00:00Z',
    });
    const duplicate = db.prepare('SELECT * FROM duplicates WHERE id = ?').get('duplicate');
    assert.equal(duplicate.operation_status, 'succeeded');
    assert.equal(duplicate.applied_at, '2026-07-18T12:00:00Z');
  });
});

test('grouped job selectors return only jobs with photos or duplicates', () => {
  withDatabase(({ db }) => {
    const populated = createJob(db, { sourceDir: '/source-a', destDir: '/destination-a' });
    createJob(db, { sourceDir: '/source-b', destDir: '/destination-b' });
    insertPhoto(db, {
      id: 'photo', jobId: populated.id, srcPath: '/source-a/photo.jpg', filename: 'photo.jpg',
      extension: '.jpg', status: 'skipped',
    });
    insertDuplicate(db, {
      id: 'duplicate', jobId: populated.id, photoId: 'photo', srcPath: '/source-a/photo.jpg',
      similarity: 99,
    });

    assert.deepEqual(listJobsWithPhotos(db).map((job) => job.id), [populated.id]);
    assert.deepEqual(listJobsWithDuplicates(db).map((job) => job.id), [populated.id]);
  });
});