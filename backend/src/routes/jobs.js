/**
 * /api/jobs — CRUD + start / cancel organizer runs.
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const {
  createJob, getJob, listJobs, updateJobStatus, deleteJob,
  countProtectedPhotoPaths, getPhotosByIds, listPhotoPaths, markPhotoCopied,
} = require('../db/dao');
const { startJob, cancelJob, getActiveJobIds, getCurrentFile } = require('../services/pythonBridge');
const { assertNotInSource } = require('../sourceGuard');
const { notifyJobCancelled } = require('../services/ntfyService');
const {
  JobPathError,
  assertNoActiveJobConflict,
  validateNewJobPaths,
} = require('../services/jobPathSafety');
const { installNewFile } = require('../services/atomicFile');

const router = Router();
const overrideLocks = new Set();

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

/* Test presets — return available test/demo datasets */
router.get('/test-presets', (_req, res) => {
  const fs = require('fs');
  const path = require('path');

  /* Look for both test_data and demo_data manifests; prefer demo_data if both exist */
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'demo_data', 'manifest.json'),
    path.join(__dirname, '..', '..', '..', 'test_data', 'manifest.json'),
  ];
  const manifestPath = candidates.find((p) => fs.existsSync(p));
  if (!manifestPath) {
    return res.json({ available: false, message: 'No test data found. Run: python3 generate_demo_data.py (or generate_test_data.py)' });
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
      demo: manifest.demo || false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Active jobs — returns running jobs with progress + current file */
router.get('/active', (req, res) => {
  const activeIds = getActiveJobIds();
  if (activeIds.length === 0) return res.json([]);
  const jobs = activeIds.map((id) => {
    const job = getJob(req.db, id);
    if (!job) return null;
    const fileInfo = getCurrentFile(id);
    return {
      id: job.id,
      source_dir: job.source_dir,
      status: job.status,
      processed: job.processed,
      total_files: job.total_files,
      copied: job.copied,
      skipped: job.skipped,
      errors: job.errors,
      currentFile: fileInfo?.currentFile || null,
      currentFileStatus: fileInfo?.status || null,
      phase: fileInfo?.phase || null,
      discovered: fileInfo?.discovered || 0,
    };
  }).filter(Boolean);
  res.json(jobs);
});

/* Get single job */
router.get('/:id', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/* Create a new job */
router.post('/', (req, res) => {
  const { name, sourceDir, destDir, mode, minWidth, minHeight, minFilesize, performanceProfile } = req.body;
  if (!sourceDir || !destDir) {
    return res.status(400).json({ error: 'sourceDir and destDir are required' });
  }
  let safePaths;
  try {
    safePaths = validateNewJobPaths(req.db, sourceDir, destDir);
  } catch (error) {
    if (error instanceof JobPathError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
  const job = createJob(req.db, {
    name,
    sourceDir: safePaths.sourcePath,
    destDir: safePaths.destinationPath,
    mode,
    minWidth,
    minHeight,
    minFilesize,
    performanceProfile,
  });
  res.status(201).json(job);
});

/* Start a pending job (kicks off the Python organizer) */
router.post('/:id/start', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'running') return res.status(409).json({ error: 'Job already running' });

  /* Validate paths are accessible inside the container before spawning Python */
  if (!fs.existsSync(job.source_dir)) {
    return res.status(400).json({
      error: `Source directory not found: ${job.source_dir}. `
        + 'If running in Docker, make sure the path matches the container mount '
        + '(e.g. /mnt/photos/… not the host path /mnt/user/photos/…). '
        + 'Check your Docker volume mappings.',
    });
  }

  try {
    assertNoActiveJobConflict(req.db, job, getActiveJobIds());
  } catch (error) {
    if (error instanceof JobPathError) {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  }

  startJob(req.db, job);
  const updated = updateJobStatus(req.db, job.id, 'running', { started_at: new Date().toISOString() });
  res.json(updated);
});

/* Cancel a running job */
router.post('/:id/cancel', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  cancelJob(job.id);
  const updated = updateJobStatus(req.db, job.id, 'cancelled', {
    error_message: 'Cancelled by user',
    finished_at: new Date().toISOString(),
  });
  notifyJobCancelled(req.db, job);
  res.json(updated);
});

/* Delete a job (and cascade photos + duplicates) */
router.delete('/:id', (req, res) => {
  deleteJob(req.db, req.params.id);
  res.status(204).end();
});

/* Delete a job AND remove copied files from disk */
router.delete('/:id/photos', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const paths = listPhotoPaths(req.db, req.params.id);
  const protectedCount = countProtectedPhotoPaths(req.db, req.params.id);
  let deleted = 0;
  let failed = 0;
  const results = [];
  for (const p of paths) {
    try {
      /* Source safety: refuse to delete anything inside a source dir */
      assertNotInSource(req.db, p);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deleted++;
        results.push({ path: p, status: 'deleted' });
      } else {
        results.push({ path: p, status: 'already-missing' });
      }
    } catch (err) {
      if (err.message.includes('SOURCE SAFETY')) {
        console.error(err.message);
      }
      failed++;
      results.push({ path: p, status: 'failed', error: err.message });
    }
  }
  if (failed > 0) {
    return res.status(409).json({
      deleted, failed, protected: protectedCount, total: paths.length, results,
      error: 'Some owned files could not be deleted; the job record was retained for retry',
    });
  }
  deleteJob(req.db, req.params.id);
  res.json({ deleted, failed, protected: protectedCount, total: paths.length, results });
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

  /* Fetch the selected photos & validate they are skipped or scanned */
  const photos = getPhotosByIds(req.db, photoIds);
  const eligible = photos.filter((p) => (p.status === 'skipped' || p.status === 'scanned') && p.job_id === job.id);
  if (eligible.length === 0) {
    return res.status(400).json({ error: 'No skipped or scanned photos found for the given IDs' });
  }
  if (overrideLocks.has(job.id)) {
    return res.status(409).json({ error: 'An override is already in progress for this job' });
  }
  overrideLocks.add(job.id);

  /* Mark job as overriding */
  updateJobStatus(req.db, job.id, 'overriding');

  const successful = [];
  const results = [];
  let errorCount = 0;

  try {
    for (const photo of eligible) {
      try {
        if (!fs.existsSync(photo.src_path)) throw new Error('Source file not found');
        const requestedPath = buildDestPath(photo.src_path, job.dest_dir, photo.date_taken);
        assertNotInSource(req.db, requestedPath);
        const operation = installNewFile(photo.src_path, requestedPath);
        successful.push({ photo, operation });
        results.push({ id: photo.id, destPath: operation.finalPath });
      } catch (error) {
        errorCount++;
        results.push({ id: photo.id, error: error.message });
      }
    }

    const persist = req.db.transaction(() => {
      for (const { photo, operation } of successful) {
        markPhotoCopied(req.db, photo.id, {
          destPath: operation.finalPath,
          outputOwned: true,
          outputOperation: 'override',
        });
      }
      if (errorCount > 0) {
        req.db.prepare('UPDATE jobs SET errors = errors + ? WHERE id = ?')
          .run(errorCount, job.id);
      }
      updateJobStatus(req.db, job.id, 'done');
    });

    try {
      persist();
    } catch (error) {
      for (const { operation } of successful.reverse()) operation.rollback();
      throw error;
    }
    for (const { operation } of successful) operation.commit();

    res.json({
      overridden: successful.length,
      errors: errorCount,
      results,
      job: getJob(req.db, job.id),
    });
  } catch (error) {
    updateJobStatus(req.db, job.id, 'done', { error_message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    overrideLocks.delete(job.id);
  }
});

module.exports = router;
