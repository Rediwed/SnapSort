/**
 * Python bridge — spawns the SnapSort Python organizer as a child process
 * and streams its JSON-line progress back into the database.
 *
 * The Python script is invoked with a small JSON config on stdin.
 * It writes newline-delimited JSON events to stdout that this bridge
 * parses and persists.
 *
 * Events the Python side emits:
 *   { "event": "progress", "processed": N, "copied": N, "skipped": N, "errors": N, "total_files": N }
 *   { "event": "photo",    "src_path": "...", "dest_path": "...", "status": "copied|skipped|error", ... }
 *   { "event": "duplicate","src_path": "...", "matched_path": "...", "similarity": 92.3, ... }
 *   { "event": "done",     "summary": { ... } }
 *   { "event": "error",    "message": "..." }
 */

const { spawn } = require('child_process');
const path = require('path');
const { updateJobStatus, insertPhoto, insertDuplicate, getAllSettings, getProfile } = require('../db/dao');
const { v4: uuidv4 } = require('uuid');
const {
  notifyJobStarted, notifyJobCompleted, notifyJobError,
  notifyJobCancelled, stopProgressTimer,
} = require('./ntfyService');

/* Map of jobId → child process so we can cancel */
const activeProcesses = new Map();
/* Map of jobId → Map(src_path → photoId) so duplicate events can reference the correct photo */
const photoIdMaps = new Map();
/* Map of jobId → { currentFile, timestamp } for live file tracking */
const currentFiles = new Map();
/* Set of jobIds that have been cancelled by the user — prevents the close handler from overwriting the status */
const cancelledJobs = new Set();

/**
 * Start a job by spawning the Python organizer.
 */
function startJob(db, job) {
  const pythonScript = path.join(__dirname, '..', '..', '..', 'photo_organizer.py');

  /* Pull global settings to forward threading / format prefs to Python */
  const settings = getAllSettings(db);

  /* Resolve performance profile: job-level > global default > built-in 'default' */
  const profileId = job.performance_profile || settings.default_performance_profile || 'default';
  const profile = getProfile(db, profileId);

  /* Merge: profile values win over global settings */
  const perfConfig = {
    enable_multithreading: profile ? (profile.enable_multithreading ? 'true' : 'false') : (settings.enable_multithreading || 'false'),
    max_worker_threads: profile ? String(profile.max_workers) : (settings.max_worker_threads || '4'),
    parallel_hash_workers: settings.parallel_hash_workers || '4',
    batch_size: profile ? String(profile.batch_size) : (settings.batch_size || '25'),
    hash_bytes: profile ? String(profile.hash_bytes) : (settings.fast_hash_bytes || settings.hash_bytes || '8192'),
    concurrent_copies: profile ? String(profile.concurrent_copies) : (settings.concurrent_copies || '2'),
    sequential_processing: profile ? (profile.sequential_processing ? 'true' : 'false') : (settings.sequential_processing || 'false'),
    enable_fast_hash: settings.enable_fast_hash || 'true',
  };

  const config = JSON.stringify({
    source_dir: job.source_dir,
    dest_dir: job.dest_dir,
    mode: job.mode,
    min_width: job.min_width,
    min_height: job.min_height,
    min_filesize: job.min_filesize,
    job_id: job.id,
    json_output: true,
    /* Performance / threading (merged from profile + global settings) */
    ...perfConfig,
    /* Dedup thresholds from global settings */
    dedup_strict_threshold: settings.dedup_strict_threshold || '90',
    dedup_log_threshold: settings.dedup_log_threshold || '70',
    /* Supported file formats (comma-separated extensions) */
    supported_extensions: settings.supported_extensions || '',
  });

  const child = spawn('python3', [pythonScript, '--json-config', '-'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    env: {
      ...process.env,
      SNAPSORT_JSON_MODE: '1',
      /* Forward demo mode so Python adds a per-file delay */
      ...(process.env.SNAPSORT_DEMO ? { SNAPSORT_DEMO: process.env.SNAPSORT_DEMO } : {}),
      ...(process.env.SNAPSORT_DEMO_DELAY ? { SNAPSORT_DEMO_DELAY: process.env.SNAPSORT_DEMO_DELAY } : {}),
    },
  });

  activeProcesses.set(job.id, child);
  photoIdMaps.set(job.id, new Map());
  currentFiles.set(job.id, { currentFile: null, timestamp: Date.now() });

  console.log(`[job ${job.id}] Started — mode=${job.mode} source=${job.source_dir} dest=${job.dest_dir}`);

  /* Send ntfy notification for job start */
  notifyJobStarted(db, job);

  /* Track whether the Python process sent an error event with a descriptive message */
  let pythonErrorMessage = null;

  /* Feed config via stdin */
  child.stdin.write(config);
  child.stdin.end();

  /* Parse JSON-line events from stdout */
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete tail
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        handleEvent(db, job.id, evt);
      } catch {
        /* Forward non-JSON Python output to console so it appears in Docker logs */
        console.log(`[job ${job.id}] ${line}`);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    console.error(`[job ${job.id}] stderr: ${chunk}`);
  });

  child.on('error', (err) => {
    console.error(`[job ${job.id}] Failed to start Python process: ${err.message}`);
    activeProcesses.delete(job.id);
    photoIdMaps.delete(job.id);
    currentFiles.delete(job.id);
    updateJobStatus(db, job.id, 'error', {
      error_message: `Failed to start Python process: ${err.message}`,
      finished_at: new Date().toISOString(),
    });
    notifyJobError(db, job, `Failed to start Python process: ${err.message}`);
  });

  child.on('close', (code) => {
    activeProcesses.delete(job.id);
    photoIdMaps.delete(job.id);
    currentFiles.delete(job.id);
    /* If this job was cancelled by the user, the route already set the correct status — skip */
    if (cancelledJobs.has(job.id)) {
      cancelledJobs.delete(job.id);
      return;
    }
    /* Re-read the job for final counters */
    let finalJob;
    try {
      const { getJob } = require('../db/dao');
      finalJob = getJob(db, job.id);
    } catch { finalJob = job; }

    if (code === 0) {
      /* Only mark done if the Python error handler didn't already set an error */
      if (!pythonErrorMessage) {
        updateJobStatus(db, job.id, 'done', { finished_at: new Date().toISOString() });
        notifyJobCompleted(db, finalJob);
      } else {
        notifyJobError(db, finalJob, pythonErrorMessage);
      }
    } else {
      /* Preserve the descriptive error from Python's error event if we have one */
      const message = pythonErrorMessage || `Process exited with code ${code}`;
      console.error(`[job ${job.id}] Python process exited with code ${code}: ${message}`);
      updateJobStatus(db, job.id, 'error', {
        error_message: message,
        finished_at: new Date().toISOString(),
      });
      notifyJobError(db, finalJob, message);
    }
  });
}

/**
 * Cancel a running job.
 */
function cancelJob(jobId, db) {
  const child = activeProcesses.get(jobId);
  if (child) {
    cancelledJobs.add(jobId);
    child.kill('SIGTERM');
    activeProcesses.delete(jobId);
    photoIdMaps.delete(jobId);
    currentFiles.delete(jobId);
    /* Update status in DB if a db handle was provided (e.g. during shutdown) */
    if (db) {
      try {
        updateJobStatus(db, jobId, 'cancelled', {
          finished_at: new Date().toISOString(),
          error_message: 'Job cancelled due to server shutdown',
        });
      } catch { /* db may already be closed */ }
    }
  }
}

/**
 * Handle a single JSON event from the Python process.
 */
function handleEvent(db, jobId, evt) {
  switch (evt.event) {
    case 'scanning': {
      const phase = evt.phase || 'scanning';
      const discovered = evt.discovered || 0;
      const message = evt.message || null;
      if (message) console.log(`[job ${jobId}] Scanning: ${message}`);
      else console.log(`[job ${jobId}] Scanning: discovered ${discovered} photos`);
      currentFiles.set(jobId, {
        currentFile: message || `Discovered ${discovered} photos...`,
        status: 'scanning',
        phase,
        discovered,
        timestamp: Date.now(),
      });
      break;
    }

    case 'progress': {
      const total = evt.total_files || 0;
      const pct = total > 0 ? Math.round((evt.processed / total) * 100) : '?';
      console.log(`[job ${jobId}] Progress: ${evt.processed}/${total} (${pct}%) — copied=${evt.copied} skipped=${evt.skipped} errors=${evt.errors}`);
      updateJobStatus(db, jobId, 'running', {
        processed: evt.processed,
        copied: evt.copied,
        skipped: evt.skipped,
        errors: evt.errors,
        total_files: total,
      });
      break;
    }

    case 'photo': {
      const photoId = uuidv4();
      /* Track current file for live indicator */
      currentFiles.set(jobId, {
        currentFile: evt.filename || path.basename(evt.src_path),
        status: evt.status,
        timestamp: Date.now(),
      });
      insertPhoto(db, {
        id: photoId,
        jobId,
        srcPath: evt.src_path,
        destPath: evt.dest_path || null,
        filename: evt.filename || path.basename(evt.src_path),
        extension: path.extname(evt.src_path).toLowerCase(),
        fileSize: evt.file_size || 0,
        width: evt.width || null,
        height: evt.height || null,
        dateTaken: evt.date_taken || null,
        status: evt.status,
        skipReason: evt.skip_reason || null,
        hash: evt.hash || null,
        dpi: evt.dpi || null,
      });
      /* Remember the photo ID so the subsequent duplicate event can reference it */
      const idMap = photoIdMaps.get(jobId);
      if (idMap) idMap.set(evt.src_path, photoId);
      break;
    }

    case 'duplicate': {
      /* Look up the photo row we just inserted for this src_path */
      const map = photoIdMaps.get(jobId);
      const photoId = (map && map.get(evt.src_path)) || null;
      if (!photoId) {
        console.warn(`[job ${jobId}] duplicate event for unknown photo: ${evt.src_path}`);
        break;
      }
      /* Try to find matched_photo_id by querying photos with the matched_path */
      let matchedPhotoId = null;
      if (evt.matched_path) {
        const row = db.prepare('SELECT id FROM photos WHERE job_id = ? AND (dest_path = ? OR src_path = ?) LIMIT 1')
          .get(jobId, evt.matched_path, evt.matched_path);
        if (row) matchedPhotoId = row.id;
      }
      try {
        insertDuplicate(db, {
          id: uuidv4(),
          jobId,
          photoId,
          matchedPhotoId,
          srcPath: evt.src_path,
          matchedPath: evt.matched_path || null,
          similarity: evt.similarity || 0,
        });
      } catch (err) {
        console.error(`[job ${jobId}] failed to insert duplicate: ${err.message}`);
      }
      break;
    }

    case 'done':
      console.log(`[job ${jobId}] Done — total_bytes=${evt.summary?.total_bytes || 0}`);
      updateJobStatus(db, jobId, 'done', {
        finished_at: new Date().toISOString(),
        total_bytes: evt.summary?.total_bytes || 0,
      });
      break;

    case 'error':
      console.error(`[job ${jobId}] Python error: ${evt.message}`);
      updateJobStatus(db, jobId, 'error', {
        error_message: evt.message,
        finished_at: new Date().toISOString(),
      });
      break;

    default:
      break;
  }
}

/**
 * Return map of active job IDs for use by the route layer.
 */
function getActiveJobIds() {
  return [...activeProcesses.keys()];
}

/**
 * Return current file info for a job.
 */
function getCurrentFile(jobId) {
  return currentFiles.get(jobId) || null;
}

module.exports = { startJob, cancelJob, getActiveJobIds, getCurrentFile };
