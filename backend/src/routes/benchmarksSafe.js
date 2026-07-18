/**
 * /api/benchmarks - run and inspect bounded storage benchmarks.
 *
 * Source directories are read-only. Temporary data is created in a unique
 * destination-owned directory and removed by the static Python runner.
 */

const { Router } = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { v4: uuidv4 } = require('uuid');
const {
  BenchmarkValidationError,
  validateBenchmarkRequest,
} = require('../services/benchmarkConfig');
const { isInSourceDir } = require('../sourceGuard');

const router = Router();
const benchmarkRuns = new Map();
const activeChildren = new Map();

const MAX_RUNS = 50;
const MAX_OUTPUT_LINES = 1000;
const MAX_RUNTIME_MS = 30 * 60 * 1000;

function appendOutput(run, line) {
  run.output.push(line);
  if (run.output.length > MAX_OUTPUT_LINES) run.output.shift();
}

function pruneFinishedRuns() {
  while (benchmarkRuns.size >= MAX_RUNS) {
    const finishedId = Array.from(benchmarkRuns.values())
      .find((run) => run.status !== 'running')?.id;
    if (!finishedId) return;
    benchmarkRuns.delete(finishedId);
  }
}

function cancelAllBenchmarks() {
  for (const child of activeChildren.values()) {
    child.kill('SIGTERM');
  }
}

router.post('/', (req, res) => {
  if (activeChildren.size > 0) {
    return res.status(429).json({ error: 'A benchmark is already running' });
  }

  let config;
  try {
    config = validateBenchmarkRequest(req.body);
  } catch (error) {
    if (error instanceof BenchmarkValidationError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
  if (isInSourceDir(req.db, config.destPath)) {
    return res.status(400).json({ error: 'Destination must not be inside a known source directory' });
  }

  pruneFinishedRuns();
  const id = uuidv4();
  const run = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config,
    output: [],
    results: null,
    error: null,
  };
  benchmarkRuns.set(id, run);

  const engineDir = path.join(__dirname, '..', '..', '..');
  const runnerPath = path.join(engineDir, 'benchmark_runner.py');
  let child;

  try {
    child = spawn('python3', [runnerPath], { cwd: engineDir });
  } catch (error) {
    run.status = 'error';
    run.error = `Failed to start benchmark runner: ${error.message}`;
    run.finishedAt = new Date().toISOString();
    return res.status(500).json({ error: run.error });
  }

  activeChildren.set(id, child);
  let timeout = null;

  let buffer = '';
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const processLine = (line) => {
    if (!line.trim()) return;
    appendOutput(run, line);
    try {
      const event = JSON.parse(line);
      if (event.event === 'summary') run.results = event;
      if (event.event === 'error') run.error = event.message || 'Benchmark failed';
    } catch {
      // Preserve non-JSON diagnostics in the bounded output log.
    }
  };

  child.stdout.on('data', (chunk) => {
    buffer += stdoutDecoder.write(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) processLine(line);
  });

  child.stderr.on('data', (chunk) => {
    const message = stderrDecoder.write(chunk).trimEnd();
    if (message) appendOutput(run, `STDERR: ${message}`);
  });

  child.once('spawn', () => {
    timeout = setTimeout(() => {
      run.error = `Benchmark exceeded ${MAX_RUNTIME_MS / 60000} minutes`;
      child.kill('SIGTERM');
    }, MAX_RUNTIME_MS);
    timeout.unref();

    child.stdin.end(JSON.stringify({
      source_dir: config.sourcePath,
      dest_dir: config.destPath,
      file_count: config.fileCount,
      file_size_mb: config.fileSizeMB,
    }));
    res.status(201).json({ id, status: 'running' });
  });

  child.on('error', (error) => {
    clearTimeout(timeout);
    activeChildren.delete(id);
    run.status = 'error';
    run.error = `Failed to start benchmark runner: ${error.message}`;
    run.finishedAt = new Date().toISOString();
    if (!res.headersSent) res.status(500).json({ error: run.error });
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    activeChildren.delete(id);
    buffer += stdoutDecoder.end();
    if (buffer.trim()) processLine(buffer);
    const trailingError = stderrDecoder.end().trimEnd();
    if (trailingError) appendOutput(run, `STDERR: ${trailingError}`);
    run.status = code === 0 && run.results && !run.error ? 'done' : 'error';
    run.finishedAt = new Date().toISOString();
    if (run.status === 'error' && !run.error) {
      run.error = code === 0 ? 'Benchmark produced no summary' : `Process exited with code ${code}`;
    }
  });

  child.stdin.on('error', (error) => {
    run.error = `Failed to send benchmark config: ${error.message}`;
    run.status = 'error';
    child.kill('SIGTERM');
  });
});

router.get('/', (_req, res) => {
  const list = Array.from(benchmarkRuns.values())
    .map(({ id, status, startedAt, finishedAt, config, results, error }) => ({
      id, status, startedAt, finishedAt, config, results, error,
    }))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  res.json(list);
});

router.get('/:id', (req, res) => {
  const run = benchmarkRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Benchmark run not found' });
  res.json(run);
});

router.cancelAllBenchmarks = cancelAllBenchmarks;

module.exports = router;