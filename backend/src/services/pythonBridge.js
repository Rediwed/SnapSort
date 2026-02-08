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

/* Map of jobId → child process so we can cancel */
const activeProcesses = new Map();

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
    env: { ...process.env, SNAPSORT_JSON_MODE: '1' },
  });

  activeProcesses.set(job.id, child);

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
        /* not JSON — ignore (plain log output) */
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    console.error(`[job ${job.id}] stderr: ${chunk}`);
  });

  child.on('close', (code) => {
    activeProcesses.delete(job.id);
    const status = code === 0 ? 'done' : 'error';
    updateJobStatus(db, job.id, status, {
      finished_at: new Date().toISOString(),
      ...(code !== 0 ? { error_message: `Process exited with code ${code}` } : {}),
    });
  });
}

/**
 * Cancel a running job.
 */
function cancelJob(jobId) {
  const child = activeProcesses.get(jobId);
  if (child) {
    child.kill('SIGTERM');
    activeProcesses.delete(jobId);
  }
}

/**
 * Handle a single JSON event from the Python process.
 */
function handleEvent(db, jobId, evt) {
  switch (evt.event) {
    case 'progress':
      updateJobStatus(db, jobId, 'running', {
        processed: evt.processed,
        copied: evt.copied,
        skipped: evt.skipped,
        errors: evt.errors,
        total_files: evt.total_files || 0,
      });
      break;

    case 'photo':
      insertPhoto(db, {
        id: uuidv4(),
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
      });
      break;

    case 'duplicate':
      insertDuplicate(db, {
        id: uuidv4(),
        jobId,
        photoId: evt.photo_id || uuidv4(),
        matchedPhotoId: evt.matched_photo_id || null,
        srcPath: evt.src_path,
        matchedPath: evt.matched_path || null,
        similarity: evt.similarity || 0,
      });
      break;

    case 'done':
      updateJobStatus(db, jobId, 'done', {
        finished_at: new Date().toISOString(),
        total_bytes: evt.summary?.total_bytes || 0,
      });
      break;

    case 'error':
      updateJobStatus(db, jobId, 'error', {
        error_message: evt.message,
        finished_at: new Date().toISOString(),
      });
      break;

    default:
      break;
  }
}

module.exports = { startJob, cancelJob };
