/**
 * /api/settings — global configuration key/value store.
 */

const { Router } = require('express');
const { getAllSettings, upsertSetting, bulkUpsertSettings } = require('../db/dao');

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

module.exports = router;
