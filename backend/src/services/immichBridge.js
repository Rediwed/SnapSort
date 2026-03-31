/**
 * Immich bridge — spawns immich-go to upload photos from a job's destination
 * directory to an Immich server.
 *
 * Parses immich-go's stdout/stderr for progress:
 *   - "Uploaded N" — count of uploaded assets
 *   - "Upload errors: N" — count of errors
 *   - "Assets found: N" — total assets discovered
 *   - "server has duplicate" lines — count of dupes
 */

const { spawn, execSync } = require('child_process');
const { getAllSettings, getJob } = require('../db/dao');
const { updateImmichStatus } = require('../db/dao');
const { notifyImmichUploadStarted, notifyImmichUploadCompleted, notifyImmichUploadError } = require('./ntfyService');

const activeUploads = new Map();  // jobId → child process
const cancelledUploads = new Set();

/**
 * Check if immich-go is available in PATH.
 */
function isImmichGoAvailable() {
  try {
    execSync('immich-go version 2>/dev/null', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get immich-go version string.
 */
function getImmichGoVersion() {
  try {
    return execSync('immich-go version 2>&1', { timeout: 5000 }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Start an Immich upload for a completed job.
 */
function startImmichUpload(db, job) {
  const settings = getAllSettings(db);

  const server = settings.immich_server;
  const apiKey = settings.immich_api_key;
  if (!server || !apiKey) {
    throw new Error('Immich server URL and API key must be configured');
  }

  const args = [
    'upload', 'from-folder',
    '--server', server,
    '--api-key', apiKey,
    '--no-ui',
  ];

  // Album mode
  const albumMode = settings.immich_album_mode || 'none';
  if (albumMode === 'job_name' && job.name) {
    args.push('--into-album', job.name);
  } else if (albumMode === 'folder_as_album') {
    args.push('--folder-as-album');
  }

  // Dry run
  if (settings.immich_dry_run === 'true') {
    args.push('--dry-run');
  }

  // The folder to upload
  args.push(job.dest_dir);

  console.log(`[immich ${job.id}] Starting upload: immich-go ${args.join(' ').replace(apiKey, '****')}`);

  const child = spawn('immich-go', args, {
    env: { ...process.env },
  });

  activeUploads.set(job.id, child);

  // Update status
  updateImmichStatus(db, job.id, 'running', {
    immich_started_at: new Date().toISOString(),
    immich_error_message: null,
  });

  // Send notification
  notifyImmichUploadStarted(db, job);

  // Track stats parsed from output
  const stats = { uploaded: 0, errors: 0, duplicates: 0, assets: 0 };

  // Parse output for progress
  let buffer = '';
  const parseOutput = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`[immich ${job.id}] ${line}`);

      // Parse stats from immich-go output
      const uploadedMatch = line.match(/Uploaded\s+(\d+)/);
      if (uploadedMatch) stats.uploaded = parseInt(uploadedMatch[1], 10);

      const errorsMatch = line.match(/Upload errors:\s*(\d+)/);
      if (errorsMatch) stats.errors = parseInt(errorsMatch[1], 10);

      const assetsMatch = line.match(/Assets found:\s*(\d+)/);
      if (assetsMatch) stats.assets = parseInt(assetsMatch[1], 10);

      const dupeMatch = line.match(/server has duplicate/);
      if (dupeMatch) {
        // Count occurrences — each line with "server has duplicate" is one dupe
        stats.duplicates++;
      }

      // Also check for "Duplicates: N" style output
      const dupCountMatch = line.match(/(?:Duplicates|duplicates):\s*(\d+)/);
      if (dupCountMatch) stats.duplicates = parseInt(dupCountMatch[1], 10);

      // Update DB periodically with latest stats
      try {
        updateImmichStatus(db, job.id, 'running', {
          immich_uploaded: stats.uploaded,
          immich_errors: stats.errors,
          immich_duplicates: stats.duplicates,
          immich_assets: stats.assets,
        });
      } catch { /* db write may fail during shutdown */ }
    }
  };

  child.stdout.on('data', parseOutput);
  child.stderr.on('data', parseOutput);

  child.on('error', (err) => {
    console.error(`[immich ${job.id}] Failed to start immich-go: ${err.message}`);
    activeUploads.delete(job.id);
    updateImmichStatus(db, job.id, 'error', {
      immich_error_message: `Failed to start immich-go: ${err.message}`,
      immich_finished_at: new Date().toISOString(),
    });
    const freshJob = getJob(db, job.id);
    notifyImmichUploadError(db, freshJob || job, `Failed to start immich-go: ${err.message}`);
  });

  child.on('close', (code) => {
    activeUploads.delete(job.id);

    if (cancelledUploads.has(job.id)) {
      cancelledUploads.delete(job.id);
      return;
    }

    if (code === 0) {
      console.log(`[immich ${job.id}] Upload complete — uploaded=${stats.uploaded} dupes=${stats.duplicates} errors=${stats.errors}`);
      updateImmichStatus(db, job.id, 'done', {
        immich_uploaded: stats.uploaded,
        immich_duplicates: stats.duplicates,
        immich_errors: stats.errors,
        immich_assets: stats.assets,
        immich_finished_at: new Date().toISOString(),
      });
      const freshJob = getJob(db, job.id);
      notifyImmichUploadCompleted(db, freshJob || job);
    } else {
      const message = `immich-go exited with code ${code}`;
      console.error(`[immich ${job.id}] ${message}`);
      updateImmichStatus(db, job.id, 'error', {
        immich_uploaded: stats.uploaded,
        immich_duplicates: stats.duplicates,
        immich_errors: stats.errors,
        immich_assets: stats.assets,
        immich_error_message: message,
        immich_finished_at: new Date().toISOString(),
      });
      const freshJob = getJob(db, job.id);
      notifyImmichUploadError(db, freshJob || job, message);
    }
  });
}

/**
 * Cancel a running Immich upload.
 */
function cancelImmichUpload(jobId) {
  const child = activeUploads.get(jobId);
  if (child) {
    cancelledUploads.add(jobId);
    child.kill('SIGTERM');
    activeUploads.delete(jobId);
  }
}

/**
 * Return list of active immich upload job IDs.
 */
function getActiveImmichUploadIds() {
  return [...activeUploads.keys()];
}

module.exports = {
  isImmichGoAvailable,
  getImmichGoVersion,
  startImmichUpload,
  cancelImmichUpload,
  getActiveImmichUploadIds,
};
