/**
 * /api/duplicates — list & resolve duplicate pairs.
 *
 * Resolutions perform real file operations at the DESTINATION:
 *   ignore        — do nothing (source stays un-copied, destination match stays)
 *   keep_overwrite — copy source file over the matched destination file
 *   keep_rename    — copy source file alongside the match with a unique name
 *   undecided      — reset (no file operation)
 *
 * ⚠️  SOURCE SAFETY: only destination paths are ever written to.
 *     Source files are strictly read-only.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { listDuplicates, countDuplicates, resolveDuplicate, getDuplicate, getJob, getPhoto, listJobs } = require('../db/dao');
const { assertNotInSource } = require('../sourceGuard');

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

/* Resolve a duplicate (ignore / keep_overwrite / keep_rename / undecided) */
router.patch('/:id', async (req, res) => {
  const { resolution } = req.body;
  if (!['ignore', 'keep_overwrite', 'keep_rename', 'undecided'].includes(resolution)) {
    return res.status(400).json({ error: 'resolution must be ignore | keep_overwrite | keep_rename | undecided' });
  }

  const dup = getDuplicate(req.db, req.params.id);
  if (!dup) return res.status(404).json({ error: 'duplicate not found' });

  const job = getJob(req.db, dup.job_id);
  const srcFile = dup.src_path;         // in source dir — READ ONLY
  const matchedFile = dup.matched_path;  // in destination dir

  try {
    if (resolution === 'keep_overwrite' && srcFile && matchedFile) {
      /* Copy source → matched destination path (overwrite) */
      assertNotInSource(req.db, matchedFile);
      if (!fs.existsSync(srcFile)) {
        return res.status(409).json({ error: `Source file no longer exists: ${srcFile}` });
      }
      fs.mkdirSync(path.dirname(matchedFile), { recursive: true });
      fs.copyFileSync(srcFile, matchedFile);

      /* Update the photo record so the UI reflects the new state */
      const photo = getPhoto(req.db, dup.photo_id);
      if (photo) {
        req.db.prepare('UPDATE photos SET status = ?, dest_path = ?, skip_reason = NULL, overridden_at = ? WHERE id = ?')
          .run('copied', matchedFile, new Date().toISOString(), photo.id);
      }
    } else if (resolution === 'keep_rename' && srcFile) {
      /* Copy source → destination with a unique filename alongside the match */
      const destDir = job ? job.dest_dir : (matchedFile ? path.dirname(matchedFile) : null);
      if (!destDir) {
        return res.status(409).json({ error: 'Cannot determine destination directory' });
      }
      if (!fs.existsSync(srcFile)) {
        return res.status(409).json({ error: `Source file no longer exists: ${srcFile}` });
      }

      /* Build a unique destination path next to the matched file */
      const ext = path.extname(srcFile);
      const base = path.basename(srcFile, ext);
      const targetDir = matchedFile ? path.dirname(matchedFile) : destDir;
      let destPath = path.join(targetDir, `${base}${ext}`);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(targetDir, `${base}_${counter}${ext}`);
        counter++;
      }

      assertNotInSource(req.db, destPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcFile, destPath);

      /* Update the photo record */
      const photo = getPhoto(req.db, dup.photo_id);
      if (photo) {
        req.db.prepare('UPDATE photos SET status = ?, dest_path = ?, skip_reason = NULL, overridden_at = ? WHERE id = ?')
          .run('copied', destPath, new Date().toISOString(), photo.id);
      }
    }
    /* ignore / undecided — no file operation */
  } catch (err) {
    console.error(`[resolve ${req.params.id}] file operation failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }

  resolveDuplicate(req.db, req.params.id, resolution);
  res.json({ id: req.params.id, resolution });
});

module.exports = router;
