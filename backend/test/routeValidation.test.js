const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { initDb } = require('../src/db/schema');
const { createJob, insertPhoto } = require('../src/db/dao');
const { getSetting } = require('../src/db/dao');
const jobsRouter = require('../src/routes/jobs');
const photosRouter = require('../src/routes/photos');
const profilesRouter = require('../src/routes/profiles');
const settingsRouter = require('../src/routes/settings');

async function withServer(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-validation-routes-'));
  const db = initDb(path.join(root, 'test.db'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/jobs', jobsRouter);
  app.use('/api/photos', photosRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/settings', settingsRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    await callback({
      baseUrl: `http://127.0.0.1:${server.address().port}/api`, db, root,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('list routes reject malformed and excessive pagination', async () => {
  await withServer(async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/jobs?limit=NaN`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/photos?limit=501`)).status, 400);
  });
});

test('job and profile bodies reject unsafe values', async () => {
  await withServer(async ({ baseUrl, root }) => {
    const jobResponse = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceDir: path.join(root, 'source'),
        destDir: path.join(root, 'destination'),
        mode: 'shell',
      }),
    });
    const profileResponse = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unsafe', max_workers: 1000 }),
    });
    assert.equal(jobResponse.status, 400);
    assert.equal(profileResponse.status, 400);
  });
});

test('settings reject unknown keys and missing values', async () => {
  await withServer(async ({ baseUrl }) => {
    const unknown = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arbitrary: 'value' }),
    });
    const missing = await fetch(`${baseUrl}/settings/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unknown.status, 400);
    assert.equal(missing.status, 400);
  });
});

test('changing ntfy origin clears credentials bound to the old origin', async () => {
  await withServer(async ({ baseUrl, db }) => {
    await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ntfy_auth_token: 'old-origin-token' }),
    });
    const response = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ntfy_server: 'https://notify.example' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(getSetting(db, 'ntfy_auth_token'), '');
    assert.equal(body.ntfy_auth_token_configured, false);
  });
});

test('photo search treats regex and LIKE wildcards as literal text', async () => {
  await withServer(async ({ baseUrl, db }) => {
    const job = createJob(db, { sourceDir: '/source', destDir: '/destination' });
    for (const [id, filename] of [['percent', '100%real.jpg'], ['other', '100Xreal.jpg']]) {
      insertPhoto(db, {
        id, jobId: job.id, srcPath: `/source/${filename}`, filename,
        extension: '.jpg', status: 'skipped',
      });
    }

    const percent = await (await fetch(`${baseUrl}/photos?search=${encodeURIComponent('%')}`)).json();
    const regexShaped = await (await fetch(`${baseUrl}/photos?search=${encodeURIComponent('(a+)+$')}`)).json();
    assert.equal(percent.total, 1);
    assert.equal(percent.photos[0].filename, '100%real.jpg');
    assert.equal(regexShaped.total, 0);
  });
});