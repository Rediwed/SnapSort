/**
 * /api/jobs — CRUD + start / cancel organizer runs.
 */

const { Router } = require('express');
const {
  createJob, getJob, listJobs, updateJobStatus, deleteJob,
} = require('../db/dao');
const { startJob, cancelJob } = require('../services/pythonBridge');

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
      if (fs.existsSync(p)) { fs.unlinkSync(p); deleted++; }
    } catch { failed++; }
  }
  deleteJob(req.db, req.params.id);
  res.json({ deleted, failed, total: paths.length });
});

module.exports = router;
