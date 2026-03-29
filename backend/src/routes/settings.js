/**
 * /api/settings — global configuration key/value store.
 */

const { Router } = require('express');
const { getAllSettings, upsertSetting, bulkUpsertSettings } = require('../db/dao');
const { sendTestNotification } = require('../services/ntfyService');
const { subscribe, unsubscribe, sendTestBrowserNotification } = require('../services/browserNotifyService');

const router = Router();

/* Get all settings */
router.get('/', (req, res) => {
  res.json(getAllSettings(req.db));
});

/* Update a single setting */
router.put('/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  upsertSetting(req.db, req.params.key, value);
  res.json({ key: req.params.key, value: String(value) });
});

/* Bulk update settings */
router.patch('/', (req, res) => {
  const pairs = req.body;
  if (!pairs || typeof pairs !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of key/value pairs' });
  }
  bulkUpsertSettings(req.db, pairs);
  res.json(getAllSettings(req.db));
});

/* Send a test ntfy notification */
router.post('/ntfy-test', async (req, res) => {
  try {
    await sendTestNotification(req.db);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/* Send a test browser notification to all connected tabs */
router.post('/browser-notify-test', (_req, res) => {
  sendTestBrowserNotification();
  res.json({ ok: true });
});

/* SSE stream for browser notifications */
router.get('/notifications/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  const subId = subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe(subId);
  });
});

module.exports = router;
