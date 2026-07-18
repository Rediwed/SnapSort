/**
 * /api/photos — list & inspect processed photos.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { listPhotos, countPhotos, getPhoto, listJobs, jobIdsWithPhotos } = require('../db/dao');

const router = Router();

/* List photos with optional filters */
router.get('/', (req, res) => {
  const { jobId, status, isDuplicate, resolution, search, limit, offset } = req.query;
  if (search && String(search).length > 200) {
    return res.status(400).json({ error: 'search is too long (max 200 characters)' });
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const photos = listPhotos(req.db, {
    jobId,
    status,
    isDuplicate,
    resolution,
    search: search || undefined,
    limit: safeLimit,
    offset: safeOffset,
  });
  const total = countPhotos(req.db, { jobId, status, isDuplicate, resolution, search: search || undefined });
  res.json({ photos, total });
});

/* List all jobs that have photos (for the job dropdown) */
router.get('/jobs', (req, res) => {
  const jobs = listJobs(req.db, { limit: 500 });
  // One DISTINCT query instead of one COUNT per job (avoids N+1).
  const withPhotos = jobIdsWithPhotos(req.db);
  const jobsWithPhotos = jobs.filter((j) => withPhotos.has(j.id)).map((j) => ({
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

  const filePath = (photo.dest_path && fs.existsSync(photo.dest_path))
    ? photo.dest_path
    : photo.src_path;

  if (!filePath || !fs.existsSync(filePath)) {
    return res.json({ exif: null, error: 'Image file not found on disk' });
  }

  try {
    const exifr = require('exifr');
    const exif = await exifr.parse(filePath, { translateKeys: true, translateValues: true, reviveValues: false });
    res.json({ exif: exif || null });
  } catch {
    res.json({ exif: null });
  }
});

/* Serve a photo's source image for preview */
router.get('/:id/preview', (req, res) => {
  const photo = getPhoto(req.db, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  /* Prefer the copied dest_path (accessible); fall back to src_path */
  const filePath = (photo.dest_path && fs.existsSync(photo.dest_path))
    ? photo.dest_path
    : photo.src_path;

  if (!filePath) {
    return res.status(404).json({ error: 'Image file not found on disk' });
  }

  /* Reject symlinks and non-regular files so we never stream an arbitrary target. */
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return res.status(404).json({ error: 'Image file not found on disk' });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return res.status(400).json({ error: 'Refusing to serve a non-regular file' });
  }

  const ext = path.extname(filePath).toLowerCase();
  /* Only raster formats that browsers render safely are served inline. */
  const SAFE_INLINE = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.tiff': 'image/tiff', '.tif': 'image/tiff', '.heic': 'image/heic',
    '.heif': 'image/heif', '.avif': 'image/avif',
  };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const mime = SAFE_INLINE[ext];
  if (mime) {
    res.setHeader('Content-Type', mime);
  } else {
    /* Anything else (SVG, RAW, unknown) is downloaded, never rendered inline in
       the app origin — active SVG therefore cannot execute against SnapSort. */
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`);
  }
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
