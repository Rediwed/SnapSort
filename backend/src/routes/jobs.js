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

/* Get single job */
router.get('/:id', (req, res) => {
  const job = getJob(req.db, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/* Create a new job */
router.post('/', (req, res) => {
  const { sourceDir, destDir, mode, minWidth, minHeight, minFilesize } = req.body;
  if (!sourceDir || !destDir) {
    return res.status(400).json({ error: 'sourceDir and destDir are required' });
  }
  const job = createJob(req.db, { sourceDir, destDir, mode, minWidth, minHeight, minFilesize });
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

module.exports = router;
