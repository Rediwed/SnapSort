const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const filesystemRouter = require('../src/routes/filesystem');

test('filesystem browse omits symlink entries', async (t) => {
  if (process.platform === 'win32') t.skip('Symlink creation requires elevated privileges on Windows');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-filesystem-'));
  const target = path.join(root, 'target.txt');
  const link = path.join(root, 'link.txt');
  fs.writeFileSync(target, 'target');
  fs.symlinkSync(target, link);
  const app = express();
  app.use('/api/filesystem', filesystemRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const query = new URLSearchParams({ dir: root, files: 'true' });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/filesystem/browse?${query}`,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.entries.map((entry) => entry.name), ['target.txt']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});