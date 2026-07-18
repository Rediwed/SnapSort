const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

function runDiskutilInfo(volumePath, execute = execFileSync) {
  return execute('diskutil', ['info', volumePath], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function runLsblk(execute = execFileSync) {
  return execute('lsblk', ['-J', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,RM,TRAN,MODEL'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function detectMacDrives() {
  const drives = [];
  try {
    for (const volume of fs.readdirSync('/Volumes')) {
      const volumePath = `/Volumes/${volume}`;
      try {
        if (fs.realpathSync(volumePath) === fs.realpathSync('/')) continue;
      } catch { continue; }

      try {
        const info = runDiskutilInfo(volumePath);
        const get = (key) => {
          const match = info.match(new RegExp(`${key}:\\s*(.+)`));
          return match ? match[1].trim() : null;
        };
        const protocol = get('Protocol') || 'unknown';
        const lowerProtocol = protocol.toLowerCase();
        let type = 'unknown';
        if (lowerProtocol.includes('usb')) type = 'usb';
        else if (lowerProtocol.includes('nvme') || lowerProtocol.includes('pci')) type = 'nvme';
        else if (lowerProtocol.includes('sata')) type = 'sata';
        else if (lowerProtocol.includes('disk image')) type = 'disk-image';
        drives.push({
          name: volume,
          path: volumePath,
          type,
          protocol,
          size: get('Disk Size') || get('Container Total Space') || '',
          removable: (get('Removable Media') || '').toLowerCase().includes('yes')
            || lowerProtocol.includes('usb'),
          filesystem: get('Type (Bundle)') || get('File System Personality') || 'unknown',
        });
      } catch {
        drives.push({
          name: volume, path: volumePath, type: 'unknown', protocol: 'unknown',
          size: null, removable: false, filesystem: 'unknown',
        });
      }
    }
  } catch { /* /Volumes unavailable */ }
  return drives;
}

function addProcMounts(drives) {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    for (const line of mounts.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const [device, mountpoint, filesystem] = parts;
      if (mountpoint === '/' || ['/sys', '/proc', '/dev', '/run', '/snap'].some((root) => mountpoint.startsWith(root))) continue;
      if (['tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'overlay'].includes(filesystem)) continue;
      drives.push({
        name: device.split('/').pop(),
        path: mountpoint,
        type: device.includes('nvme') ? 'nvme' : device.includes('usb') ? 'usb' : 'sata',
        protocol: 'unknown', size: null, removable: false, filesystem,
      });
    }
  } catch { /* /proc unavailable */ }
}

function addContainerMounts(drives) {
  const mountRoots = [
    { root: '/mnt/disks', type: 'unassigned-disk', protocol: 'bind-mount' },
    { root: '/mnt/remotes', type: 'remote-share', protocol: 'bind-mount' },
    { root: '/mnt/user', type: 'user-share', protocol: 'bind-mount' },
  ];
  for (const { root, type, protocol } of mountRoots) {
    try {
      if (!fs.statSync(root).isDirectory()) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = `${root}/${entry.name}`;
        if (drives.some((drive) => drive.path === fullPath)) continue;
        drives.push({
          name: entry.name, path: fullPath, type, protocol, size: null,
          removable: type === 'unassigned-disk', filesystem: 'unknown',
        });
      }
    } catch { /* mount root unavailable */ }
  }
}

function detectLinuxDrives() {
  const drives = [];
  try {
    const devices = JSON.parse(runLsblk()).blockdevices || [];
    for (const device of devices) {
      for (const partition of (device.children || [device])) {
        const mountpoint = partition.mountpoint;
        if (!mountpoint || ['/', '/boot', '/boot/efi'].includes(mountpoint) || mountpoint.startsWith('/snap')) continue;
        if (partition.fstype === 'swap') continue;
        const transport = device.tran || 'unknown';
        let type = 'unknown';
        if (transport.includes('usb')) type = 'usb';
        else if (transport.includes('nvme')) type = 'nvme';
        else if (transport.includes('sata') || transport.includes('ata')) type = 'sata';
        drives.push({
          name: device.model ? device.model.trim() : partition.name,
          path: mountpoint, type, protocol: transport,
          size: partition.size || device.size || null,
          removable: device.rm === '1' || device.rm === true,
          filesystem: partition.fstype || 'unknown',
        });
      }
    }
  } catch {
    addProcMounts(drives);
  }
  addContainerMounts(drives);
  if (drives.length === 0) {
    for (const mountpoint of ['/mnt/source', '/mnt/destination', '/mnt']) {
      try {
        if (!fs.statSync(mountpoint).isDirectory()) continue;
        drives.push({
          name: mountpoint.split('/').pop(), path: mountpoint,
          type: 'docker-volume', protocol: 'bind-mount', size: null,
          removable: false, filesystem: 'unknown',
        });
      } catch { /* unavailable */ }
    }
  }
  return drives;
}

function detectDrives(platform = os.platform()) {
  return platform === 'darwin' ? detectMacDrives() : detectLinuxDrives();
}

module.exports = {
  detectDrives,
  detectLinuxDrives,
  detectMacDrives,
  runDiskutilInfo,
  runLsblk,
};