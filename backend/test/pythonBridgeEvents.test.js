const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDb } = require('../src/db/schema');
const { createJob, getJob, updateJobStatus } = require('../src/db/dao');
const { handleEvent } = require('../src/services/pythonBridge');

function withRunningJob(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-bridge-event-'));
  const db = initDb(path.join(root, 'test.db'));
  const job = createJob(db, { sourceDir: '/source', destDir: '/destination' });
  updateJobStatus(db, job.id, 'running');
  try {
    callback({ db, job });
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('message-only progress does not write null counters', () => {
  withRunningJob(({ db, job }) => {
    handleEvent(db, job.id, { event: 'progress', message: 'Starting workers' });
    const updated = getJob(db, job.id);
    assert.equal(updated.processed, 0);
    assert.equal(updated.status, 'running');
  });
});

test('error followed by done remains an error with its descriptive message', () => {
  withRunningJob(({ db, job }) => {
    const message = handleEvent(db, job.id, { event: 'error', message: 'Disk disconnected' });
    handleEvent(db, job.id, {
      event: 'done',
      summary: { processed: 1, copied: 1, total_files: 1, total_bytes: 100 },
    });
    const updated = getJob(db, job.id);
    assert.equal(message, 'Disk disconnected');
    assert.equal(updated.status, 'error');
    assert.equal(updated.error_message, 'Disk disconnected');
  });
});

test('cancelled jobs ignore buffered progress events', () => {
  withRunningJob(({ db, job }) => {
    updateJobStatus(db, job.id, 'cancelled');
    handleEvent(db, job.id, {
      event: 'progress', processed: 10, copied: 10, skipped: 0, errors: 0, total_files: 10,
    });
    const updated = getJob(db, job.id);
    assert.equal(updated.status, 'cancelled');
    assert.equal(updated.processed, 0);
  });
});