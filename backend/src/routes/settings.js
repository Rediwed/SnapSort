/**
 * /api/settings — global configuration key/value store.
 */

const { Router } = require('express');
const os = require('os');
const { getAllSettings, getSetting, upsertSetting, bulkUpsertSettings } = require('../db/dao');
const { sendTestNotification } = require('../services/ntfyService');
const { subscribe, unsubscribe, sendTestBrowserNotification } = require('../services/browserNotifyService');
const {
  normalizeSettingsUpdate,
  publicSettingUpdate,
  publicSettings,
} = require('../security/settingsSecrets');
const { validateSettingsUpdate } = require('../security/settingsPolicy');
const { validateForResponse } = require('../security/validation');

const router = Router();

/* Server hardware info (must be before /:key) */
router.get('/system-info', (_req, res) => {
  res.json({ cpu_count: os.cpus().length });
});

/* Get all settings */
router.get('/', (req, res) => {
  res.json(publicSettings(getAllSettings(req.db)));
});

/* Update a single setting */
router.put('/:key', (req, res) => {
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  const validation = validateForResponse(res, () => validateSettingsUpdate({ [req.params.key]: value }));
  if (!validation.ok) return;
  const normalized = normalizeSettingsUpdate(validation.value);
  if (Object.hasOwn(normalized, req.params.key)) {
    upsertSetting(req.db, req.params.key, normalized[req.params.key]);
  }
  res.json(publicSettingUpdate(req.params.key, getSetting(req.db, req.params.key)));
});

/* Bulk update settings */
router.patch('/', (req, res) => {
  const validation = validateForResponse(res, () => validateSettingsUpdate(req.body));
  if (!validation.ok) return;
  const normalized = normalizeSettingsUpdate(validation.value);
  const currentSettings = getAllSettings(req.db);
  if (normalized.ntfy_server && normalized.ntfy_server !== currentSettings.ntfy_server) {
    normalized.ntfy_auth_token = '';
    normalized.ntfy_password = '';
  }
  bulkUpsertSettings(req.db, normalized);
  res.json(publicSettings(getAllSettings(req.db)));
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
