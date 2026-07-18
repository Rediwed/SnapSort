/** Poll mounted drives and publish attach/eject/lost notifications. */

const fs = require('fs');
const { detectDrives } = require('./driveDetection');
const { notifyDriveAttached, notifyDriveEjected, notifyDriveLost } = require('./ntfyService');

const POLL_INTERVAL_MS = 10_000;
let knownDrives = new Map();
let pollTimer = null;
let dbRef = null;

function poll() {
  if (!dbRef) return;
  const currentMap = new Map(detectDrives().map((drive) => [drive.path, drive]));

  for (const [drivePath, drive] of currentMap) {
    if (!knownDrives.has(drivePath)) {
      console.log(`[drive-monitor] Drive attached: ${drive.name} (${drivePath})`);
      notifyDriveAttached(dbRef, drive);
    }
  }

  for (const [drivePath, drive] of knownDrives) {
    if (currentMap.has(drivePath)) continue;
    let lost = false;
    try { lost = !fs.existsSync(drivePath); } catch { lost = true; }
    if (lost) {
      console.log(`[drive-monitor] Drive lost: ${drive.name} (${drivePath})`);
      notifyDriveLost(dbRef, drive);
    } else {
      console.log(`[drive-monitor] Drive ejected: ${drive.name} (${drivePath})`);
      notifyDriveEjected(dbRef, drive);
    }
  }

  knownDrives = currentMap;
}

function startDriveMonitor(db) {
  dbRef = db;
  knownDrives = new Map(detectDrives().map((drive) => [drive.path, drive]));
  console.log(`[drive-monitor] Tracking ${knownDrives.size} drive(s)`);
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  pollTimer.unref();
}

function stopDriveMonitor() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  dbRef = null;
}

module.exports = { startDriveMonitor, stopDriveMonitor };