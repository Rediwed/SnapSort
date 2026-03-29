/**
 * /api/drives — detect mounted/external drives.
 *
 * Works on macOS (diskutil) and Linux (lsblk / /proc/mounts).
 * Excludes the boot/OS drive so users only see data & external media.
 */

const { Router } = require('express');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const { notifyDriveScanStarted, notifyDriveScanCompleted } = require('../services/ntfyService');

const router = Router();

/**
 * GET /api/drives
 *
 * Returns an array of { name, path, type, size, removable, filesystem }.
 */
router.get('/', (_req, res) => {
  try {
    const platform = os.platform();
    let drives;

    if (platform === 'darwin') {
      drives = detectMacDrives();
    } else {
      drives = detectLinuxDrives();
    }

    res.json(drives);
  } catch (err) {
    res.status(500).json({ error: err.message, drives: [] });
  }
});

/* ================================================================== */
/*  macOS — diskutil + /Volumes                                        */
/* ================================================================== */

function detectMacDrives() {
  const drives = [];

  try {
    /* Scan /Volumes and diskutil info each */
    const volumes = fs.readdirSync('/Volumes');

    for (const vol of volumes) {
      const volPath = `/Volumes/${vol}`;

      /* Skip the boot volume (Macintosh HD or whatever the root is) */
      try {
        const realRoot = fs.realpathSync('/');
        const realVol = fs.realpathSync(volPath);
        if (realVol === realRoot) continue;
      } catch { /* skip */ }

      try {
        const info = execSync(`diskutil info "${volPath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
        const get = (key) => {
          const m = info.match(new RegExp(`${key}:\\s*(.+)`));
          return m ? m[1].trim() : null;
        };

        const removable = (get('Removable Media') || '').toLowerCase().includes('yes') ||
                          (get('Protocol') || '').toLowerCase().includes('usb');
        const sizeStr = get('Disk Size') || get('Container Total Space') || '';
        const protocol = get('Protocol') || 'unknown';

        let type = 'unknown';
        if (protocol.toLowerCase().includes('usb')) type = 'usb';
        else if (protocol.toLowerCase().includes('nvme') || protocol.toLowerCase().includes('pci')) type = 'nvme';
        else if (protocol.toLowerCase().includes('sata')) type = 'sata';
        else if (protocol.toLowerCase().includes('disk image')) type = 'disk-image';

        drives.push({
          name: vol,
          path: volPath,
          type,
          protocol,
          size: sizeStr,
          removable,
          filesystem: get('Type (Bundle)') || get('File System Personality') || 'unknown',
        });
      } catch {
        /* Can't get info — still include the volume */
        drives.push({
          name: vol,
          path: volPath,
          type: 'unknown',
          protocol: 'unknown',
          size: null,
          removable: false,
          filesystem: 'unknown',
        });
      }
    }
  } catch {
    /* /Volumes doesn't exist — shouldn't happen on macOS */
  }

  return drives;
}

/* ================================================================== */
/*  Linux — lsblk + /proc/mounts                                      */
/* ================================================================== */

function detectLinuxDrives() {
  const drives = [];

  try {
    const raw = execSync(
      'lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,RM,TRAN,MODEL 2>/dev/null',
      { encoding: 'utf-8', timeout: 10000 }
    );
    const parsed = JSON.parse(raw);
    const devices = parsed.blockdevices || [];

    for (const dev of devices) {
      const children = dev.children || [dev];

      for (const part of children) {
        const mp = part.mountpoint;
        if (!mp) continue;

        /* Skip root, boot, swap, snap, and system mounts */
        if (mp === '/' || mp === '/boot' || mp === '/boot/efi') continue;
        if (mp.startsWith('/snap')) continue;
        if (part.fstype === 'swap') continue;

        const transport = dev.tran || 'unknown';
        let type = 'unknown';
        if (transport.includes('usb')) type = 'usb';
        else if (transport.includes('nvme')) type = 'nvme';
        else if (transport.includes('sata') || transport.includes('ata')) type = 'sata';

        drives.push({
          name: dev.model ? dev.model.trim() : part.name,
          path: mp,
          type,
          protocol: transport,
          size: part.size || dev.size || null,
          removable: dev.rm === '1' || dev.rm === true,
          filesystem: part.fstype || 'unknown',
        });
      }
    }
  } catch {
    /* lsblk not available — fall back to /proc/mounts */
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
      for (const line of mounts.split('\n')) {
        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;
        const [device, mountpoint, fstype] = parts;
        if (mountpoint === '/' || mountpoint.startsWith('/sys') || mountpoint.startsWith('/proc')) continue;
        if (mountpoint.startsWith('/dev') || mountpoint.startsWith('/run') || mountpoint.startsWith('/snap')) continue;
        if (['tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'overlay'].includes(fstype)) continue;

        drives.push({
          name: device.split('/').pop(),
          path: mountpoint,
          type: device.includes('nvme') ? 'nvme' : device.includes('usb') ? 'usb' : 'sata',
          protocol: 'unknown',
          size: null,
          removable: false,
          filesystem: fstype,
        });
      }
    } catch { /* no /proc/mounts */ }
  }

  /* ── Auto-discover Docker bind-mounted drives & shares ──────────
   * Inside Docker, lsblk/proc/mounts won't see host drives.
   * Instead, enumerate subdirectories of well-known Unraid mount
   * roots so every drive/share appears individually in the UI.
   *
   *  /mnt/disks   — Unassigned Devices plugin (USB, SATA, NVMe)
   *  /mnt/remotes — Remote SMB/NFS mounts (Unassigned Devices)
   *  /mnt/user    — Unraid user shares
   */
  const mountRoots = [
    { root: '/mnt/disks',   type: 'unassigned-disk', protocol: 'bind-mount' },
    { root: '/mnt/remotes', type: 'remote-share',    protocol: 'bind-mount' },
    { root: '/mnt/user',    type: 'user-share',      protocol: 'bind-mount' },
  ];

  for (const { root, type, protocol } of mountRoots) {
    try {
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = `${root}/${entry.name}`;
        if (drives.some((d) => d.path === fullPath)) continue;
        drives.push({
          name: entry.name,
          path: fullPath,
          type,
          protocol,
          size: null,
          removable: type === 'unassigned-disk',
          filesystem: 'unknown',
        });
      }
    } catch { /* root not mounted — skip */ }
  }

  /* Fallback: include /mnt itself if nothing else was found */
  if (drives.length === 0) {
    const fallbacks = ['/mnt/photos/source', '/mnt/photos/dest', '/mnt'];
    for (const mp of fallbacks) {
      try {
        if (fs.existsSync(mp) && fs.statSync(mp).isDirectory()) {
          drives.push({
            name: mp.split('/').pop(),
            path: mp,
            type: 'docker-volume',
            protocol: 'bind-mount',
            size: null,
            removable: false,
            filesystem: 'ext4',
          });
        }
      } catch { /* skip */ }
    }
  }

  return drives;
}

/* ================================================================== */
/*  Prescan — async file counting with progress tracking               */
/* ================================================================== */

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.cr2', '.nef', '.arw', '.tif', '.tiff',
  '.rw2', '.orf', '.dng', '.heic', '.heif',
]);

const pathModule = require('path');

/* In-memory map of path → prescan state (progress is polled by the sidebar) */
const activePrescanMap = new Map();

/**
 * POST /api/drives/prescan
 * Body: { path: "/Volumes/MyDrive" }
 *
 * Kicks off an async prescan. Returns immediately with { status: 'started' }.
 * Poll GET /api/drives/prescan/active to track progress.
 */
router.post('/prescan', (req, res) => {
  const { path: scanPath } = req.body;
  if (!scanPath) return res.status(400).json({ error: 'path is required' });

  try {
    if (!fs.existsSync(scanPath) || !fs.statSync(scanPath).isDirectory()) {
      return res.status(400).json({ error: 'Path does not exist or is not a directory' });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  /* If already scanning this path, don't duplicate */
  const existing = activePrescanMap.get(scanPath);
  if (existing && existing.status === 'scanning') {
    return res.json({ status: 'already-scanning', path: scanPath });
  }

  /* Initialize progress state */
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

  /* Run the walk async via setImmediate batching */
  prescanAsync(scanPath, state, req.db);

  /* Send ntfy notification for scan start */
  notifyDriveScanStarted(req.db, scanPath);

  res.json({ status: 'started', path: scanPath });
});

/**
 * GET /api/drives/prescan/active
 *
 * Returns all active (or recently finished) prescans for the sidebar indicator.
 */
router.get('/prescan/active', (_req, res) => {
  const result = [];
  for (const [, state] of activePrescanMap) {
    result.push({ ...state });
  }
  res.json(result);
});

/**
 * GET /api/drives/prescan/result?path=...
 *
 * Returns the final prescan result for a specific path (or current progress).
 */
router.get('/prescan/result', (req, res) => {
  const scanPath = req.query.path;
  if (!scanPath) return res.status(400).json({ error: 'path query param is required' });

  const state = activePrescanMap.get(scanPath);
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

const SYSTEM_FOLDERS = new Set([
  'windows', 'program files', 'program files (x86)', 'appdata',
  'cache', 'thumbnails', 'tmp', 'temp', '$recycle.bin',
  'system volume information', 'node_modules',
]);

const MAX_FILES = 500000;
const fsp = fs.promises;

/**
 * Walk directory tree using async fs operations so the event loop
 * is never blocked and other API requests can be served concurrently.
 */
async function prescanAsync(rootPath, state, db) {
  /* Collect top-level folders first */
  try {
    const entries = await fsp.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) state.topFolders.push(entry.name);
    }
  } catch { /* permission error */ }

  /* Async iterative walk using an explicit stack */
  const dirStack = [rootPath];

  while (dirStack.length > 0) {
    if (state.status !== 'scanning') return; // cancelled
    if (state.totalScanned >= MAX_FILES) { state.truncated = true; break; }

    const dir = dirStack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { continue; } // permission denied

    for (const entry of entries) {
      if (state.totalScanned >= MAX_FILES) { state.truncated = true; break; }
      if (entry.name.startsWith('.')) continue;

      const fullPath = pathModule.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SYSTEM_FOLDERS.has(entry.name.toLowerCase())) continue;
        dirStack.push(fullPath);
      } else if (entry.isFile()) {
        state.totalScanned++;
        const ext = pathModule.extname(entry.name).toLowerCase();
        let size = 0;
        try { size = (await fsp.stat(fullPath)).size; } catch { /* skip */ }

        if (IMAGE_EXTENSIONS.has(ext)) {
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

  /* Done */
  state.status = 'done';
  state.currentFile = null;

  /* Send ntfy notification for scan complete */
  if (db) {
    notifyDriveScanCompleted(db, rootPath, {
      imageCount: state.imageCount,
      imageBytes: state.imageBytes,
      otherCount: state.otherCount,
      otherBytes: state.otherBytes,
      truncated: state.truncated,
    });
  }

  /* Auto-clean after 5 minutes */
  setTimeout(() => activePrescanMap.delete(rootPath), 5 * 60 * 1000);
}

module.exports = router;
