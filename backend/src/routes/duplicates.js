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
const {
  listDuplicates, countDuplicates, recordDuplicateResolution,
  getDuplicate, getJob, getPhoto, listJobsWithDuplicates, markPhotoCopied,
} = require('../db/dao');
const { assertNotInSource } = require('../sourceGuard');
const { installNewFile, replaceFileWithRollback } = require('../services/atomicFile');
const { boundedInteger, boundedString, enumValue, validateForResponse } = require('../security/validation');

const router = Router();

/* List duplicates */
router.get('/', (req, res) => {
  const { jobId, resolution, limit, offset } = req.query;
  const validation = validateForResponse(res, () => ({
    jobId: boundedString(jobId, 'jobId', { maximum: 100 }),
    resolution: resolution === undefined ? undefined : enumValue(resolution, 'resolution', ['undecided', 'ignore', 'keep_overwrite', 'keep_rename']),
    limit: boundedInteger(limit, 'limit', { defaultValue: 100, minimum: 1, maximum: 500 }),
    offset: boundedInteger(offset, 'offset', { defaultValue: 0, minimum: 0, maximum: 1_000_000 }),
  }));
  if (!validation.ok) return;
  const duplicates = listDuplicates(req.db, {
    ...validation.value,
  });
  const total = countDuplicates(req.db, validation.value);
  res.json({ duplicates, total });
});

/* List jobs that have duplicates (for the job dropdown) */
router.get('/jobs', (req, res) => {
  const jobsWithDups = listJobsWithDuplicates(req.db).map((j) => ({
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
  if (dup.operation_status === 'succeeded' && resolution !== dup.resolution) {
    return res.status(409).json({
      error: 'This file operation has already been applied and cannot be reset automatically',
    });
  }

  const job = getJob(req.db, dup.job_id);
  const srcFile = dup.src_path;         // in source dir — READ ONLY
  const matchedFile = dup.matched_path;  // in destination dir

  const photo = getPhoto(req.db, dup.photo_id);
  if (!photo) return res.status(409).json({ error: 'Source photo record no longer exists' });

  if (resolution === 'ignore' || resolution === 'undecided') {
    recordDuplicateResolution(req.db, req.params.id, {
      resolution,
      status: 'decision_only',
      appliedAt: resolution === 'ignore' ? new Date().toISOString() : null,
    });
    return res.json({ id: req.params.id, resolution, status: 'decision_only' });
  }

  if (!srcFile || !fs.existsSync(srcFile)) {
    return res.status(409).json({ error: `Source file no longer exists: ${srcFile}` });
  }

  let operation;
  try {
    if (resolution === 'keep_overwrite') {
      if (!matchedFile || !fs.existsSync(matchedFile)) {
        return res.status(409).json({ error: 'Matched destination file no longer exists' });
      }
      assertNotInSource(req.db, matchedFile);
      operation = replaceFileWithRollback(srcFile, matchedFile);
    } else {
      const targetDirectory = matchedFile
        ? path.dirname(matchedFile)
        : job?.dest_dir;
      if (!targetDirectory) {
        return res.status(409).json({ error: 'Cannot determine destination directory' });
      }
      const requestedPath = path.join(targetDirectory, path.basename(srcFile));
      assertNotInSource(req.db, requestedPath);
      operation = installNewFile(srcFile, requestedPath);
    }

    const persist = req.db.transaction(() => {
      markPhotoCopied(req.db, photo.id, {
        destPath: operation.finalPath,
        outputOwned: resolution === 'keep_rename',
        outputOperation: resolution === 'keep_rename' ? 'keep_both' : 'overwrite',
      });
      recordDuplicateResolution(req.db, req.params.id, {
        resolution,
        status: 'succeeded',
        appliedAt: new Date().toISOString(),
      });
    });

    try {
      persist();
    } catch (error) {
      operation.rollback();
      throw error;
    }
    operation.commit();
    return res.json({
      id: req.params.id,
      resolution,
      status: 'succeeded',
      destPath: operation.finalPath,
    });
  } catch (error) {
    console.error(`[resolve ${req.params.id}] file operation failed:`, error.message);
    try {
      recordDuplicateResolution(req.db, req.params.id, {
        resolution,
        status: 'failed',
        error: error.message,
        appliedAt: new Date().toISOString(),
      });
    } catch { /* retain original failure */ }
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
