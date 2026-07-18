/**
 * /api/settings — global configuration key/value store.
 */

const { Router } = require('express');
const os = require('os');
const { getAllSettings, upsertSetting, bulkUpsertSettings } = require('../db/dao');
const { sendTestNotification } = require('../services/ntfyService');
const { subscribe, unsubscribe, sendTestBrowserNotification } = require('../services/browserNotifyService');
const { maskSecrets, isMaskedValue, isSecretKey } = require('../security');

const router = Router();

/* Setting keys are lower-snake identifiers; values are bounded to avoid DB bloat/DoS. */
const SETTING_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
function validateSettingKV(key, value) {
  if (!SETTING_KEY_RE.test(String(key))) throw new Error('Invalid setting key');
  if (String(value).length > 8192) throw new Error('Setting value too long (max 8192 chars)');
}

/* Server hardware info (must be before /:key) */
router.get('/system-info', (_req, res) => {
  res.json({ cpu_count: os.cpus().length });
});

/* Get all settings (secret values are masked) */
router.get('/', (req, res) => {
  res.json(maskSecrets(getAllSettings(req.db)));
});

/* Update a single setting */
router.put('/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  /* Re-saving a masked secret means "leave it unchanged". */
  if (isMaskedValue(value)) return res.json({ key: req.params.key, unchanged: true });
  try { validateSettingKV(req.params.key, value); } catch (e) { return res.status(400).json({ error: e.message }); }
  upsertSetting(req.db, req.params.key, value);
  if (isSecretKey(req.params.key)) return res.json({ key: req.params.key, saved: true });
  res.json({ key: req.params.key, value: String(value) });
});

/* Bulk update settings */
router.patch('/', (req, res) => {
  const pairs = req.body;
  if (!pairs || typeof pairs !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of key/value pairs' });
  }
  /* Drop masked sentinels so unchanged secrets are preserved. */
  const filtered = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (isMaskedValue(v)) continue;
    try { validateSettingKV(k, v); } catch (e) { return res.status(400).json({ error: `${k}: ${e.message}` }); }
    filtered[k] = v;
  }
  bulkUpsertSettings(req.db, filtered);
  res.json(maskSecrets(getAllSettings(req.db)));
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
