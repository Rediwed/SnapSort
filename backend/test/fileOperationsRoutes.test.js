const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { initDb } = require('../src/db/schema');
const {
  createJob,
  getJob,
  getPhoto,
  insertDuplicate,
  insertPhoto,
  updateJobStatus,
} = require('../src/db/dao');
const jobsRouter = require('../src/routes/jobs');
const duplicatesRouter = require('../src/routes/duplicates');

async function withServer(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-file-routes-'));
  const db = initDb(path.join(root, 'test.db'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/jobs', jobsRouter);
  app.use('/api/duplicates', duplicatesRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await callback({ baseUrl, db, root });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function addPhoto(db, job, id, sourcePath, status) {
  insertPhoto(db, {
    id,
    jobId: job.id,
    srcPath: sourcePath,
    filename: path.basename(sourcePath),
    extension: path.extname(sourcePath),
    dateTaken: '2026-07-18T12:00:00.000Z',
    status,
  });
}

test('mixed override updates only successful photo status counters', async () => {
  await withServer(async ({ baseUrl, db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const skippedSource = path.join(source, 'skipped.jpg');
    const scannedSource = path.join(source, 'scanned.jpg');
    fs.writeFileSync(skippedSource, 'skipped-content');
    fs.writeFileSync(scannedSource, 'scanned-content');
    const job = createJob(db, { sourceDir: source, destDir: destination });
    updateJobStatus(db, job.id, 'done', { skipped: 2, scanned: 1 });
    addPhoto(db, job, 'skipped', skippedSource, 'skipped');
    addPhoto(db, job, 'scanned', scannedSource, 'scanned');
    addPhoto(db, job, 'missing', path.join(source, 'missing.jpg'), 'skipped');

    const response = await fetch(`${baseUrl}/jobs/${job.id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['skipped', 'scanned', 'missing'] }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.overridden, 2);
    assert.equal(body.errors, 1);
    const updatedJob = getJob(db, job.id);
    assert.equal(updatedJob.copied, 2);
    assert.equal(updatedJob.skipped, 1);
    assert.equal(updatedJob.scanned, 0);
    assert.equal(updatedJob.errors, 1);
    assert.equal(getPhoto(db, 'skipped').output_owned, 1);
    assert.equal(getPhoto(db, 'scanned').output_owned, 1);
    assert.equal(getPhoto(db, 'missing').status, 'skipped');
  });
});

test('job cleanup deletes owned outputs and preserves unowned paths', async () => {
  await withServer(async ({ baseUrl, db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const ownedPath = path.join(destination, 'owned.jpg');
    const protectedPath = path.join(destination, 'protected.jpg');
    fs.writeFileSync(ownedPath, 'owned');
    fs.writeFileSync(protectedPath, 'protected');
    const job = createJob(db, { sourceDir: source, destDir: destination });
    insertPhoto(db, {
      id: 'owned', jobId: job.id, srcPath: path.join(source, 'owned.jpg'),
      destPath: ownedPath, filename: 'owned.jpg', extension: '.jpg', status: 'copied',
      outputOwned: true, outputOperation: 'organizer',
    });
    insertPhoto(db, {
      id: 'protected', jobId: job.id, srcPath: path.join(source, 'protected.jpg'),
      destPath: protectedPath, filename: 'protected.jpg', extension: '.jpg', status: 'copied',
      outputOwned: false, outputOperation: 'overwrite',
    });

    const response = await fetch(`${baseUrl}/jobs/${job.id}/photos`, { method: 'DELETE' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.deleted, 1);
    assert.equal(body.protected, 1);
    assert.equal(fs.existsSync(ownedPath), false);
    assert.equal(fs.readFileSync(protectedPath, 'utf8'), 'protected');
    assert.equal(getJob(db, job.id), null);
  });
});

test('duplicate overwrite is atomic and remains protected from cleanup', async () => {
  await withServer(async ({ baseUrl, db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const sourcePath = path.join(source, 'incoming.jpg');
    const matchedPath = path.join(destination, 'existing.jpg');
    fs.writeFileSync(sourcePath, 'replacement-content');
    fs.writeFileSync(matchedPath, 'original-content');
    const job = createJob(db, { sourceDir: source, destDir: destination });
    updateJobStatus(db, job.id, 'done', { skipped: 1 });
    addPhoto(db, job, 'incoming', sourcePath, 'skipped');
    insertDuplicate(db, {
      id: 'duplicate', jobId: job.id, photoId: 'incoming', srcPath: sourcePath,
      matchedPath, similarity: 99,
    });

    const resolutionResponse = await fetch(`${baseUrl}/duplicates/duplicate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'keep_overwrite' }),
    });
    assert.equal(resolutionResponse.status, 200);
    assert.equal(fs.readFileSync(matchedPath, 'utf8'), 'replacement-content');
    assert.equal(getPhoto(db, 'incoming').output_owned, 0);
    assert.equal(getJob(db, job.id).copied, 1);
    assert.equal(getJob(db, job.id).skipped, 0);

    const cleanupResponse = await fetch(`${baseUrl}/jobs/${job.id}/photos`, { method: 'DELETE' });
    const cleanup = await cleanupResponse.json();
    assert.equal(cleanup.protected, 1);
    assert.equal(fs.readFileSync(matchedPath, 'utf8'), 'replacement-content');
  });
});

test('duplicate overwrite restores the original file when DB persistence fails', async () => {
  await withServer(async ({ baseUrl, db, root }) => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const sourcePath = path.join(source, 'incoming.jpg');
    const matchedPath = path.join(destination, 'existing.jpg');
    fs.writeFileSync(sourcePath, 'replacement-content');
    fs.writeFileSync(matchedPath, 'original-content');
    const job = createJob(db, { sourceDir: source, destDir: destination });
    updateJobStatus(db, job.id, 'done', { skipped: 1 });
    addPhoto(db, job, 'incoming', sourcePath, 'skipped');
    insertDuplicate(db, {
      id: 'duplicate', jobId: job.id, photoId: 'incoming', srcPath: sourcePath,
      matchedPath, similarity: 99,
    });
    db.exec(`
      CREATE TRIGGER fail_photo_copy BEFORE UPDATE OF status ON photos
      WHEN NEW.status = 'copied'
      BEGIN SELECT RAISE(ABORT, 'forced persistence failure'); END;
    `);

    const response = await fetch(`${baseUrl}/duplicates/duplicate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'keep_overwrite' }),
    });

    assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(matchedPath, 'utf8'), 'original-content');
    assert.equal(getPhoto(db, 'incoming').status, 'skipped');
    const duplicate = db.prepare('SELECT * FROM duplicates WHERE id = ?').get('duplicate');
    assert.equal(duplicate.operation_status, 'failed');
  });
});