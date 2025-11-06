"""
Enhanced photo_organizer.py with SSD optimizations.

This version includes multi-threading and optimized I/O for fast SSDs.
"""

import os
import sys
import time
import csv
import gc
import concurrent.futures
import threading
from datetime import datetime
from queue import Queue, Empty
from typing import List, Tuple, Optional
from photo_utils import copy_photo_with_metadata
from logging_utils import log_message, log_csv, ensure_csv_config
from path_utils import construct_dest_path
from dedup_utils import DeduplicationIndex

# --- PERFORMANCE CONFIGURATION ---
ENABLE_MULTITHREADING = True
MAX_WORKER_THREADS = min(16, (os.cpu_count() or 1) * 2)  # Optimized for SSDs
BATCH_SIZE = 50
PARALLEL_HASH_WORKERS = 4
QUEUE_SIZE = 100

# Progress tracking with thread safety
progress_lock = threading.Lock()
progress_stats = {
    'processed': 0,
    'copied': 0,
    'skipped': 0,
    'errors': 0
}


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
                'errors': self.errors
            }


def optimized_directory_scan(source_dir: str, supported_extensions: tuple) -> List[str]:
    """Fast directory scanning optimized for SSDs."""
    files = []
    supported_lower = tuple(ext.lower() for ext in supported_extensions)
    
    # Skip common system directories early
    skip_dirs = {
        'system32', 'windows', 'program files', 'program files (x86)',
        'appdata', 'cache', 'temp', 'tmp', 'recycler', '$recycle.bin',
        'system volume information', 'config.msi', 'msocache'
    }
    
    for root, dirs, filenames in os.walk(source_dir):
        # Filter out system directories in-place to avoid scanning them
        root_lower = root.lower()
        if any(skip_dir in root_lower for skip_dir in skip_dirs):
            continue
            
        # Remove system directories from dirs list to prevent os.walk from entering them
        dirs[:] = [d for d in dirs if d.lower() not in skip_dirs]
        
        # Filter files by extension
        for filename in filenames:
            if filename.lower().endswith(supported_extensions):
                files.append(os.path.join(root, filename))
    
    return files


def process_file_batch(
    file_batch: List[str],
    dest_dir: str,
    config: dict,
    dedup_index: DeduplicationIndex,
    progress: ThreadSafeProgress
) -> List[Tuple[str, str, Optional[str]]]:
    """Process a batch of files in parallel."""
    results = []
    
    for src_path in file_batch:
        try:
            result, dest_path = copy_photo_with_metadata(
                src_path, dest_dir,
                config['min_width'], config['min_height'], config['min_filesize'],
                config['supported_extensions'], config['system_folders'],
                config['enable_csv_log'], config['file_hash_func'],
                config['log_csv_func'], config['log_message_func'],
                dedup_index=dedup_index
            )
            results.append((result, src_path, dest_path))
            progress.update(result)
            
        except Exception as e:
            results.append(("error", src_path, None))
            progress.update("error")
            config['log_message_func'](f"Error processing {src_path}: {e}")
    
    return results


def parallel_scan_and_organize_photos(
    source_dir: str,
    dest_dir: str,
    config: dict,
    processed_set: Optional[set] = None
):
    """Multi-threaded version of scan_and_organize_photos."""
    
    if not ENABLE_MULTITHREADING:
        # Fall back to single-threaded version
        return original_scan_and_organize_photos(source_dir, dest_dir, config, processed_set)
    
    start_time = time.time()
    progress = ThreadSafeProgress()
    
    # Initialize deduplication index
    dedup_index = DeduplicationIndex(
        strict_threshold=config.get('dedup_strict_threshold', 90.0),
        log_threshold=config.get('dedup_log_threshold', 70.0),
        partial_hash_bytes=config.get('dedup_partial_hash_bytes', 1024),
    )
    
    # Seed dedup index
    if os.path.isdir(dest_dir):
        seeded = dedup_index.seed_from_directory(
            dest_dir, config['supported_extensions'], config['log_message_func']
        )
        if seeded:
            config['log_message_func'](f"Dedup index seeded with {seeded} existing files.")
    
    print("Fast scanning directories...", flush=True)
    
    # Phase 1: Fast directory scan
    all_files = optimized_directory_scan(source_dir, config['supported_extensions'])
    
    # Filter out already processed files
    if processed_set:
        all_files = [f for f in all_files if f not in processed_set]
    
    total_files = len(all_files)
    print(f"Found {total_files} files to process", flush=True)
    
    if total_files == 0:
        print("No files to process.")
        return
    
    # Phase 2: Parallel processing
    print("Processing files in parallel...", flush=True)
    
    # Split files into batches
    batches = [all_files[i:i + BATCH_SIZE] for i in range(0, len(all_files), BATCH_SIZE)]
    
    # Process batches with thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKER_THREADS) as executor:
        # Submit all batches
        futures = []
        for batch in batches:
            future = executor.submit(
                process_file_batch, batch, dest_dir, config, dedup_index, progress
            )
            futures.append(future)
        
        # Monitor progress
        completed_batches = 0
        while completed_batches < len(futures):
            time.sleep(0.5)  # Update every 500ms
            
            # Check for completed futures
            new_completed = sum(1 for f in futures if f.done())
            if new_completed > completed_batches:
                completed_batches = new_completed
                
            # Print progress
            stats = progress.get_stats()
            elapsed = time.time() - start_time
            
            if total_files > 0:
                percent = (stats['processed'] / total_files) * 100
                rate = stats['processed'] / elapsed if elapsed > 0 else 0
                eta = (total_files - stats['processed']) / rate if rate > 0 else 0
                
                print(f"\rProgress: {stats['processed']}/{total_files} ({percent:.1f}%) "
                      f"| Copied: {stats['copied']}, Skipped: {stats['skipped']}, "
                      f"Errors: {stats['errors']} | Rate: {rate:.1f} files/sec "
                      f"| ETA: {eta/60:.1f}min", end="", flush=True)
        
        # Wait for all futures to complete and collect results
        all_results = []
        for future in concurrent.futures.as_completed(futures):
            try:
                batch_results = future.result()
                all_results.extend(batch_results)
            except Exception as e:
                config['log_message_func'](f"Batch processing error: {e}")
    
    print()  # New line after progress
    
    # Final statistics
    final_stats = progress.get_stats()
    duration = time.time() - start_time
    
    # Calculate total size of copied files
    total_size = 0
    for result, src_path, dest_path in all_results:
        if result == "copied" and dest_path and os.path.exists(dest_path):
            try:
                total_size += os.path.getsize(dest_path)
            except:
                pass
    
    summary = (
        f"\nParallel Processing Summary:\n"
        f"Files processed: {final_stats['processed']}\n"
        f"Images copied: {final_stats['copied']}\n"
        f"Images skipped: {final_stats['skipped']}\n"
        f"Errors: {final_stats['errors']}\n"
        f"Total size: {total_size/1024/1024:.2f} MB\n"
        f"Duration: {duration:.2f} seconds\n"
        f"Processing rate: {final_stats['processed']/duration:.1f} files/sec\n"
        f"Threads used: {MAX_WORKER_THREADS}\n"
    )
    
    print(summary)
    config['log_message_func'](summary)


def original_scan_and_organize_photos(source_dir, dest_dir, config, processed_set=None):
    """Original single-threaded implementation as fallback."""
    # This would be the existing implementation from photo_organizer.py
    pass


# Integration function to choose between parallel and sequential processing
def smart_scan_and_organize_photos(
    source_dir: str,
    dest_dir: str, 
    config: dict,
    processed_set: Optional[set] = None
):
    """Automatically choose optimal processing method based on dataset size."""
    
    # Quick estimate of file count
    sample_count = 0
    sample_limit = 1000
    
    for root, dirs, files in os.walk(source_dir):
        for filename in files:
            if filename.lower().endswith(config['supported_extensions']):
                sample_count += 1
                if sample_count >= sample_limit:
                    break
        if sample_count >= sample_limit:
            break
    
    # Use parallel processing for larger datasets
    if sample_count >= 100 and ENABLE_MULTITHREADING:
        print(f"Using parallel processing ({MAX_WORKER_THREADS} threads) for large dataset")
        parallel_scan_and_organize_photos(source_dir, dest_dir, config, processed_set)
    else:
        print("Using sequential processing for small dataset")
        original_scan_and_organize_photos(source_dir, dest_dir, config, processed_set)


if __name__ == "__main__":
    # Performance benchmarking
    import tempfile
    import shutil
    
    def benchmark_scan_methods():
        """Benchmark different scanning approaches."""
        # This would test various approaches on your specific hardware
        pass
    
    # You can add benchmarking code here to test on your specific SSD setup
    benchmark_scan_methods()