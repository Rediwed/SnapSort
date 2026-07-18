const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDb } = require('../src/db/schema');
const {
  createJob,
  getJob,
  insertPhoto,
  reconcileInterruptedJobs,
  resetJobForRetry,
  updateJobStatus,
} = require('../src/db/dao');

function withDatabase(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-recovery-'));
  const db = initDb(path.join(root, 'test.db'));
  try {
    callback(db);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('reconciles stale running and overriding jobs after restart', () => {
  withDatabase((db) => {
    const running = createJob(db, { sourceDir: '/source-a', destDir: '/dest-a' });
    const overriding = createJob(db, { sourceDir: '/source-b', destDir: '/dest-b' });
    const done = createJob(db, { sourceDir: '/source-c', destDir: '/dest-c' });
    updateJobStatus(db, running.id, 'running');
    updateJobStatus(db, overriding.id, 'overriding');
    updateJobStatus(db, done.id, 'done');

    assert.equal(reconcileInterruptedJobs(db), 2);
    assert.equal(getJob(db, running.id).status, 'error');
    assert.equal(getJob(db, overriding.id).error_message, 'Interrupted by server restart');
    assert.equal(getJob(db, done.id).status, 'done');
  });
});

test('retry reset clears run rows and counters but leaves destination files untouched', () => {
  withDatabase((db) => {
    const job = createJob(db, { sourceDir: '/source', destDir: '/dest' });
    updateJobStatus(db, job.id, 'error', {
      processed: 2, copied: 1, skipped: 1, errors: 1, total_files: 2,
      error_message: 'failure', started_at: 'start', finished_at: 'finish',
    });
    insertPhoto(db, {
      id: 'photo', jobId: job.id, srcPath: '/source/photo.jpg', destPath: '/dest/photo.jpg',
      filename: 'photo.jpg', extension: '.jpg', status: 'copied', outputOwned: true,
    });

    const reset = resetJobForRetry(db, job.id);

    assert.equal(reset.status, 'pending');
    assert.equal(reset.processed, 0);
    assert.equal(reset.copied, 0);
    assert.equal(reset.error_message, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos WHERE job_id = ?').get(job.id).count, 0);
  });
});