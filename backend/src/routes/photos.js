/**
 * /api/photos — list & inspect processed photos.
 */

const { Router } = require('express');
const sharp = require('sharp');
const { listPhotos, countPhotos, getPhoto, getJob, listJobs } = require('../db/dao');
const {
  METADATA_EXTENSIONS,
  PREVIEW_EXTENSIONS,
  UnsafePhotoFileError,
  resolvePhotoFile,
} = require('../services/safePhotoFile');

const router = Router();

/* List photos with optional filters */
router.get('/', (req, res) => {
  const { jobId, status, isDuplicate, resolution, search, limit, offset } = req.query;
  const photos = listPhotos(req.db, {
    jobId,
    status,
    isDuplicate,
    resolution,
    search: search || undefined,
    limit: limit ? Number(limit) : 100,
    offset: offset ? Number(offset) : 0,
  });
  const total = countPhotos(req.db, { jobId, status, isDuplicate, resolution, search: search || undefined });
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

/* Return EXIF metadata for a photo */
router.get('/:id/exif', async (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const job = getJob(req.db, photo.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const filePath = resolvePhotoFile(photo, job, METADATA_EXTENSIONS);
    const exifr = require('exifr');
    const exif = await exifr.parse(filePath, { translateKeys: true, translateValues: true, reviveValues: false });
    res.json({ exif: exif || null });
  } catch (error) {
    const message = error instanceof UnsafePhotoFileError
      ? error.message
      : 'Metadata could not be read';
    res.json({ exif: null, error: message });
  }
});

/* Serve a photo's source image for preview */
router.get('/:id/preview', async (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const job = getJob(req.db, photo.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let filePath;
  try {
    filePath = resolvePhotoFile(photo, job, PREVIEW_EXTENSIONS);
  } catch (error) {
    const message = error instanceof UnsafePhotoFileError
      ? error.message
      : 'Preview unavailable';
    return res.status(404).json({ error: message });
  }

  try {
    const preview = await sharp(filePath, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
      sequentialRead: true,
    })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', preview.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Frame-Options', 'DENY');
    return res.send(preview);
  } catch {
    return res.status(415).json({ error: 'Image format could not be decoded safely' });
  }
});

module.exports = router;
