/**
 * /api/benchmarks — run & view SnapSort storage benchmarks.
 *
 * Tests real I/O performance on user-selected source & destination paths.
 * Measures sequential read, sequential write, and hash throughput to
 * recommend the best performance profile for the storage combination.
 */

const { Router } = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const router = Router();

/* In-memory store for benchmark results (ephemeral) */
const benchmarkRuns = new Map();

/**
 * POST /api/benchmarks
 *
 * Start a benchmark run.
 * Body: { sourcePath, destPath, fileCount?, fileSizeMB? }
 * Returns { id, status: 'running' }.
 */
router.post('/', (req, res) => {
  const id = uuidv4();
  const {
    sourcePath,
    destPath,
    fileCount = 20,
    fileSizeMB = 5,
  } = req.body || {};

  if (!sourcePath || !destPath) {
    return res.status(400).json({ error: 'sourcePath and destPath are required' });
  }

  /* Block identical source and destination */
  const normSrc = path.resolve(sourcePath);
  const normDst = path.resolve(destPath);
  if (normSrc === normDst) {
    return res.status(400).json({ error: 'Source and destination must be different folders' });
  }

  /* Validate both paths exist */
  for (const [label, p] of [['Source', sourcePath], ['Destination', destPath]]) {
    try {
      const stat = fs.statSync(p);
      if (!stat.isDirectory()) return res.status(400).json({ error: `${label} path is not a directory` });
    } catch {
      return res.status(400).json({ error: `${label} path does not exist: ${p}` });
    }
  }

  const run = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config: { sourcePath, destPath, fileCount, fileSizeMB },
    output: [],
    results: null,
    error: null,
  };
  benchmarkRuns.set(id, run);

  /* Respond immediately so the client can start polling */
  res.status(201).json({ id, status: 'running' });

  /* ---- Build inline Python benchmark script ---- */
  const engineDir = path.join(__dirname, '..', '..', '..');

  const scriptContent = `
import json, sys, os, time, random, shutil

file_count = ${fileCount}
file_size  = ${fileSizeMB} * 1024 * 1024
source_dir = ${JSON.stringify(sourcePath)}
dest_dir   = ${JSON.stringify(destPath)}

# Create temp sub-dirs to avoid polluting user folders
src_bench  = os.path.join(source_dir, '.snapsort_bench')
dst_bench  = os.path.join(dest_dir, '.snapsort_bench')
os.makedirs(src_bench, exist_ok=True)
os.makedirs(dst_bench, exist_ok=True)

print(json.dumps({"event": "phase", "phase": "setup", "message": "Creating test files…"}), flush=True)

write_data = os.urandom(min(file_size, 1024 * 1024))  # 1 MB chunk, reused
total_bytes = 0

# --- Phase 1: Write test files to SOURCE ---
test_files = []
t_write_start = time.time()
for i in range(file_count):
    fp = os.path.join(src_bench, f"bench_{i:04d}.dat")
    with open(fp, "wb") as f:
        written = 0
        while written < file_size:
            chunk = write_data[:file_size - written]
            f.write(chunk)
            written += len(chunk)
        f.flush()
        os.fsync(f.fileno())
    test_files.append(fp)
    total_bytes += file_size
source_write_time = time.time() - t_write_start
print(json.dumps({"event": "phase", "phase": "source_write", "time": round(source_write_time, 4)}), flush=True)

# --- Phase 2: Sequential read from SOURCE ---
t_read_start = time.time()
for fp in test_files:
    with open(fp, "rb") as f:
        while f.read(1024 * 1024):
            pass
source_read_time = time.time() - t_read_start
print(json.dumps({"event": "phase", "phase": "source_read", "time": round(source_read_time, 4)}), flush=True)

# --- Phase 3: Write test files directly to DEST (measures dest write independently) ---
dest_test_files = []
t_dest_write_start = time.time()
for i in range(file_count):
    fp = os.path.join(dst_bench, f"dest_{i:04d}.dat")
    with open(fp, "wb") as f:
        written = 0
        while written < file_size:
            chunk = write_data[:file_size - written]
            f.write(chunk)
            written += len(chunk)
        f.flush()
        os.fsync(f.fileno())
    dest_test_files.append(fp)
dest_write_time = time.time() - t_dest_write_start
print(json.dumps({"event": "phase", "phase": "dest_write", "time": round(dest_write_time, 4)}), flush=True)

# Clean up dest test files (they were just for measuring)
for fp in dest_test_files:
    try: os.unlink(fp)
    except: pass

# --- Phase 4: Copy from SOURCE to DEST (real copy throughput) ---
t_copy_start = time.time()
for fp in test_files:
    dst_fp = os.path.join(dst_bench, os.path.basename(fp))
    shutil.copy2(fp, dst_fp)
    with open(dst_fp, "r+b") as f:
        os.fsync(f.fileno())
copy_time = time.time() - t_copy_start
print(json.dumps({"event": "phase", "phase": "copy", "time": round(copy_time, 4)}), flush=True)

# --- Phase 5: Hash performance on source files ---
sys.path.insert(0, ${JSON.stringify(engineDir)})
from photo_organizer import file_hash, file_hash_fast

t_hash_std = time.time()
for fp in test_files:
    file_hash(fp)
standard_hash_time = time.time() - t_hash_std

t_hash_fast = time.time()
for fp in test_files:
    file_hash_fast(fp)
fast_hash_time = time.time() - t_hash_fast

hash_speedup = standard_hash_time / fast_hash_time if fast_hash_time > 0 else 1.0
print(json.dumps({"event": "phase", "phase": "hash", "standard_time": round(standard_hash_time, 4), "fast_time": round(fast_hash_time, 4), "speedup": round(hash_speedup, 2)}), flush=True)

# --- Compute throughput metrics ---
total_mb = total_bytes / (1024 * 1024)
source_read_mbps  = total_mb / source_read_time  if source_read_time  > 0 else 0
source_write_mbps = total_mb / source_write_time  if source_write_time > 0 else 0
dest_write_mbps   = total_mb / dest_write_time    if dest_write_time   > 0 else 0
copy_mbps         = total_mb / copy_time          if copy_time         > 0 else 0
hash_mbps         = total_mb / fast_hash_time     if fast_hash_time    > 0 else 0

# --- Bottleneck analysis ---
# During a real job: files are read from source, hashed, then written to dest.
# The bottleneck is whichever stage is slowest.
metrics = {
    "source":      source_read_mbps,
    "destination": dest_write_mbps,
    "cpu":         hash_mbps,
}
bottleneck = min(metrics, key=metrics.get)

# --- Profile suggestion ---
# The profile should be tuned for the slowest storage in the chain.
# If either volume is a slow HDD, sequential processing helps both sides.
slowest_io = min(source_read_mbps, dest_write_mbps)
if slowest_io > 2000:
    suggested_profile = "nvme_gen4"
elif slowest_io > 800:
    suggested_profile = "nvme_gen3"
elif slowest_io > 300:
    suggested_profile = "sata_ssd"
elif slowest_io > 100:
    suggested_profile = "hdd_7200rpm"
elif slowest_io > 40:
    suggested_profile = "hdd_5400rpm"
else:
    suggested_profile = "usb_external"

print(json.dumps({
    "event": "summary",
    "file_count":           file_count,
    "file_size_mb":         ${fileSizeMB},
    "total_bytes":          total_bytes,
    "source_read_mbps":     round(source_read_mbps, 2),
    "source_write_mbps":    round(source_write_mbps, 2),
    "dest_write_mbps":      round(dest_write_mbps, 2),
    "copy_mbps":            round(copy_mbps, 2),
    "hash_mbps":            round(hash_mbps, 2),
    "source_read_time":     round(source_read_time, 4),
    "source_write_time":    round(source_write_time, 4),
    "dest_write_time":      round(dest_write_time, 4),
    "copy_time":            round(copy_time, 4),
    "hash_standard_time":   round(standard_hash_time, 4),
    "hash_fast_time":       round(fast_hash_time, 4),
    "hash_speedup":         round(hash_speedup, 2),
    "bottleneck":           bottleneck,
    "suggested_profile":    suggested_profile,
}), flush=True)

# --- Cleanup ---
shutil.rmtree(src_bench, ignore_errors=True)
shutil.rmtree(dst_bench, ignore_errors=True)
`;

  const tmpScript = path.join(os.tmpdir(), `snapsort_bench_${id}.py`);

  try {
    fs.writeFileSync(tmpScript, scriptContent);
  } catch (err) {
    run.status = 'error';
    run.error = `Failed to write temp script: ${err.message}`;
    return;
  }

  let child;
  try {
    child = spawn('python3', [tmpScript], { cwd: engineDir });
  } catch (err) {
    run.status = 'error';
    run.error = `Failed to spawn python3: ${err.message}`;
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
    return;
  }

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      run.output.push(line);
      try {
        const evt = JSON.parse(line);
        if (evt.event === 'summary') run.results = evt;
      } catch { /* plain text */ }
    }
  });

  child.stderr.on('data', (chunk) => {
    run.output.push(`STDERR: ${chunk}`);
  });

  child.on('close', (code) => {
    run.status = code === 0 ? 'done' : 'error';
    run.finishedAt = new Date().toISOString();
    if (code !== 0 && !run.error) run.error = `Process exited with code ${code}`;
    try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  });
});

/**
 * GET /api/benchmarks
 * List all benchmark runs (most recent first).
 */
router.get('/', (_req, res) => {
  const list = Array.from(benchmarkRuns.values())
    .map(({ id, status, startedAt, finishedAt, config, results, error }) => ({
      id, status, startedAt, finishedAt, config, results, error,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json(list);
});

/**
 * GET /api/benchmarks/:id
 * Get full detail of a single run (including output log).
 */
router.get('/:id', (req, res) => {
  const run = benchmarkRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Benchmark run not found' });
  res.json(run);
});

module.exports = router;
