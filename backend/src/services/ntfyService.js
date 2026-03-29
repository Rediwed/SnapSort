/**
 * ntfy.sh notification service — sends push notifications for job/drive events.
 *
 * Supports:
 *   - Default ntfy.sh or custom self-hosted servers
 *   - Token-based and Basic authentication
 *   - Configurable events: job start, progress, completion, errors, drive scans
 *   - Recurring in-progress updates on a configurable interval
 */

const { getAllSettings } = require('../db/dao');
const { broadcast } = require('./browserNotifyService');

/* ── Helpers ──────────────────────────────────────────────────────── */

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function pct(n, total) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function duration(startIso) {
  if (!startIso) return '';
  const ms = Date.now() - new Date(startIso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/* ── Core send function ───────────────────────────────────────────── */

/**
 * Send a notification via ntfy.
 * @param {object} settings  - All settings from DB (key/value object)
 * @param {object} opts      - { title, message, priority, tags, click }
 */
async function send(settings, { title, message, priority, tags }) {
  const server = (settings.ntfy_server || 'https://ntfy.sh').replace(/\/+$/, '');
  const topic = settings.ntfy_topic || 'snapsort';
  const url = `${server}`;

  const headers = { 'Content-Type': 'application/json' };
  const authType = settings.ntfy_auth_type || 'none';
  if (authType === 'token' && settings.ntfy_auth_token) {
    headers['Authorization'] = `Bearer ${settings.ntfy_auth_token}`;
  } else if (authType === 'basic' && settings.ntfy_username && settings.ntfy_password) {
    const b64 = Buffer.from(`${settings.ntfy_username}:${settings.ntfy_password}`).toString('base64');
    headers['Authorization'] = `Basic ${b64}`;
  }

  const payload = { topic, message: message || '' };
  if (title) payload.title = title;
  if (priority) payload.priority = Number(priority) || 3;
  if (tags) payload.tags = tags.split(',').map((t) => t.trim());

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`ntfy HTTP ${res.status}: ${body}`);
    console.error(`[ntfy] ${err.message}`);
    throw err;
  }
}

/**
 * Fire-and-forget wrapper — logs errors but never throws.
 * Used by all lifecycle notifications (not the test endpoint).
 */
async function sendQuiet(settings, opts) {
  try {
    await send(settings, opts);
  } catch (err) {
    console.error(`[ntfy] ${err.message}`);
  }
}

/* ── Guard: is ntfy enabled + is this event type enabled? ─────────── */

function isEnabled(settings, eventKey) {
  if (settings.ntfy_enabled !== 'true') return false;
  if (eventKey && settings[eventKey] !== 'true') return false;
  return true;
}

function isBrowserEnabled(settings, eventKey) {
  if (settings.browser_notify_enabled !== 'true') return false;
  if (eventKey && settings[eventKey] !== 'true') return false;
  return true;
}

/** Check if any notification channel is enabled for this event */
function anyEnabled(settings, eventKey) {
  return isEnabled(settings, eventKey) || isBrowserEnabled(settings, eventKey);
}

function loadSettings(db) {
  try {
    return getAllSettings(db);
  } catch {
    return {};
  }
}

/* ── Progress interval tracking ───────────────────────────────────── */

/**
 * Map of jobId → { timer, lastSent } for recurring progress updates.
 * We throttle progress notifications to the user-configured interval.
 */
const progressTimers = new Map();

function startProgressTimer(db, jobId, job) {
  stopProgressTimer(jobId);

  const settings = loadSettings(db);
  if (!isEnabled(settings, 'ntfy_on_progress')) return;

  const intervalSec = Math.max(10, Number(settings.ntfy_progress_interval) || 30);

  const timer = setInterval(() => {
    const freshSettings = loadSettings(db);
    if (!isEnabled(freshSettings, 'ntfy_on_progress')) {
      stopProgressTimer(jobId);
      return;
    }
    /* Re-read job from DB for latest counters */
    try {
      const { getJob } = require('../db/dao');
      const current = getJob(db, jobId);
      if (!current || current.status !== 'running') {
        stopProgressTimer(jobId);
        return;
      }
      notifyJobProgressNow(freshSettings, current);
    } catch {
      stopProgressTimer(jobId);
    }
  }, intervalSec * 1000);

  progressTimers.set(jobId, timer);
}

function stopProgressTimer(jobId) {
  const timer = progressTimers.get(jobId);
  if (timer) {
    clearInterval(timer);
    progressTimers.delete(jobId);
  }
}

/* ── Public notification methods ──────────────────────────────────── */

/** Job started */
function notifyJobStarted(db, job) {
  const settings = loadSettings(db);

  const mode = job.mode || 'normal';
  const label = job.name || job.id.slice(0, 8);
  const title = `📂 Job Started — ${label}`;
  const body = `Mode: ${mode}\nSource: ${job.source_dir}\nDest: ${job.dest_dir}`;

  if (isEnabled(settings, 'ntfy_on_job_start')) {
    sendQuiet(settings, { title, message: body, priority: '3', tags: 'arrow_forward' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_job_start')) {
    broadcast({ type: 'job_started', title, body });
  }

  /* Start recurring progress timer */
  startProgressTimer(db, job.id, job);
}

/** In-progress update (called on the timer interval) */
function notifyJobProgressNow(settings, job) {
  const elapsed = duration(job.started_at);
  const lines = [
    `Processed: ${job.processed}/${job.total_files} (${pct(job.processed, job.total_files)})`,
    `Copied: ${job.copied}  |  Skipped: ${job.skipped}  |  Errors: ${job.errors}`,
  ];
  if (elapsed) lines.push(`Elapsed: ${elapsed}`);

  const label = job.name || job.id.slice(0, 8);
  sendQuiet(settings, {
    title: `⏳ ${label} — ${pct(job.processed, job.total_files)}`,
    message: lines.join('\n'),
    priority: '2',
    tags: 'hourglass_flowing_sand',
  });
}

/** Job completed successfully */
function notifyJobCompleted(db, job) {
  stopProgressTimer(job.id);

  const settings = loadSettings(db);
  const elapsed = duration(job.started_at);
  const label = job.name || job.id.slice(0, 8);
  const lines = [
    `Source: ${job.source_dir}`,
    `Total: ${job.total_files}  |  Copied: ${job.copied}  |  Skipped: ${job.skipped}  |  Errors: ${job.errors}`,
  ];
  if (job.total_bytes) lines.push(`Data copied: ${formatBytes(job.total_bytes)}`);
  if (elapsed) lines.push(`Duration: ${elapsed}`);

  const title = `✅ ${label} — Completed`;
  const body = lines.join('\n');

  if (isEnabled(settings, 'ntfy_on_job_complete')) {
    sendQuiet(settings, { title, message: body, priority: '3', tags: 'white_check_mark' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_job_complete')) {
    broadcast({ type: 'job_completed', title, body });
  }
}

/** Job failed */
function notifyJobError(db, job, errorMessage) {
  stopProgressTimer(job.id);

  const settings = loadSettings(db);
  const label = job.name || job.id.slice(0, 8);
  const lines = [`Source: ${job.source_dir}`];
  if (job.processed) {
    lines.push(`Progress before error: ${job.processed}/${job.total_files}`);
  }
  if (errorMessage) lines.push(`Error: ${errorMessage}`);

  const title = `❌ ${label} — Failed`;
  const body = lines.join('\n');

  if (isEnabled(settings, 'ntfy_on_job_error')) {
    sendQuiet(settings, { title, message: body, priority: '4', tags: 'x' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_job_error')) {
    broadcast({ type: 'job_error', title, body });
  }
}

/** Job cancelled */
function notifyJobCancelled(db, job) {
  stopProgressTimer(job.id);

  const settings = loadSettings(db);
  const label = job.name || job.id.slice(0, 8);
  const lines = [
    `Source: ${job.source_dir}`,
    `Processed: ${job.processed}/${job.total_files}  |  Copied: ${job.copied}`,
  ];

  const title = `🚫 ${label} — Cancelled`;
  const body = lines.join('\n');

  if (isEnabled(settings, 'ntfy_on_job_complete')) {
    sendQuiet(settings, { title, message: body, priority: '3', tags: 'no_entry_sign' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_job_complete')) {
    broadcast({ type: 'job_cancelled', title, body });
  }
}

/** Drive prescan started */
function notifyDriveScanStarted(db, drivePath) {
  const settings = loadSettings(db);

  const title = '🔍 Drive Scan Started';
  const body = `Scanning: ${drivePath}`;

  if (isEnabled(settings, 'ntfy_on_drive_scan')) {
    sendQuiet(settings, { title, message: body, priority: '2', tags: 'mag' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_drive_scan')) {
    broadcast({ type: 'drive_scan_started', title, body });
  }
}

/** Drive prescan completed */
function notifyDriveScanCompleted(db, drivePath, result) {
  const settings = loadSettings(db);

  const lines = [`Path: ${drivePath}`];
  if (result) {
    lines.push(`Images: ${result.imageCount || 0} (${formatBytes(result.imageBytes || 0)})`);
    lines.push(`Other files: ${result.otherCount || 0} (${formatBytes(result.otherBytes || 0)})`);
    if (result.truncated) lines.push('⚠️ Scan truncated (>500k files)');
  }

  const title = '✅ Drive Scan Complete';
  const body = lines.join('\n');

  if (isEnabled(settings, 'ntfy_on_drive_scan')) {
    sendQuiet(settings, { title, message: body, priority: '2', tags: 'white_check_mark' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_drive_scan')) {
    broadcast({ type: 'drive_scan_completed', title, body });
  }
}

/** New drive attached / mounted */
function notifyDriveAttached(db, drive) {
  const settings = loadSettings(db);

  const label = drive.name || drive.path;
  const title = `💾 Drive Connected — ${label}`;
  const lines = [`Path: ${drive.path}`];
  if (drive.size) lines.push(`Size: ${drive.size}`);
  if (drive.filesystem && drive.filesystem !== 'unknown') lines.push(`Filesystem: ${drive.filesystem}`);
  const body = lines.join('\n');

  if (isEnabled(settings, 'ntfy_on_drive_attach')) {
    sendQuiet(settings, { title, message: body, priority: '3', tags: 'floppy_disk' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_drive_attach')) {
    broadcast({ type: 'drive_attached', title, body });
  }
}

/** Drive safely ejected / unmounted */
function notifyDriveEjected(db, drive) {
  const settings = loadSettings(db);

  const label = drive.name || drive.path;
  const title = `⏏️ Drive Ejected — ${label}`;
  const body = `Path: ${drive.path}`;

  if (isEnabled(settings, 'ntfy_on_drive_attach')) {
    sendQuiet(settings, { title, message: body, priority: '2', tags: 'eject' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_drive_attach')) {
    broadcast({ type: 'drive_ejected', title, body });
  }
}

/** Drive unexpectedly lost / disappeared */
function notifyDriveLost(db, drive) {
  const settings = loadSettings(db);

  const label = drive.name || drive.path;
  const title = `⚠️ Drive Lost — ${label}`;
  const body = `Path: ${drive.path}\nThe drive disappeared unexpectedly. Check the connection.`;

  if (isEnabled(settings, 'ntfy_on_drive_lost')) {
    sendQuiet(settings, { title, message: body, priority: '4', tags: 'warning' });
  }
  if (isBrowserEnabled(settings, 'ntfy_on_drive_lost')) {
    broadcast({ type: 'drive_lost', title, body });
  }
}

/** Send a test notification */
function sendTestNotification(db) {
  const settings = loadSettings(db);
  return send(settings, {
    title: '🔔 SnapSort Test',
    message: 'If you see this, ntfy notifications are working!',
    priority: '3',
    tags: 'bell',
  });
}

module.exports = {
  notifyJobStarted,
  notifyJobCompleted,
  notifyJobError,
  notifyJobCancelled,
  notifyDriveScanStarted,
  notifyDriveScanCompleted,
  notifyDriveAttached,
  notifyDriveEjected,
  notifyDriveLost,
  sendTestNotification,
  stopProgressTimer,
};
