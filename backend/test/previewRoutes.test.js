const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const { initDb } = require('../src/db/schema');
const { createJob, insertPhoto } = require('../src/db/dao');
const photosRouter = require('../src/routes/photos');

async function withServer(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-preview-routes-'));
  const db = initDb(path.join(root, 'test.db'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  const job = createJob(db, { sourceDir: source, destDir: destination });
  const app = express();
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/photos', photosRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    await callback({
      baseUrl: `http://127.0.0.1:${server.address().port}/api/photos`,
      db,
      job,
      root,
      source,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function addPhoto(db, job, id, sourcePath) {
  insertPhoto(db, {
    id,
    jobId: job.id,
    srcPath: sourcePath,
    filename: path.basename(sourcePath),
    extension: path.extname(sourcePath),
    status: 'skipped',
  });
}

test('preview decodes and re-encodes a valid image as JPEG', async () => {
  await withServer(async ({ baseUrl, db, job, source }) => {
    const imagePath = path.join(source, 'photo.png');
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#336699' } })
      .png()
      .toFile(imagePath);
    addPhoto(db, job, 'valid', imagePath);

    const response = await fetch(`${baseUrl}/valid/preview`);
    const body = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control'), /^private/);
    assert.deepEqual([...body.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  });
});

test('preview rejects SVG instead of serving active content', async () => {
  await withServer(async ({ baseUrl, db, job, source }) => {
    const imagePath = path.join(source, 'active.svg');
    fs.writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    addPhoto(db, job, 'svg', imagePath);

    const response = await fetch(`${baseUrl}/svg/preview`);

    assert.equal(response.status, 404);
  });
});

test('preview rejects allowlisted extensions with invalid image data', async () => {
  await withServer(async ({ baseUrl, db, job, source }) => {
    const imagePath = path.join(source, 'fake.jpg');
    fs.writeFileSync(imagePath, 'not-an-image');
    addPhoto(db, job, 'fake', imagePath);

    const response = await fetch(`${baseUrl}/fake/preview`);

    assert.equal(response.status, 415);
  });
});

test('preview rejects a DB path outside the registered job roots', async () => {
  await withServer(async ({ baseUrl, db, job, root }) => {
    const imagePath = path.join(root, 'outside.jpg');
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000000' } })
      .jpeg()
      .toFile(imagePath);
    addPhoto(db, job, 'outside', imagePath);

    const response = await fetch(`${baseUrl}/outside/preview`);

    assert.equal(response.status, 404);
  });
});