/** Drive listing and bounded asynchronous source prescans. */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { notifyDriveScanStarted, notifyDriveScanCompleted } = require('../services/ntfyService');
const { boundedString, validateForResponse } = require('../security/validation');
const { detectDrives } = require('../services/driveDetection');

const router = Router();
const activePrescanMap = new Map();
const MAX_FILES = 500000;
const fsp = fs.promises;

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.cr2', '.nef', '.arw', '.tif', '.tiff',
  '.rw2', '.orf', '.dng', '.heic', '.heif',
]);
const SYSTEM_FOLDERS = new Set([
  'windows', 'program files', 'program files (x86)', 'appdata',
  'cache', 'thumbnails', 'tmp', 'temp', '$recycle.bin',
  'system volume information', 'node_modules',
]);

router.get('/', (_req, res) => {
  try {
    res.json(detectDrives());
  } catch (error) {
    res.status(500).json({ error: error.message, drives: [] });
  }
});

router.post('/prescan', (req, res) => {
  const validation = validateForResponse(res, () => boundedString(
    req.body?.path, 'path', { required: true, maximum: 4096 },
  ));
  if (!validation.ok) return;
  const scanPath = validation.value;
  try {
    if (!fs.statSync(scanPath).isDirectory()) {
      return res.status(400).json({ error: 'Path does not exist or is not a directory' });
    }
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const existing = activePrescanMap.get(scanPath);
  if (existing?.status === 'scanning') {
    return res.json({ status: 'already-scanning', path: scanPath });
  }

  const state = {
    path: scanPath,
    driveName: scanPath.split('/').pop(),
    status: 'scanning',
    imageCount: 0,
    imageBytes: 0,
    otherCount: 0,
    otherBytes: 0,
    totalScanned: 0,
    currentFile: null,
    topFolders: [],
    truncated: false,
    startedAt: Date.now(),
  };
  activePrescanMap.set(scanPath, state);
  prescanAsync(scanPath, state, req.db);
  notifyDriveScanStarted(req.db, scanPath);
  res.json({ status: 'started', path: scanPath });
});

router.get('/prescan/active', (_req, res) => {
  res.json(Array.from(activePrescanMap.values(), (state) => ({ ...state })));
});

router.get('/prescan/result', (req, res) => {
  const validation = validateForResponse(res, () => boundedString(
    req.query.path, 'path', { required: true, maximum: 4096 },
  ));
  if (!validation.ok) return;
  const state = activePrescanMap.get(validation.value);
  if (!state) return res.status(404).json({ error: 'No prescan found for this path' });
  res.json({
    path: state.path,
    status: state.status,
    imageCount: state.imageCount,
    imageBytes: state.imageBytes,
    otherCount: state.otherCount,
    otherBytes: state.otherBytes,
    totalFiles: state.imageCount + state.otherCount,
    totalBytes: state.imageBytes + state.otherBytes,
    topFolders: state.topFolders,
    truncated: state.truncated,
    currentFile: state.currentFile,
    error: state.error || null,
  });
});

async function prescanAsync(rootPath, state, db) {
  try {
    const entries = await fsp.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith('.') && entry.isDirectory()) state.topFolders.push(entry.name);
    }
  } catch { /* permission error */ }

  const directoryStack = [rootPath];
  while (directoryStack.length > 0) {
    if (state.status !== 'scanning') return;
    if (state.totalScanned >= MAX_FILES) { state.truncated = true; break; }
    const directory = directoryStack.pop();
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      if (state.totalScanned >= MAX_FILES) { state.truncated = true; break; }
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SYSTEM_FOLDERS.has(entry.name.toLowerCase())) directoryStack.push(fullPath);
      } else if (entry.isFile()) {
        state.totalScanned++;
        let size = 0;
        try { size = (await fsp.stat(fullPath)).size; } catch { /* inaccessible */ }
        if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          state.imageCount++;
          state.imageBytes += size;
          state.currentFile = entry.name;
        } else {
          state.otherCount++;
          state.otherBytes += size;
        }
      }
    }
  }

  state.status = 'done';
  state.currentFile = null;
  notifyDriveScanCompleted(db, rootPath, state);
  const cleanupTimer = setTimeout(() => activePrescanMap.delete(rootPath), 5 * 60 * 1000);
  cleanupTimer.unref();
}

module.exports = router;