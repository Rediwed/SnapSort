const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('rejects JSON request bodies larger than 1 MB with a bounded error', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/payload', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'JSON request body exceeds 1 MB' });
    }
    return next(error);
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/payload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 1) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'JSON request body exceeds 1 MB' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});