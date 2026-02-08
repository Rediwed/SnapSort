/**
 * /api/photos — list & inspect processed photos.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { listPhotos, countPhotos, getPhoto, listJobs } = require('../db/dao');

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

/* List all jobs that have photos (for the job dropdown) */
router.get('/jobs', (req, res) => {
  const jobs = listJobs(req.db, { limit: 500 });
  // Only return jobs that actually have photos
  const jobsWithPhotos = jobs.filter((j) => {
    const count = countPhotos(req.db, { jobId: j.id });
    return count > 0;
  }).map((j) => ({
    id: j.id,
    source_dir: j.source_dir,
    dest_dir: j.dest_dir,
    status: j.status,
    created_at: j.created_at,
    copied: j.copied,
    skipped: j.skipped,
    errors: j.errors,
    total_files: j.total_files,
  }));
  res.json(jobsWithPhotos);
});

/* Single photo */
router.get('/:id', (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json(photo);
});

/* Serve a photo's source image for preview */
router.get('/:id/preview', (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  /* Prefer the copied dest_path (accessible); fall back to src_path */
  const filePath = (photo.dest_path && fs.existsSync(photo.dest_path))
    ? photo.dest_path
    : photo.src_path;

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image file not found on disk' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.tiff': 'image/tiff', '.tif': 'image/tiff', '.heic': 'image/heic',
    '.heif': 'image/heif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  };
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
