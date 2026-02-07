/**
 * /api/filesystem — browse directories on the host machine.
 *
 * Used by the frontend file picker so users can select source/dest
 * paths that exist on the host (or inside Docker-mounted volumes).
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = Router();

/**
 * GET /api/filesystem/browse?dir=/some/path
 *
 * Returns { current, parent, entries[] } where each entry has
 * { name, path, type: 'directory'|'file', size?, modified? }.
 * Only returns directories by default; pass ?files=true to include files.
 */
router.get('/browse', (req, res) => {
  const dir = req.query.dir || os.homedir();
  const includeFiles = req.query.files === 'true';

  try {
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const rawEntries = fs.readdirSync(dir, { withFileTypes: true });
    const entries = [];

    for (const entry of rawEntries) {
      /* Skip hidden / system entries */
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      const isDir = entry.isDirectory();

      if (!isDir && !includeFiles) continue;

      try {
        const entryStat = fs.statSync(fullPath);
        entries.push({
          name: entry.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
          size: isDir ? null : entryStat.size,
          modified: entryStat.mtime.toISOString(),
        });
      } catch {
        /* permission denied — skip silently */
      }
    }

    /* Sort: directories first, then alphabetically */
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      current: path.resolve(dir),
      parent: path.dirname(path.resolve(dir)),
      entries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/filesystem/roots
 *
 * Returns common root paths for quick-nav (home, common mount points).
 */
router.get('/roots', (_req, res) => {
  const home = os.homedir();
  const roots = [
    { name: 'Home', path: home, icon: '🏠' },
  ];

  /* Add common mount points */
  const mounts = [
    '/mnt', '/media', '/Volumes',           // Linux & macOS
    '/mnt/photos/source', '/mnt/photos/dest', // Docker volumes
  ];

  for (const mp of mounts) {
    try {
      if (fs.existsSync(mp) && fs.statSync(mp).isDirectory()) {
        const label = mp.startsWith('/Volumes') ? 'Volumes' :
                      mp.startsWith('/media')  ? 'Media'   :
                      mp.startsWith('/mnt/photos') ? mp.split('/').pop() : 'Mount';
        roots.push({ name: label, path: mp, icon: '💾' });
      }
    } catch { /* skip */ }
  }

  /* Root filesystem */
  roots.push({ name: '/', path: '/', icon: '📁' });

  res.json(roots);
});

module.exports = router;
