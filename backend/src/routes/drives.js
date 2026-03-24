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

  /* Also include Docker-mounted /mnt paths */
  const dockerMounts = ['/mnt/photos/source', '/mnt/photos/dest', '/mnt'];
  for (const mp of dockerMounts) {
    try {
      if (fs.existsSync(mp) && fs.statSync(mp).isDirectory()) {
        if (!drives.some((d) => d.path === mp)) {
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
      }
    } catch { /* skip */ }
  }

  return drives;
}

/* ================================================================== */
/*  POST /api/drives/prescan — quick file count & size estimate        */
/* ================================================================== */

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.cr2', '.nef', '.arw', '.tif', '.tiff',
  '.rw2', '.orf', '.dng', '.heic', '.heif',
]);

/**
 * POST /api/drives/prescan
 * Body: { path: "/Volumes/MyDrive" }
 *
 * Walks the directory tree and returns counts / total size of image files
 * vs non-image files, plus a sample of top-level folders found.
 */
router.post('/prescan', (req, res) => {
  const { path: scanPath } = req.body;
  if (!scanPath) return res.status(400).json({ error: 'path is required' });

  try {
    if (!fs.existsSync(scanPath) || !fs.statSync(scanPath).isDirectory()) {
      return res.status(400).json({ error: 'Path does not exist or is not a directory' });
    }

    const result = prescanDirectory(scanPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const pathModule = require('path');

function prescanDirectory(rootPath) {
  let imageCount = 0;
  let imageBytes = 0;
  let otherCount = 0;
  let otherBytes = 0;
  const topFolders = [];

  /* Collect top-level folder listing */
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden
      if (entry.isDirectory()) {
        topFolders.push(entry.name);
      }
    }
  } catch { /* permission error */ }

  /* Recursive walk with a depth limit to keep it fast */
  const MAX_FILES = 500000; // safety cap
  let totalScanned = 0;
  let truncated = false;

  function walk(dir) {
    if (totalScanned >= MAX_FILES) { truncated = true; return; }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; } // permission denied

    for (const entry of entries) {
      if (totalScanned >= MAX_FILES) { truncated = true; return; }
      if (entry.name.startsWith('.')) continue;

      const fullPath = pathModule.join(dir, entry.name);

      if (entry.isDirectory()) {
        /* Skip system folders */
        const lower = entry.name.toLowerCase();
        if (['windows', 'program files', 'program files (x86)', 'appdata',
             'cache', 'thumbnails', 'tmp', 'temp', '$recycle.bin',
             'system volume information', 'node_modules'].includes(lower)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        totalScanned++;
        const ext = pathModule.extname(entry.name).toLowerCase();
        let size = 0;
        try { size = fs.statSync(fullPath).size; } catch { /* skip */ }

        if (IMAGE_EXTENSIONS.has(ext)) {
          imageCount++;
          imageBytes += size;
        } else {
          otherCount++;
          otherBytes += size;
        }
      }
    }
  }

  walk(rootPath);

  return {
    path: rootPath,
    imageCount,
    imageBytes,
    otherCount,
    otherBytes,
    totalFiles: imageCount + otherCount,
    totalBytes: imageBytes + otherBytes,
    topFolders,
    truncated,
  };
}

module.exports = router;
