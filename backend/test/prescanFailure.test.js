const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const drivesRouter = require('../src/routes/drivesSafe');

test('prescan records a terminal error instead of leaking scanning state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-prescan-error-'));
  fs.mkdirSync(path.join(root, 'child'));
  const state = {
    path: root,
    status: 'scanning',
    totalScanned: 0,
    topFolders: null,
    currentFile: 'pending',
  };
  drivesRouter.activePrescanMap.set(root, state);
  try {
    await drivesRouter.prescanAsync(root, state, null);
    assert.equal(state.status, 'error');
    assert.match(state.error, /push/);
    assert.equal(state.currentFile, null);
  } finally {
    drivesRouter.activePrescanMap.delete(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});