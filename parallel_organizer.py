"""
parallel_organizer.py — Multi-threaded photo organizer.

This module re-uses the shared helpers from ``photo_organizer``
(``optimized_directory_scan``, ``process_single_file``) so that
the single-threaded and multi-threaded paths share one implementation
for scanning, filtering, copying, and metadata extraction.

It adds:
  • ``ThreadSafeProgress`` — an atomic counter object for live stats
  • ``parallel_scan_and_organize_photos()`` — the batch/thread-pool driver
"""

import os
import sys
import time
import concurrent.futures
import threading
from typing import List, Optional

from photo_organizer import (
    optimized_directory_scan,
    process_single_file,
    file_hash,
    file_hash_fast,
    SUPPORTED_EXTENSIONS,
    SYSTEM_FOLDERS,
    ENABLE_FAST_HASH,
)
from logging_utils import log_message
from dedup_utils import DeduplicationIndex

# --- PERFORMANCE CONFIGURATION ---
ENABLE_MULTITHREADING = True
MAX_WORKER_THREADS = min(16, (os.cpu_count() or 1) * 2)  # Optimized for SSDs
BATCH_SIZE = 50


class ThreadSafeProgress:
    """Thread-safe progress tracking."""
    
    def __init__(self):
        self.lock = threading.Lock()
        self.processed = 0
        self.copied = 0
        self.skipped = 0
        self.errors = 0
        
    def update(self, result_type: str):
        with self.lock:
            self.processed += 1
            if result_type == "copied":
                self.copied += 1
            elif result_type == "skipped":
                self.skipped += 1
            elif result_type == "error":
                self.errors += 1
                
    def get_stats(self):
        with self.lock:
            return {
                'processed': self.processed,
                'copied': self.copied,
                'skipped': self.skipped,
                'errors': self.errors,
            }


def _process_batch(batch, config, dedup_index, progress):
    """Process a list of file paths using the shared ``process_single_file``.

    Updates *progress* atomically after each file.
    Returns a list of result dicts.
    """
    results = []
    for src_path in batch:
        r = process_single_file(
            src_path,
            dest_dir=config['dest_dir'],
            min_width=config['min_width'],
            min_height=config['min_height'],
            min_filesize=config['min_filesize'],
            supported_extensions=config['supported_extensions'],
            system_folders=config['system_folders'],
            hash_func=config['hash_func'],
            dedup_index=dedup_index,
        )
        results.append(r)
        progress.update(r['status'])
    return results


def parallel_scan_and_organize_photos(
    source_dir: str,
    dest_dir: str,
    config: dict,
    processed_set: Optional[set] = None,
):
    """Multi-threaded photo organizer.

    Uses ``optimized_directory_scan`` for the file list and
    ``process_single_file`` for the per-file work — the exact same
    functions that ``json_mode()`` calls in single-threaded mode.
    """
    if not ENABLE_MULTITHREADING:
        print("Multi-threading disabled, aborting.", flush=True)
        return

    start_time = time.time()
    progress = ThreadSafeProgress()

    # Hash function
    hash_func = file_hash_fast if config.get('enable_fast_hash', ENABLE_FAST_HASH) else file_hash
    config.setdefault('hash_func', hash_func)
    config.setdefault('supported_extensions', SUPPORTED_EXTENSIONS)
    config.setdefault('system_folders', SYSTEM_FOLDERS)

    # Initialize deduplication index (thread-safe internally)
    dedup_index = DeduplicationIndex(
        strict_threshold=config.get('dedup_strict_threshold', 90.0),
        log_threshold=config.get('dedup_log_threshold', 70.0),
        partial_hash_bytes=config.get('dedup_partial_hash_bytes', 1024),
    )

    # Seed dedup index
    if os.path.isdir(dest_dir):
        seeded = dedup_index.seed_from_directory(
            dest_dir, config['supported_extensions'], log_message,
        )
        if seeded:
            log_message(f"Dedup index seeded with {seeded} existing files.")

    print("Fast scanning directories...", flush=True)

    # Phase 1: fast directory scan
    all_files = optimized_directory_scan(source_dir, config['supported_extensions'])

    if processed_set:
        all_files = [f for f in all_files if f not in processed_set]

    total_files = len(all_files)
    print(f"Found {total_files} files to process", flush=True)

    if total_files == 0:
        print("No files to process.")
        return

    # Phase 2: parallel processing
    print(f"Processing files in parallel ({MAX_WORKER_THREADS} threads)...", flush=True)

    batches = [all_files[i:i + BATCH_SIZE] for i in range(0, total_files, BATCH_SIZE)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKER_THREADS) as executor:
        futures = [
            executor.submit(_process_batch, batch, config, dedup_index, progress)
            for batch in batches
        ]

        completed_batches = 0
        while completed_batches < len(futures):
            time.sleep(0.5)
            new_completed = sum(1 for f in futures if f.done())
            if new_completed > completed_batches:
                completed_batches = new_completed

            stats = progress.get_stats()
            elapsed = time.time() - start_time
            if total_files > 0:
                percent = (stats['processed'] / total_files) * 100
                rate = stats['processed'] / elapsed if elapsed > 0 else 0
                eta = (total_files - stats['processed']) / rate if rate > 0 else 0
                print(
                    f"\rProgress: {stats['processed']}/{total_files} ({percent:.1f}%) "
                    f"| Copied: {stats['copied']}, Skipped: {stats['skipped']}, "
                    f"Errors: {stats['errors']} | Rate: {rate:.1f} files/sec "
                    f"| ETA: {eta / 60:.1f}min",
                    end="", flush=True,
                )

        all_results = []
        for future in concurrent.futures.as_completed(futures):
            try:
                all_results.extend(future.result())
            except Exception as e:
                log_message(f"Batch processing error: {e}")

    print()  # newline after \r progress

    # Final statistics
    final_stats = progress.get_stats()
    duration = time.time() - start_time

    total_size = sum(
        r['bytes_copied'] for r in all_results if r['status'] == 'copied'
    )

    summary = (
        f"\nParallel Processing Summary:\n"
        f"Files processed: {final_stats['processed']}\n"
        f"Images copied: {final_stats['copied']}\n"
        f"Images skipped: {final_stats['skipped']}\n"
        f"Errors: {final_stats['errors']}\n"
        f"Total size: {total_size / 1024 / 1024:.2f} MB\n"
        f"Duration: {duration:.2f} seconds\n"
        f"Processing rate: {final_stats['processed'] / duration:.1f} files/sec\n"
        f"Threads used: {MAX_WORKER_THREADS}\n"
    )
    print(summary)
    log_message(summary)


if __name__ == "__main__":
    print("Use photo_organizer.py as the main entry point.")
    print("This module provides parallel_scan_and_organize_photos() for library use.")