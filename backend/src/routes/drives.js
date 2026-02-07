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
    /* diskutil list -plist gives structured output but JSON is easier to parse */
    const raw = execSync('diskutil info -all 2>/dev/null || true', { encoding: 'utf-8', timeout: 10000 });

    /* Simpler approach: just scan /Volumes and diskutil info each */
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

module.exports = router;
