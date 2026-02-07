/**
 * /api/photos — list & inspect processed photos.
 */

const { Router } = require('express');
const { listPhotos, countPhotos, getPhoto } = require('../db/dao');

const router = Router();

/* List photos with optional filters */
router.get('/', (req, res) => {
  const { jobId, status, limit, offset } = req.query;
  const photos = listPhotos(req.db, {
    jobId,
    status,
    limit: limit ? Number(limit) : 100,
    offset: offset ? Number(offset) : 0,
  });
  const total = countPhotos(req.db, { jobId, status });
  res.json({ photos, total });
});

/* Single photo */
router.get('/:id', (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json(photo);
});

module.exports = router;
