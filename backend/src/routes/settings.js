/**
 * /api/settings — global configuration key/value store.
 */

const { Router } = require('express');
const os = require('os');
const { getAllSettings, upsertSetting, bulkUpsertSettings } = require('../db/dao');
const { sendTestNotification } = require('../services/ntfyService');
const { subscribe, unsubscribe, sendTestBrowserNotification } = require('../services/browserNotifyService');

const router = Router();

/* Server hardware info (must be before /:key) */
router.get('/system-info', (_req, res) => {
  res.json({ cpu_count: os.cpus().length });
});

/* Get all settings */
router.get('/', (req, res) => {
  res.json(getAllSettings(req.db));
});

/* Test Immich connection */
router.post('/immich-test', async (req, res) => {
  const { server, apiKey } = req.body;
  if (!server || !apiKey) {
    return res.status(400).json({ ok: false, error: 'Server URL and API key are required' });
  }
  try {
    const url = `${server.replace(/\/+$/, '')}/api/users/me`;
    const resp = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.status === 200) {
      const user = await resp.json();
      res.json({ ok: true, user: user.name || user.email || 'Connected' });
    } else if (resp.status === 401) {
      res.json({ ok: false, error: 'Invalid API key (HTTP 401)' });
    } else {
      res.json({ ok: false, error: `HTTP ${resp.status}` });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
});

/* Check immich-go availability */
router.get('/immich-go-status', (_req, res) => {
  const { isImmichGoAvailable, getImmichGoVersion } = require('../services/immichBridge');
  const available = isImmichGoAvailable();
  res.json({
    available,
    version: available ? getImmichGoVersion() : null,
  });
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
