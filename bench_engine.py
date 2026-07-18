#!/usr/bin/env python3
"""
bench_engine.py — SnapSort storage benchmark (static, source-safe).

Reads a single JSON config object from STDIN and emits newline-delimited
JSON events to STDOUT.  This script is a *static* program: unlike the old
inline-generated benchmark, no request field is ever interpolated into
source code, so it cannot be used as a remote-code-execution primitive.

Source safety (SnapSort's #1 invariant):
  * Source throughput is measured by READING existing files in the source.
  * Every test WRITE happens inside a randomized, app-owned scratch
    directory on the DESTINATION (``<dest>/.snapsort-bench-<uuid>``).
  * The scratch directory must not already exist and must not resolve to
    a location inside the source; it is removed in a ``finally`` block.

Config (validated again here as defense-in-depth):
  {
    "source_dir":   "...",   # required, existing directory
    "dest_dir":     "...",   # required, existing directory, disjoint from source
    "file_count":   20,      # 1..200
    "file_size_mb": 5,       # 1..256
    "repeats":      1        # 1..5  (median of repeats, for stability)
  }
"""

import json
import os
import shutil
import sys
import time
import uuid

MIN_FILE_COUNT, MAX_FILE_COUNT = 1, 200
MIN_FILE_SIZE_MB, MAX_FILE_SIZE_MB = 1, 256
MIN_REPEATS, MAX_REPEATS = 1, 5
_ONE_MB = 1024 * 1024


def emit(obj):
    """Write one JSON line to stdout."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _coerce_int(value, name, low, high, default):
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer between {low} and {high}")
    if number < low or number > high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return number


def _real(path):
    return os.path.realpath(path)


def _is_within(child, parent):
    """True if canonical *child* is at or below canonical *parent*."""
    child_real = _real(child)
    parent_real = _real(parent)
    if child_real == parent_real:
        return True
    return child_real.startswith(parent_real + os.sep)


def _collect_source_files(source_dir, limit):
    """Return up to *limit* existing, non-empty regular files under source (read-only)."""
    found = []
    for root, dirs, names in os.walk(source_dir):
        # Never descend into a benchmark scratch dir (belt-and-braces).
        dirs[:] = [d for d in dirs if not d.startswith(".snapsort-bench")]
        for name in names:
            path = os.path.join(root, name)
            try:
                if (
                    os.path.isfile(path)
                    and not os.path.islink(path)
                    and os.path.getsize(path) > 0
                ):
                    found.append(path)
            except OSError:
                continue
            if len(found) >= limit:
                return found
    return found


def _rand_bytes(size):
    return os.urandom(size)


def _write_unique_file(path, size_bytes):
    """Write *size_bytes* of unique random data, flushed and fsynced."""
    written = 0
    with open(path, "wb") as handle:
        while written < size_bytes:
            block = min(_ONE_MB, size_bytes - written)
            handle.write(_rand_bytes(block))
            written += block
        handle.flush()
        os.fsync(handle.fileno())


def _read_file(path):
    """Read a file end-to-end; return bytes read."""
    total = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(_ONE_MB)
            if not block:
                break
            total += len(block)
    return total


def _median(values):
    ordered = sorted(v for v in values if v is not None)
    count = len(ordered)
    if count == 0:
        return None
    mid = count // 2
    if count % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _mbps(total_bytes, seconds):
    if not seconds or seconds <= 0:
        return None
    return round((total_bytes / _ONE_MB) / seconds, 2)


def _suggest_profile(slowest_io_mbps):
    if slowest_io_mbps is None:
        return "default"
    if slowest_io_mbps > 2000:
        return "nvme_gen4"
    if slowest_io_mbps > 800:
        return "nvme_gen3"
    if slowest_io_mbps > 300:
        return "sata_ssd"
    if slowest_io_mbps > 100:
        return "hdd_7200rpm"
    if slowest_io_mbps > 40:
        return "hdd_5400rpm"
    return "usb_external"


def run_benchmark(config):
    """Execute the benchmark described by *config* (a dict) and emit events."""
    source_dir = config.get("source_dir")
    dest_dir = config.get("dest_dir")
    if not source_dir or not dest_dir:
        raise ValueError("source_dir and dest_dir are required")
    if not os.path.isdir(source_dir):
        raise ValueError(f"Source directory does not exist: {source_dir}")
    if not os.path.isdir(dest_dir):
        raise ValueError(f"Destination directory does not exist: {dest_dir}")

    file_count = _coerce_int(config.get("file_count"), "file_count", MIN_FILE_COUNT, MAX_FILE_COUNT, 20)
    file_size_mb = _coerce_int(config.get("file_size_mb"), "file_size_mb", MIN_FILE_SIZE_MB, MAX_FILE_SIZE_MB, 5)
    repeats = _coerce_int(config.get("repeats"), "repeats", MIN_REPEATS, MAX_REPEATS, 1)
    file_size = file_size_mb * _ONE_MB

    # ── Source safety: source and destination must be disjoint ──────────
    if _real(source_dir) == _real(dest_dir):
        raise ValueError("Source and destination must be different directories")
    if _is_within(dest_dir, source_dir) or _is_within(source_dir, dest_dir):
        raise ValueError("Source and destination must not overlap")

    # ── Randomized, app-owned scratch dir on the DESTINATION only ───────
    scratch = os.path.join(_real(dest_dir), f".snapsort-bench-{uuid.uuid4().hex}")
    if _is_within(scratch, source_dir):
        raise ValueError("Refusing to benchmark: scratch directory resolves inside source")
    if os.path.exists(scratch):
        raise ValueError("Refusing to benchmark: scratch directory already exists")

    try:
        os.makedirs(scratch, exist_ok=False)
        # Ownership marker so a crash leaves an auditable trail.
        with open(os.path.join(scratch, ".snapsort-bench-owner"), "w", encoding="utf-8") as marker:
            marker.write(f"snapsort benchmark scratch created {time.time()}\n")

        emit({"event": "phase", "phase": "setup", "message": "Sampling source files (read-only)…"})

        source_files = _collect_source_files(source_dir, file_count)
        source_bytes = sum(os.path.getsize(p) for p in source_files) if source_files else 0
        source_note = None
        if not source_files:
            source_note = "No readable files found in source — source-read and copy phases skipped."
            emit({"event": "phase", "phase": "source_sample", "message": source_note})

        total_write_bytes = file_count * file_size

        source_read_samples = []
        dest_write_samples = []
        copy_samples = []

        for attempt in range(repeats):
            # ── Phase A: source read (existing files, read-only) ────────
            if source_files:
                start = time.time()
                read_total = 0
                for path in source_files:
                    read_total += _read_file(path)
                source_read_samples.append(_mbps(read_total, time.time() - start))
                emit({"event": "phase", "phase": "source_read", "attempt": attempt + 1})

            # ── Phase B: destination write (unique data → scratch) ──────
            write_targets = [os.path.join(scratch, f"w{attempt:02d}_{i:04d}.dat") for i in range(file_count)]
            start = time.time()
            for target in write_targets:
                _write_unique_file(target, file_size)
            dest_write_samples.append(_mbps(total_write_bytes, time.time() - start))
            emit({"event": "phase", "phase": "dest_write", "attempt": attempt + 1})

            # ── Phase C: copy source → destination (real end-to-end) ────
            if source_files:
                copy_bytes = 0
                start = time.time()
                for index, path in enumerate(source_files):
                    target = os.path.join(scratch, f"c{attempt:02d}_{index:04d}.dat")
                    shutil.copy2(path, target)
                    with open(target, "rb") as handle:
                        os.fsync(handle.fileno())
                    copy_bytes += os.path.getsize(target)
                copy_samples.append(_mbps(copy_bytes, time.time() - start))
                emit({"event": "phase", "phase": "copy", "attempt": attempt + 1})

            # Remove this attempt's files before the next repeat.
            for name in os.listdir(scratch):
                if name == ".snapsort-bench-owner":
                    continue
                try:
                    os.unlink(os.path.join(scratch, name))
                except OSError:
                    pass

        # ── Phase D: hash throughput (single vs parallel), reuse engine hash ─
        emit({"event": "phase", "phase": "hash", "message": "Measuring hash throughput…"})
        hash_targets = [os.path.join(scratch, f"h_{i:04d}.dat") for i in range(file_count)]
        for target in hash_targets:
            _write_unique_file(target, file_size)
        hash_bytes = file_count * file_size

        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from photo_organizer import file_hash  # single shared hash implementation
        from concurrent.futures import ThreadPoolExecutor

        start = time.time()
        for target in hash_targets:
            file_hash(target)
        hash_single_mbps = _mbps(hash_bytes, time.time() - start)

        cpu_count = os.cpu_count() or 4
        workers = min(cpu_count, max(len(hash_targets), 1))
        start = time.time()
        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                list(pool.map(file_hash, hash_targets))
            hash_parallel_mbps = _mbps(hash_bytes, time.time() - start)
        except Exception:
            hash_parallel_mbps = hash_single_mbps

        # ── Aggregate (median across repeats) ───────────────────────────
        source_read_mbps = _median(source_read_samples)
        dest_write_mbps = _median(dest_write_samples)
        copy_mbps = _median(copy_samples)

        # Bottleneck across the three resources we can isolate.
        candidates = {}
        if source_read_mbps is not None:
            candidates["source"] = source_read_mbps
        if dest_write_mbps is not None:
            candidates["destination"] = dest_write_mbps
        if hash_parallel_mbps is not None:
            candidates["cpu"] = hash_parallel_mbps
        bottleneck = min(candidates, key=candidates.get) if candidates else "unknown"

        io_values = [v for v in (source_read_mbps, dest_write_mbps) if v is not None]
        slowest_io = min(io_values) if io_values else None

        emit({
            "event": "summary",
            "file_count": file_count,
            "file_size_mb": file_size_mb,
            "repeats": repeats,
            "total_bytes": total_write_bytes,
            "source_files_sampled": len(source_files),
            "source_read_mbps": source_read_mbps,
            "source_write_mbps": None,  # intentionally not measured: source is read-only
            "dest_write_mbps": dest_write_mbps,
            "copy_mbps": copy_mbps,
            "hash_single_mbps": hash_single_mbps,
            "hash_parallel_mbps": hash_parallel_mbps,
            "hash_workers": workers,
            "cpu_count": cpu_count,
            "bottleneck": bottleneck,
            "suggested_profile": _suggest_profile(slowest_io),
            "cache_state": "warm",  # honest disclosure: no cache-drop is performed
            "note": source_note,
        })
    finally:
        # Remove ONLY our randomized scratch dir, and only if it is not in source.
        if not _is_within(scratch, source_dir):
            shutil.rmtree(scratch, ignore_errors=True)


def main():
    try:
        raw = sys.stdin.read()
        config = json.loads(raw) if raw.strip() else {}
    except (ValueError, OSError) as exc:
        emit({"event": "error", "message": f"Failed to parse benchmark config: {exc}"})
        sys.exit(1)

    try:
        run_benchmark(config)
    except ValueError as exc:
        emit({"event": "error", "message": str(exc)})
        sys.exit(1)
    except Exception as exc:  # pragma: no cover - defensive
        emit({"event": "error", "message": f"Benchmark failed: {exc}"})
        sys.exit(1)


if __name__ == "__main__":
    main()
