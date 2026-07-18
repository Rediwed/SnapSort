"""Run a bounded storage benchmark without ever writing to the source tree."""

import concurrent.futures
import json
import math
import os
import shutil
import signal
import sys
import tempfile
import time

from photo_organizer import file_hash, file_hash_fast

MAX_FILE_COUNT = 200
MAX_FILE_SIZE_MB = 100
MAX_TOTAL_MB = 1024
READ_CHUNK_SIZE = 1024 * 1024
RANDOM_CHUNK_COUNT = 16


class BenchmarkError(Exception):
    """Raised when benchmark input or storage state is unsafe."""


def emit(event):
    """Write one JSON event for the Node bridge."""
    print(json.dumps(event), flush=True)


def parse_integer(config, key, default, maximum):
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise BenchmarkError(f"{key} must be an integer")
    if value < 1 or value > maximum:
        raise BenchmarkError(f"{key} must be between 1 and {maximum}")
    return value


def canonical_directory(config, key, access_mode):
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BenchmarkError(f"{key} is required")
    canonical_path = os.path.normcase(os.path.realpath(value))
    if not os.path.isdir(canonical_path):
        raise BenchmarkError(f"{key} is not an accessible directory")
    if not os.access(canonical_path, access_mode):
        raise BenchmarkError(f"{key} is not accessible with the required permissions")
    return canonical_path


def paths_overlap(left_path, right_path):
    try:
        common = os.path.commonpath((left_path, right_path))
    except ValueError:
        return False
    return common == left_path or common == right_path


def parse_config(raw_config):
    if not isinstance(raw_config, dict):
        raise BenchmarkError("Configuration must be a JSON object")

    file_count = parse_integer(raw_config, "file_count", 20, MAX_FILE_COUNT)
    file_size_mb = parse_integer(raw_config, "file_size_mb", 5, MAX_FILE_SIZE_MB)
    if file_count * file_size_mb > MAX_TOTAL_MB:
        raise BenchmarkError(f"Benchmark data must not exceed {MAX_TOTAL_MB} MB")

    source_dir = canonical_directory(raw_config, "source_dir", os.R_OK | os.X_OK)
    dest_dir = canonical_directory(
        raw_config,
        "dest_dir",
        os.R_OK | os.W_OK | os.X_OK,
    )
    if paths_overlap(source_dir, dest_dir):
        raise BenchmarkError("Source and destination must be disjoint folders")

    return {
        "source_dir": source_dir,
        "dest_dir": dest_dir,
        "file_count": file_count,
        "file_size_mb": file_size_mb,
    }


def collect_source_samples(source_dir, file_count, per_file_limit):
    samples = []

    for root, directories, filenames in os.walk(source_dir, followlinks=False):
        directories[:] = sorted(
            directory
            for directory in directories
            if not os.path.islink(os.path.join(root, directory))
        )
        for filename in sorted(filenames):
            file_path = os.path.join(root, filename)
            if os.path.islink(file_path) or not os.path.isfile(file_path):
                continue
            try:
                file_size = os.path.getsize(file_path)
            except OSError:
                continue
            if file_size <= 0:
                continue

            sample_size = min(file_size, per_file_limit)
            samples.append((file_path, sample_size))
            if len(samples) >= file_count:
                return samples

    return samples


def advise_drop_cache(file_object):
    if not hasattr(os, "posix_fadvise") or not hasattr(os, "POSIX_FADV_DONTNEED"):
        return
    try:
        os.posix_fadvise(file_object.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
    except OSError:
        pass


def read_sample(file_path, byte_limit):
    total = 0
    with open(file_path, "rb") as source_file:
        advise_drop_cache(source_file)
        while total < byte_limit:
            chunk = source_file.read(min(READ_CHUNK_SIZE, byte_limit - total))
            if not chunk:
                break
            total += len(chunk)
    return total


def copy_sample(file_path, byte_limit, destination_path):
    total = 0
    with open(file_path, "rb") as source_file, open(destination_path, "xb") as dest_file:
        advise_drop_cache(source_file)
        while total < byte_limit:
            chunk = source_file.read(min(READ_CHUNK_SIZE, byte_limit - total))
            if not chunk:
                break
            dest_file.write(chunk)
            total += len(chunk)
        dest_file.flush()
        os.fsync(dest_file.fileno())
    return total


def throughput_mb_per_second(byte_count, elapsed):
    if elapsed <= 0:
        return 0.0
    return (byte_count / (1024 * 1024)) / elapsed


def create_destination_files(bench_dir, file_sizes):
    largest_file = max(file_sizes)
    chunk_size = min(READ_CHUNK_SIZE, largest_file)
    pool_size = min(RANDOM_CHUNK_COUNT, max(1, math.ceil(largest_file / chunk_size)))
    random_chunks = [os.urandom(chunk_size) for _ in range(pool_size)]
    test_files = []

    started_at = time.perf_counter()
    for file_index, file_size in enumerate(file_sizes):
        file_path = os.path.join(bench_dir, f"write_{file_index:04d}.dat")
        with open(file_path, "xb") as test_file:
            written = 0
            chunk_index = file_index
            while written < file_size:
                chunk = random_chunks[chunk_index % pool_size][: file_size - written]
                test_file.write(chunk)
                written += len(chunk)
                chunk_index += 1
            test_file.flush()
            os.fsync(test_file.fileno())
        test_files.append(file_path)

    return test_files, time.perf_counter() - started_at


def suggested_profile_for(throughput):
    if throughput > 2000:
        return "nvme_gen4"
    if throughput > 800:
        return "nvme_gen3"
    if throughput > 300:
        return "sata_ssd"
    if throughput > 100:
        return "hdd_7200rpm"
    if throughput > 40:
        return "hdd_5400rpm"
    return "usb_external"


def run_benchmark(config):
    source_dir = config["source_dir"]
    dest_dir = config["dest_dir"]
    file_count = config["file_count"]
    file_size_mb = config["file_size_mb"]
    file_size = file_size_mb * 1024 * 1024
    samples = collect_source_samples(source_dir, file_count, file_size)
    if not samples:
        raise BenchmarkError("Source directory contains no readable, non-empty files")

    bench_dir = tempfile.mkdtemp(prefix=".snapsort_bench_", dir=dest_dir)
    try:
        emit({"event": "phase", "phase": "setup", "message": "Preparing destination test files..."})

        source_started = time.perf_counter()
        source_bytes = sum(read_sample(file_path, size) for file_path, size in samples)
        source_read_time = time.perf_counter() - source_started
        emit({"event": "phase", "phase": "source_read", "time": round(source_read_time, 4)})

        sample_sizes = [sample_size for _, sample_size in samples]
        test_files, dest_write_time = create_destination_files(bench_dir, sample_sizes)
        dest_bytes = sum(sample_sizes)
        emit({"event": "phase", "phase": "dest_write", "time": round(dest_write_time, 4)})

        copy_started = time.perf_counter()
        copy_bytes = 0
        for index, (file_path, sample_size) in enumerate(samples):
            destination_path = os.path.join(bench_dir, f"copy_{index:04d}.dat")
            copy_bytes += copy_sample(file_path, sample_size, destination_path)
        copy_time = time.perf_counter() - copy_started
        emit({"event": "phase", "phase": "copy", "time": round(copy_time, 4)})

        hash_started = time.perf_counter()
        for file_path in test_files:
            file_hash(file_path)
        standard_hash_time = time.perf_counter() - hash_started

        fast_hash_started = time.perf_counter()
        for file_path in test_files:
            file_hash_fast(file_path)
        fast_hash_time = time.perf_counter() - fast_hash_started
        hash_speedup = standard_hash_time / fast_hash_time if fast_hash_time > 0 else 1.0
        emit({
            "event": "phase",
            "phase": "hash_single",
            "full_time": round(standard_hash_time, 4),
            "fast_time": round(fast_hash_time, 4),
            "speedup": round(hash_speedup, 2),
        })

        worker_count = min(os.cpu_count() or 4, len(test_files), 32)
        parallel_started = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as pool:
            list(pool.map(file_hash, test_files))
        parallel_hash_time = time.perf_counter() - parallel_started
        parallel_speedup = standard_hash_time / parallel_hash_time if parallel_hash_time > 0 else 1.0
        emit({
            "event": "phase",
            "phase": "hash_parallel",
            "time": round(parallel_hash_time, 4),
            "workers": worker_count,
            "speedup_vs_single": round(parallel_speedup, 2),
        })

        source_read_mbps = throughput_mb_per_second(source_bytes, source_read_time)
        dest_write_mbps = throughput_mb_per_second(dest_bytes, dest_write_time)
        copy_mbps = throughput_mb_per_second(copy_bytes, copy_time)
        hash_single_mbps = throughput_mb_per_second(dest_bytes, standard_hash_time)
        hash_parallel_mbps = throughput_mb_per_second(dest_bytes, parallel_hash_time)

        metrics = {
            "source": source_read_mbps,
            "destination": dest_write_mbps,
            "pipeline": copy_mbps,
            "cpu": hash_parallel_mbps,
        }
        bottleneck = min(metrics, key=metrics.get)
        slowest_io = min(source_read_mbps, dest_write_mbps, copy_mbps)

        emit({
            "event": "summary",
            "file_count": len(samples),
            "requested_file_count": file_count,
            "file_size_mb": file_size_mb,
            "source_sample_count": len(samples),
            "source_bytes": source_bytes,
            "dest_bytes": dest_bytes,
            "copy_bytes": copy_bytes,
            "total_bytes": copy_bytes,
            "source_read_mbps": round(source_read_mbps, 2),
            "dest_write_mbps": round(dest_write_mbps, 2),
            "copy_mbps": round(copy_mbps, 2),
            "hash_single_mbps": round(hash_single_mbps, 2),
            "hash_parallel_mbps": round(hash_parallel_mbps, 2),
            "hash_workers": worker_count,
            "cpu_count": os.cpu_count() or 4,
            "source_read_time": round(source_read_time, 4),
            "dest_write_time": round(dest_write_time, 4),
            "copy_time": round(copy_time, 4),
            "hash_standard_time": round(standard_hash_time, 4),
            "hash_fast_time": round(fast_hash_time, 4),
            "hash_parallel_time": round(parallel_hash_time, 4),
            "hash_speedup": round(hash_speedup, 2),
            "parallel_speedup": round(parallel_speedup, 2),
            "bottleneck": bottleneck,
            "suggested_profile": suggested_profile_for(slowest_io),
        })
    finally:
        shutil.rmtree(bench_dir, ignore_errors=True)


def handle_stop_signal(_signum, _frame):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGTERM, handle_stop_signal)
    signal.signal(signal.SIGINT, handle_stop_signal)
    try:
        config = parse_config(json.load(sys.stdin))
        run_benchmark(config)
        return 0
    except KeyboardInterrupt:
        emit({"event": "error", "message": "Benchmark cancelled"})
        return 130
    except Exception as error:
        emit({"event": "error", "message": str(error)})
        return 1


if __name__ == "__main__":
    sys.exit(main())