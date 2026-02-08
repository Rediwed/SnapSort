/**
 * /api/jobs — CRUD + start / cancel organizer runs.
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const {
  createJob, getJob, listJobs, updateJobStatus, deleteJob,
  getPhotosByIds, updatePhotoOverride,
} = require('../db/dao');
const { startJob, cancelJob } = require('../services/pythonBridge');
const { assertNotInSource } = require('../sourceGuard');

const router = Router();

/* List jobs (optional ?status=running&limit=20&offset=0) */
router.get('/', (req, res) => {
  const { status, limit, offset } = req.query;
  const jobs = listJobs(req.db, {
    status,
    limit: limit ? Number(limit) : 50,
    offset: offset ? Number(offset) : 0,
  });
  res.json(jobs);
});

/* Test presets — return available test datasets */
router.get('/test-presets', (_req, res) => {
  const fs = require('fs');
  const path = require('path');
  const manifestPath = path.join(__dirname, '..', '..', '..', 'test_data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return res.json({ available: false, message: 'No test data found. Run: python3 generate_test_data.py' });
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const baseDir = manifest.base_dir;
    const presets = manifest.sources.map((src) => ({
      name: src,
      sourceDir: path.join(baseDir, src),
      destDir: path.join(baseDir, manifest.destination),
    }));
    res.json({
      available: true,
      baseDir,
      presets,
      edgeCases: manifest.edge_cases || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Get single job */
router.get('/:id', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/* Create a new job */
router.post('/', (req, res) => {
  const { sourceDir, destDir, mode, minWidth, minHeight, minFilesize, performanceProfile } = req.body;
  if (!sourceDir || !destDir) {
    return res.status(400).json({ error: 'sourceDir and destDir are required' });
  }
  /* Source safety: source and destination must be completely disjoint */
  const resolvedSrc = path.resolve(sourceDir);
  const resolvedDst = path.resolve(destDir);
  if (resolvedDst === resolvedSrc) {
    return res.status(400).json({ error: 'Source and destination cannot be the same directory.' });
  }
  if (resolvedDst.startsWith(resolvedSrc + path.sep)) {
    return res.status(400).json({ error: 'Destination must not be inside the source directory. SnapSort never modifies source files.' });
  }
  if (resolvedSrc.startsWith(resolvedDst + path.sep)) {
    return res.status(400).json({ error: 'Source must not be inside the destination directory — this would cause SnapSort to re-process its own output.' });
  }
  const job = createJob(req.db, { sourceDir, destDir, mode, minWidth, minHeight, minFilesize, performanceProfile });
  res.status(201).json(job);
});

/* Start a pending job (kicks off the Python organizer) */
router.post('/:id/start', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'running') return res.status(409).json({ error: 'Job already running' });

  startJob(req.db, job);
  const updated = updateJobStatus(req.db, job.id, 'running', { started_at: new Date().toISOString() });
  res.json(updated);
});

/* Cancel a running job */
router.post('/:id/cancel', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  cancelJob(job.id);
  const updated = updateJobStatus(req.db, job.id, 'error', {
    error_message: 'Cancelled by user',
    finished_at: new Date().toISOString(),
  });
  res.json(updated);
});

/* Delete a job (and cascade photos + duplicates) */
router.delete('/:id', (req, res) => {
  deleteJob(req.db, req.params.id);
  res.status(204).end();
});

/* Delete a job AND remove copied files from disk */
router.delete('/:id/photos', (req, res) => {
  const fs = require('fs');
  const { listPhotoPaths } = require('../db/dao');
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const paths = listPhotoPaths(req.db, req.params.id);
  let deleted = 0;
  let failed = 0;
  for (const p of paths) {
    try {
      /* Source safety: refuse to delete anything inside a source dir */
      assertNotInSource(req.db, p);
      if (fs.existsSync(p)) { fs.unlinkSync(p); deleted++; }
    } catch (err) {
      if (err.message.includes('SOURCE SAFETY')) {
        console.error(err.message);
      }
      failed++;
    }
  }
  deleteJob(req.db, req.params.id);
  res.json({ deleted, failed, total: paths.length });
});

/* ================================================================== */
/*  Override — copy skipped photos that the user wants to keep         */
/* ================================================================== */

/**
 * Construct the destination path using the same YYYY/MM/DD structure
 * the Python organizer uses.
 */
function buildDestPath(srcPath, destDir, dateTaken) {
  const parentFolder = path.basename(path.dirname(srcPath));
  const ext = path.extname(srcPath);
  const baseName = path.basename(srcPath, ext);
  let year = 'unknown', month = '00', day = '00';
  if (dateTaken) {
    const dt = new Date(dateTaken);
    if (!isNaN(dt.getTime())) {
      year = String(dt.getFullYear());
      month = String(dt.getMonth() + 1).padStart(2, '0');
      day = String(dt.getDate()).padStart(2, '0');
    }
  }
  const destFolder = path.join(destDir, year, month, day);
  const destFilename = `${parentFolder}_${baseName}${ext}`;
  return path.join(destFolder, destFilename);
}

router.post('/:id/override', async (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Can only override a completed job' });

  const { photoIds } = req.body;
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return res.status(400).json({ error: 'photoIds array is required' });
  }

  /* Fetch the selected photos & validate they are skipped */
  const photos = getPhotosByIds(req.db, photoIds);
  const skipped = photos.filter((p) => p.status === 'skipped' && p.job_id === job.id);
  if (skipped.length === 0) {
    return res.status(400).json({ error: 'No skipped photos found for the given IDs' });
  }

  /* Mark job as overriding */
  updateJobStatus(req.db, job.id, 'overriding');

  const now = new Date().toISOString();
  let copiedCount = 0;
  let errorCount = 0;
  const results = [];

  for (const photo of skipped) {
    try {
      if (!fs.existsSync(photo.src_path)) {
        results.push({ id: photo.id, error: 'Source file not found' });
        errorCount++;
        continue;
      }

      const destPath = buildDestPath(photo.src_path, job.dest_dir, photo.date_taken);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      /* Avoid overwriting — append suffix if file exists */
      let finalDest = destPath;
      if (fs.existsSync(finalDest)) {
        const ext = path.extname(destPath);
        const base = destPath.slice(0, -ext.length);
        let n = 1;
        while (fs.existsSync(finalDest)) {
          finalDest = `${base}_${n}${ext}`;
          n++;
        }
      }

      fs.copyFileSync(photo.src_path, finalDest);
      updatePhotoOverride(req.db, photo.id, { status: 'copied', destPath: finalDest, overriddenAt: now });
      copiedCount++;
      results.push({ id: photo.id, destPath: finalDest });
    } catch (err) {
      results.push({ id: photo.id, error: err.message });
      errorCount++;
    }
  }

  /* Adjust job counters */
  const updatedJob = getJob(req.db, job.id);
  updateJobStatus(req.db, job.id, 'done', {
    copied: (updatedJob.copied || 0) + copiedCount,
    skipped: Math.max(0, (updatedJob.skipped || 0) - copiedCount),
    errors: (updatedJob.errors || 0) + errorCount,
  });

  res.json({
    overridden: copiedCount,
    errors: errorCount,
    results,
    job: getJob(req.db, job.id),
  });
});

module.exports = router;
