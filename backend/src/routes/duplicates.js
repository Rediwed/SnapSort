/**
 * /api/duplicates — list & resolve duplicate pairs.
 */

const { Router } = require('express');
const { listDuplicates, countDuplicates, resolveDuplicate } = require('../db/dao');

const router = Router();

/* List duplicates */
router.get('/', (req, res) => {
  const { jobId, limit, offset } = req.query;
  const duplicates = listDuplicates(req.db, {
    jobId,
    limit: limit ? Number(limit) : 100,
    offset: offset ? Number(offset) : 0,
  });
  const total = countDuplicates(req.db, { jobId });
  res.json({ duplicates, total });
});

/* Resolve a duplicate (keep / delete / undecided) */
router.patch('/:id', (req, res) => {
  const { resolution } = req.body;
  if (!['keep', 'delete', 'undecided'].includes(resolution)) {
    return res.status(400).json({ error: 'resolution must be keep | delete | undecided' });
  }
  resolveDuplicate(req.db, req.params.id, resolution);
  res.json({ id: req.params.id, resolution });
});

module.exports = router;
