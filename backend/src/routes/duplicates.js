/**
 * /api/duplicates — list & resolve duplicate pairs.
 */

const { Router } = require('express');
const { listDuplicates, countDuplicates, resolveDuplicate, listJobs } = require('../db/dao');

const router = Router();

/* List duplicates */
router.get('/', (req, res) => {
  const { jobId, resolution, limit, offset } = req.query;
  const duplicates = listDuplicates(req.db, {
    jobId,
    resolution,
    limit: limit ? Number(limit) : 100,
    offset: offset ? Number(offset) : 0,
  });
  const total = countDuplicates(req.db, { jobId, resolution });
  res.json({ duplicates, total });
});

/* List jobs that have duplicates (for the job dropdown) */
router.get('/jobs', (req, res) => {
  const jobs = listJobs(req.db, { limit: 500 });
  const jobsWithDups = jobs.filter((j) => {
    const count = countDuplicates(req.db, { jobId: j.id });
    return count > 0;
  }).map((j) => ({
    id: j.id,
    source_dir: j.source_dir,
    dest_dir: j.dest_dir,
    status: j.status,
    created_at: j.created_at,
  }));
  res.json(jobsWithDups);
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

/*
 * ⚠️  SOURCE SAFETY PRINCIPLE
 *
 * SnapSort NEVER writes to, modifies, or deletes files in source directories.
 * Source paths are strictly read-only.  The "delete" resolution is a label
 * only — it marks the duplicate for the user's records but does NOT touch
 * the file on disk.
 */

module.exports = router;
