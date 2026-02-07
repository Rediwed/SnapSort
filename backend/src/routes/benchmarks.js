/**
 * /api/benchmarks — run & view SnapSort performance benchmarks.
 *
 * Spawns benchmark_performance.py and collects JSON-line results.
 * Also supports running fast_hash.py benchmarks.
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
 * Start a benchmark run. Body: { fileCount?, minSize?, maxSize?, testDir? }
 * Returns { id, status: 'running' }.
 */
router.post('/', (req, res) => {
  const id = uuidv4();
  const { fileCount = 50, minSize = 51200, maxSize = 5242880, testDir } = req.body || {};

  const run = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config: { fileCount, minSize, maxSize, testDir },
    output: [],
    results: null,
    error: null,
  };
  benchmarkRuns.set(id, run);

  /* Respond immediately so the client can start polling */
  res.status(201).json({ id, status: 'running' });

  /* Spawn the Python benchmark in the background */
  const engineDir = path.join(__dirname, '..', '..', '..');

  const scriptContent = [
    'import json, sys, os, time, tempfile, random',
    `sys.path.insert(0, ${JSON.stringify(engineDir)})`,
    'from photo_organizer import file_hash, file_hash_fast',
    '',
    `file_count = ${fileCount}`,
    `min_size = ${minSize}`,
    `max_size = ${maxSize}`,
    '',
    'temp_dir = tempfile.mkdtemp(prefix="snapsort_bench_")',
    'test_files = []',
    'total_bytes = 0',
    '',
    'for i in range(file_count):',
    '    size = random.randint(min_size, max_size)',
    '    fp = os.path.join(temp_dir, f"bench_{i:04d}.dat")',
    '    with open(fp, "wb") as f:',
    '        f.write(os.urandom(size))',
    '    test_files.append(fp)',
    '    total_bytes += size',
    '',
    'print(json.dumps({"event": "files_created", "count": len(test_files), "total_bytes": total_bytes}), flush=True)',
    '',
    't0 = time.time()',
    'for fp in test_files:',
    '    file_hash(fp)',
    'standard_time = time.time() - t0',
    'print(json.dumps({"event": "standard_done", "time": round(standard_time, 4)}), flush=True)',
    '',
    't0 = time.time()',
    'for fp in test_files:',
    '    file_hash_fast(fp)',
    'fast_time = time.time() - t0',
    'print(json.dumps({"event": "fast_done", "time": round(fast_time, 4)}), flush=True)',
    '',
    'speedup = standard_time / fast_time if fast_time > 0 else 0',
    'std_tp = (total_bytes / 1024 / 1024) / standard_time if standard_time > 0 else 0',
    'fast_tp = (total_bytes / 1024 / 1024) / fast_time if fast_time > 0 else 0',
    '',
    'rec = "Excellent speedup - SSD optimizations highly effective" if speedup > 3 else "Good speedup - optimizations working well" if speedup > 2 else "Modest improvement - consider tuning FAST_HASH_BYTES"',
    '',
    'print(json.dumps({"event": "summary", "file_count": file_count, "total_bytes": total_bytes, "standard_time": round(standard_time, 4), "fast_time": round(fast_time, 4), "speedup": round(speedup, 2), "standard_throughput_mbps": round(std_tp, 2), "fast_throughput_mbps": round(fast_tp, 2), "recommendation": rec}), flush=True)',
    '',
    'for fp in test_files:',
    '    try: os.unlink(fp)',
    '    except: pass',
    'try: os.rmdir(temp_dir)',
    'except: pass',
  ].join('\n');

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
    /* Clean up temp script */
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
