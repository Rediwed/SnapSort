/**
 * Drive monitor — polls for drive mount/unmount changes and fires
 * notifications when drives are attached, safely ejected, or unexpectedly lost.
 *
 * Uses the same detection logic as the /api/drives endpoint.
 * Runs on a configurable interval (default 10 s).
 */

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const { notifyDriveAttached, notifyDriveEjected, notifyDriveLost } = require('./ntfyService');

let knownDrives = new Map(); // path → drive object
let pollTimer = null;
let dbRef = null;

const POLL_INTERVAL_MS = 10_000;

/**
 * Start monitoring for drive changes.
 * @param {object} db — SQLite database handle (for reading settings)
 */
function startDriveMonitor(db) {
  dbRef = db;

  // Seed with current drives so we don't fire on startup
  const initial = detectDrives();
  knownDrives = new Map(initial.map((d) => [d.path, d]));
  console.log(`[drive-monitor] Tracking ${knownDrives.size} drive(s)`);

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopDriveMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function poll() {
  if (!dbRef) return;

  const current = detectDrives();
  const currentMap = new Map(current.map((d) => [d.path, d]));

  // New drives (in current but not in known)
  for (const [path, drive] of currentMap) {
    if (!knownDrives.has(path)) {
      console.log(`[drive-monitor] Drive attached: ${drive.name} (${path})`);
      notifyDriveAttached(dbRef, drive);
    }
  }

  // Removed drives (in known but not in current)
  for (const [path, drive] of knownDrives) {
    if (!currentMap.has(path)) {
      // Check if the path still exists but just isn't mounted
      // If path doesn't exist at all → unexpectedly lost
      // If there's no way to tell, we assume graceful eject
      let lost = false;
      try {
        // If the mount point directory is gone, the drive was likely yanked
        if (!fs.existsSync(path)) {
          lost = true;
        }
      } catch {
        lost = true;
      }

      if (lost) {
        console.log(`[drive-monitor] Drive lost: ${drive.name} (${path})`);
        notifyDriveLost(dbRef, drive);
      } else {
        console.log(`[drive-monitor] Drive ejected: ${drive.name} (${path})`);
        notifyDriveEjected(dbRef, drive);
      }
    }
  }

  knownDrives = currentMap;
}

/* ── Drive detection (shared logic from drives route) ────────────── */

function detectDrives() {
  try {
    return os.platform() === 'darwin' ? detectMacDrives() : detectLinuxDrives();
  } catch {
    return [];
  }
}

function detectMacDrives() {
  const drives = [];
  try {
    const volumes = fs.readdirSync('/Volumes');
    for (const vol of volumes) {
      const volPath = `/Volumes/${vol}`;
      try {
        const realRoot = fs.realpathSync('/');
        const realVol = fs.realpathSync(volPath);
        if (realVol === realRoot) continue;
      } catch { continue; }

      try {
        const info = execSync(`diskutil info "${volPath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
        const get = (key) => { const m = info.match(new RegExp(`${key}:\\s*(.+)`)); return m ? m[1].trim() : null; };
        const sizeStr = get('Disk Size') || get('Container Total Space') || '';
        drives.push({ name: vol, path: volPath, size: sizeStr, filesystem: get('Type (Bundle)') || get('File System Personality') || 'unknown' });
      } catch {
        drives.push({ name: vol, path: volPath, size: null, filesystem: 'unknown' });
      }
    }
  } catch { /* /Volumes missing */ }
  return drives;
}

function detectLinuxDrives() {
  const drives = [];
  try {
    const raw = execSync('lsblk -J -o NAME,SIZE,MOUNTPOINT,FSTYPE 2>/dev/null', { encoding: 'utf-8', timeout: 10000 });
    const parsed = JSON.parse(raw);
    for (const dev of (parsed.blockdevices || [])) {
      for (const part of (dev.children || [dev])) {
        const mp = part.mountpoint;
        if (!mp || mp === '/' || mp === '/boot' || mp === '/boot/efi' || mp.startsWith('/snap')) continue;
        if (part.fstype === 'swap') continue;
        drives.push({ name: part.name, path: mp, size: part.size || dev.size || null, filesystem: part.fstype || 'unknown' });
      }
    }
  } catch {
    // Fallback: check /mnt mounts
    try {
      const entries = fs.readdirSync('/mnt', { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) drives.push({ name: e.name, path: `/mnt/${e.name}`, size: null, filesystem: 'unknown' });
      }
    } catch { /* no /mnt */ }
  }
  return drives;
}

module.exports = { startDriveMonitor, stopDriveMonitor };
