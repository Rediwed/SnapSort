/**
 * /api/benchmarks — run & view SnapSort storage benchmarks.
 *
 * Spawns the STATIC, source-safe `bench_engine.py` with a validated JSON
 * config on stdin. No request field is ever interpolated into source code,
 * so this endpoint cannot be used as a code-execution primitive. Source
 * drives are read-only: the engine only reads existing source files and
 * writes test data to a randomized scratch directory on the destination.
 */

const { Router } = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { validateBenchmarkRequest } = require('../services/benchmarkValidator');

const router = Router();

const ENGINE_DIR = path.join(__dirname, '..', '..', '..');
const BENCH_SCRIPT = path.join(ENGINE_DIR, 'bench_engine.py');

/* In-memory store for benchmark results (ephemeral) */
const benchmarkRuns = new Map();
/* runId → child process, so runs can be cancelled and killed on shutdown */
const benchmarkChildren = new Map();

/**
 * POST /api/benchmarks
 *
 * Start a benchmark run.
 * Body: { sourcePath, destPath, fileCount?, fileSizeMB?, repeats? }
 * Returns { id, status: 'running' }.
 */
router.post('/', (req, res) => {
  let cfg;
  try {
    cfg = validateBenchmarkRequest(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { sourcePath, destPath, fileCount, fileSizeMB, repeats } = cfg;

  /* Canonicalize both paths and require them to be disjoint (source safety). */
  let realSrc;
  let realDst;
  try {
    realSrc = fs.realpathSync(sourcePath);
    realDst = fs.realpathSync(destPath);
  } catch {
    return res.status(400).json({ error: 'Source and destination must both exist' });
  }
  if (realSrc === realDst
    || realDst.startsWith(realSrc + path.sep)
    || realSrc.startsWith(realDst + path.sep)) {
    return res.status(400).json({ error: 'Source and destination must be different, non-overlapping folders' });
  }
  for (const [label, p] of [['Source', realSrc], ['Destination', realDst]]) {
    try {
      if (!fs.statSync(p).isDirectory()) {
        return res.status(400).json({ error: `${label} path is not a directory` });
      }
    } catch {
      return res.status(400).json({ error: `${label} path does not exist` });
    }
  }

  const id = uuidv4();
  const run = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config: { sourcePath, destPath, fileCount, fileSizeMB, repeats },
    output: [],
    results: null,
    error: null,
  };
  benchmarkRuns.set(id, run);

  /* Respond immediately so the client can start polling */
  res.status(201).json({ id, status: 'running' });

  let child;
  try {
    child = spawn('python3', [BENCH_SCRIPT], { cwd: ENGINE_DIR });
  } catch (err) {
    run.status = 'error';
    run.error = `Failed to spawn python3: ${err.message}`;
    run.finishedAt = new Date().toISOString();
    return;
  }
  benchmarkChildren.set(id, child);

  /* Feed the validated config as JSON on stdin — never as source code. */
  const payload = JSON.stringify({
    source_dir: realSrc,
    dest_dir: realDst,
    file_count: fileCount,
    file_size_mb: fileSizeMB,
    repeats,
  });
  child.stdin.write(payload);
  child.stdin.end();

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
        if (evt.event === 'error') run.error = evt.message;
      } catch { /* plain text — keep in output only */ }
    }
  });

  child.stderr.on('data', (chunk) => {
    run.output.push(`STDERR: ${chunk}`);
  });

  child.on('error', (err) => {
    benchmarkChildren.delete(id);
    run.status = 'error';
    run.error = `Benchmark process error: ${err.message}`;
    run.finishedAt = new Date().toISOString();
  });

  child.on('close', (code) => {
    benchmarkChildren.delete(id);
    if (run.status === 'cancelled') {
      run.finishedAt = new Date().toISOString();
      return;
    }
    run.status = code === 0 && !run.error ? 'done' : 'error';
    run.finishedAt = new Date().toISOString();
    if (code !== 0 && !run.error) run.error = `Process exited with code ${code}`;
  });
});

/**
 * POST /api/benchmarks/:id/cancel — stop a running benchmark.
 */
router.post('/:id/cancel', (req, res) => {
  const run = benchmarkRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Benchmark run not found' });
  const child = benchmarkChildren.get(req.params.id);
  if (child) {
    run.status = 'cancelled';
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    benchmarkChildren.delete(req.params.id);
  }
  res.json({ id: run.id, status: run.status });
});

/**
 * GET /api/benchmarks — list all runs (most recent first).
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
 * GET /api/benchmarks/:id — full detail of a single run.
 */
router.get('/:id', (req, res) => {
  const run = benchmarkRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Benchmark run not found' });
  res.json(run);
});

/** Kill any running benchmark children — called on graceful shutdown. */
function cancelAllBenchmarks() {
  for (const [id, child] of benchmarkChildren) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const run = benchmarkRuns.get(id);
    if (run) run.status = 'cancelled';
  }
  benchmarkChildren.clear();
}

module.exports = router;
module.exports.cancelAllBenchmarks = cancelAllBenchmarks;
