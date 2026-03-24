"""
photo_organizer.py

Main script for organizing photos by date and metadata.
"""

import os
import sys
import time
import csv
import gc
import itertools
import threading
from datetime import datetime
from photo_utils import copy_photo_with_metadata, extract_date_taken
from logging_utils import log_message, log_csv, ensure_csv_config
from path_utils import construct_dest_path
from dedup_utils import DeduplicationIndex

# --- CONFIGURABLE PARAMETERS ---
SOURCE_DIR = ""
DEST_DIR = ""
LOG_FILE = "photo_organizer.log"
MIN_WIDTH = 0
MIN_HEIGHT = 0
MIN_FILESIZE = 0
SUPPORTED_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".tif", ".tiff", ".rw2", ".orf", ".dng", ".heic", ".heif"
)
SYSTEM_FOLDERS = frozenset({
    "windows", "program files", "program files (x86)", "appdata",
    "cache", "thumbnails", "tmp", "temp",
    "icons", "banners", "ads", "browser",
    "system32", "recycler", "$recycle.bin",
    "system volume information", "config.msi", "msocache",
})
ENABLE_CSV_LOG = False
CSV_LOG_FILE = LOG_FILE.replace('.log', '.csv') if LOG_FILE else "photo_organizer.csv"
FLUSH_INTERVAL = 1000

DEDUP_STRICT_THRESHOLD = 90.0
DEDUP_LOG_THRESHOLD = 70.0
DEDUP_PARTIAL_HASH_BYTES = 8192  # Kept in sync with FAST_HASH_BYTES

# Performance optimizations for SSDs
ENABLE_FAST_HASH = True  # Use optimized hashing for better SSD performance
FAST_HASH_BYTES = 8192  # Bytes to sample for fast hashing (8KB default)

# Read version from VERSION file
with open(os.path.join(os.path.dirname(__file__), "VERSION")) as f:
    __version__ = f.read().strip()

def prompt_if_needed():
    """Prompt the user for configuration parameters if not already set."""
    global SOURCE_DIR, DEST_DIR, LOG_FILE, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE, ENABLE_CSV_LOG
    
    if not SOURCE_DIR:
        SOURCE_DIR = input("Enter source directory: ").strip().strip("'\"")
    
    if not DEST_DIR:
        DEST_DIR = input("Enter destination directory: ").strip().strip("'\"")
    
    if not LOG_FILE:
        LOG_FILE = input("Enter log file name (default: photo_organizer.log): ").strip().strip("'\"") or "photo_organizer.log"
    if not MIN_WIDTH or MIN_WIDTH < 1:
        MIN_WIDTH = int(input("Enter minimum image width (default 600): ").strip() or "600")
    if not MIN_HEIGHT or MIN_HEIGHT < 1:
        MIN_HEIGHT = int(input("Enter minimum image height (default 600): ").strip() or "600")
    if not MIN_FILESIZE or MIN_FILESIZE < 1:
        MIN_FILESIZE = int(input("Enter minimum file size in bytes (default 51200 for 50KB): ").strip() or "51200")
    
    # Only prompt for CSV logging if not already configured (for test mode)
    if ENABLE_CSV_LOG is False:  # Default value, not explicitly set
        resp = input("Enable CSV logging for review/resume? (y/N): ").strip().lower()
        ENABLE_CSV_LOG = resp == "y"

def load_config_from_csv(csv_path):
    """Load configuration parameters from a CSV file."""
    global DEST_DIR, SOURCE_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE
    found = {}
    with open(csv_path, newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            if row and row[0] == "CONFIG":
                config_str = row[1]
                config_items = config_str.split(";")
                for item in config_items:
                    if "=" in item:
                        k, v = item.split("=", 1)
                        found[k] = v
                break
    if "DEST_DIR" in found:
        DEST_DIR = found["DEST_DIR"]
    if "SOURCE_DIR" in found:
        SOURCE_DIR = found["SOURCE_DIR"]
    if "MIN_WIDTH" in found:
        MIN_WIDTH = int(found["MIN_WIDTH"])
    if "MIN_HEIGHT" in found:
        MIN_HEIGHT = int(found["MIN_HEIGHT"])
    if "MIN_FILESIZE" in found:
        MIN_FILESIZE = int(found["MIN_FILESIZE"])
    
    # Prompt for missing configuration values
    if not SOURCE_DIR:
        SOURCE_DIR = input("Enter source directory: ").strip().strip("'\"")
    
    if not DEST_DIR:
        DEST_DIR = input("Enter destination directory: ").strip().strip("'\"")
    
    if not MIN_WIDTH or MIN_WIDTH < 1:
        MIN_WIDTH = int(input("Enter minimum image width (default 600): ").strip() or "600")
    if not MIN_HEIGHT or MIN_HEIGHT < 1:
        MIN_HEIGHT = int(input("Enter minimum image height (default 600): ").strip() or "600")
    if not MIN_FILESIZE or MIN_FILESIZE < 1:
        MIN_FILESIZE = int(input("Enter minimum file size in bytes (default 51200 for 50KB): ").strip() or "51200")


class Spinner:
    """Animated CLI spinner for long-running initialization phases."""

    _FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def __init__(self, message="Working"):
        self._message = message
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._spin, daemon=True)
        self._thread.start()

    def _spin(self):
        cycle = itertools.cycle(self._FRAMES)
        while not self._stop_event.is_set():
            frame = next(cycle)
            print(f"\r{frame} {self._message}...", end="", flush=True)
            self._stop_event.wait(0.08)
        # Clear the spinner line
        print("\r" + " " * (len(self._message) + 10) + "\r", end="", flush=True)

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join()

    def update(self, message):
        self._message = message

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.stop()


def print_progress(processed, total, copied, skipped, errors, start_time, scan_complete=None):
    """Print the progress of the photo organizing process."""
    elapsed = time.time() - start_time

    status_prefix = ""
    if scan_complete is not None:
        status = "completed" if scan_complete else "in-progress"
        status_prefix = f"Scanning: {status} | "

    if total is not None and total > 0:
        avg_time = elapsed / processed if processed else 0
        remaining = max(total - processed, 0)
        est_remaining = avg_time * remaining
        progress = (
            f"\r{status_prefix}Processing {processed}/{total} "
            f"({copied} copied, {skipped} skipped, {errors} errors) "
            f"ETA: {int(est_remaining // 60):02d}:{int(est_remaining % 60):02d} remaining..."
        )
    else:
        minutes, seconds = divmod(int(elapsed), 60)
        progress = (
            f"\r{status_prefix}Processed {processed} files "
            f"({copied} copied, {skipped} skipped, {errors} errors) "
            f"Elapsed: {minutes:02d}:{seconds:02d}"
        )
    print(progress, end="", flush=True)

def scan_and_organize_photos(processed_set=None):
    """Scan the source directory for photos and organize them into the destination directory."""
    prompt_if_needed()
    ensure_csv_config()
    start_time = time.time()
    images_copied = 0
    images_skipped = 0
    total_size = 0
    errors = 0
    end_reason = "Completed successfully."

    total_files = None
    processed_files = 0
    flush_counter = 0

    dedup_index = DeduplicationIndex(
        strict_threshold=DEDUP_STRICT_THRESHOLD,
        log_threshold=DEDUP_LOG_THRESHOLD,
        partial_hash_bytes=DEDUP_PARTIAL_HASH_BYTES,
    )

    if not os.path.isdir(SOURCE_DIR):
        end_reason = f"Critical error: Source directory does not exist: {SOURCE_DIR}"
        print(end_reason)
        log_message(end_reason)
        return

    try:
        os.makedirs(DEST_DIR, exist_ok=True)
    except Exception as e:
        end_reason = f"Critical error: Cannot create/access destination directory: {DEST_DIR} ({e})"
        print(end_reason)
        log_message(end_reason)
        return

    # ── Initialization with animated spinner ────────────────────────
    spinner = Spinner("Indexing destination for deduplication")
    spinner.start()

    seeded = dedup_index.seed_from_directory(DEST_DIR, SUPPORTED_EXTENSIONS, log_message)
    if seeded:
        log_message(f"Dedup index seeded with {seeded} existing files from destination.")

    spinner.update(f"Scanning source directory")
    spinner.stop()
    print(f"Indexed {seeded} existing files. Scanning source...", flush=True)

    for root, dirs, files in os.walk(SOURCE_DIR):
        for file in files:
            if not file.lower().endswith(SUPPORTED_EXTENSIONS):
                continue
            src_path = os.path.join(root, file)
            if processed_set and src_path in processed_set:
                continue
            dest_path = None
            try:
                # Choose hash function based on performance settings
                hash_func = file_hash_fast if ENABLE_FAST_HASH else file_hash
                
                result, dest_path = copy_photo_with_metadata(
                    src_path, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE,
                    SUPPORTED_EXTENSIONS, SYSTEM_FOLDERS, ENABLE_CSV_LOG,
                    hash_func, log_csv, log_message,
                    dedup_index=dedup_index
                )
                if result == "copied":
                    images_copied += 1
                    if dest_path:
                        total_size += os.path.getsize(dest_path)
                elif result == "skipped":
                    images_skipped += 1
                elif result == "error":
                    errors += 1
            except Exception as e:
                log_message(f"Error processing {src_path}: {e}")
                if ENABLE_CSV_LOG:
                    log_csv("error", f"processing error ({e})", src_path, dest_path or "")
                errors += 1
                continue

            processed_files += 1
            print_progress(
                processed_files, total_files, images_copied, images_skipped, errors,
                start_time, scan_complete=False
            )

            flush_counter += 1
            if flush_counter % FLUSH_INTERVAL == 0:
                try:
                    with open(LOG_FILE, "a") as logf:
                        logf.flush()
                        os.fsync(logf.fileno())
                except Exception:
                    pass
                if ENABLE_CSV_LOG:
                    try:
                        with open(CSV_LOG_FILE, "a") as csvfile:
                            csvfile.flush()
                            os.fsync(csvfile.fileno())
                    except Exception:
                        pass
                gc.collect()

    print_progress(
        processed_files, total_files, images_copied, images_skipped, errors,
        start_time, scan_complete=True
    )
    print("\r" + " " * 80 + "\r", end="")
    duration = time.time() - start_time
    summary = (
        f"\nSummary:\n"
        f"Images copied: {images_copied}\n"
        f"Images skipped: {images_skipped}\n"
        f"Total size: {total_size/1024/1024:.2f} MB\n"
        f"Errors: {errors}\n"
        f"Duration: {duration:.2f} seconds\n"
        f"End reason: {end_reason}\n"
    )
    print(summary)
    log_message(summary)

def manual_copy_from_csv():
    """Manually copy files from a CSV log file."""
    csv_path = input("Enter path to CSV log file (default: photo_organizer.csv): ").strip() or CSV_LOG_FILE
    csv_path = csv_path.strip("'\"")
    load_config_from_csv(csv_path)
    ensure_csv_config()
    dedup_index = DeduplicationIndex(
        strict_threshold=DEDUP_STRICT_THRESHOLD,
        log_threshold=DEDUP_LOG_THRESHOLD,
        partial_hash_bytes=DEDUP_PARTIAL_HASH_BYTES,
    )
    dedup_index.seed_from_directory(DEST_DIR, SUPPORTED_EXTENSIONS, log_message)
    to_copy = []
    flush_counter = 0

    with open(csv_path, newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if not row.get('src_path') or row.get('src_path', '').startswith('CONFIG'):
                continue
            if row.get('copy_anyway', '').strip().lower() == 'yes':
                to_copy.append(row)
    print(f"Found {len(to_copy)} files marked for copying.")
    copied = skipped = errors = 0
    total = len(to_copy)
    start_time = time.time()
    for idx, row in enumerate(to_copy, 1):
        src_path = row['src_path']
        dest_path = row['dest_path']
        # Use the same core logic for copying
        hash_func = file_hash_fast if ENABLE_FAST_HASH else file_hash
        result, actual_dest_path = copy_photo_with_metadata(
            src_path, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE,
            SUPPORTED_EXTENSIONS, SYSTEM_FOLDERS, ENABLE_CSV_LOG,
            hash_func, log_csv, log_message,
            force_copy=(row.get('copy_anyway', '').strip().lower() in ['yes', '1']),
            dedup_index=dedup_index
        )
        if result == "copied":
            copied += 1
        elif result == "skipped":
            skipped += 1
        elif result == "error":
            errors += 1
        print_progress(idx, total, copied, skipped, errors, start_time)

        flush_counter += 1
        if flush_counter % FLUSH_INTERVAL == 0:
            try:
                with open(LOG_FILE, "a") as logf:
                    logf.flush()
                    os.fsync(logf.fileno())
            except Exception:
                pass
            if ENABLE_CSV_LOG:
                try:
                    with open(CSV_LOG_FILE, "a") as csvfile:
                        csvfile.flush()
                        os.fsync(csvfile.fileno())
                except Exception:
                    pass
            gc.collect()
    print("\r" + " " * 80 + "\r", end="")
    summary = (
        f"\nSummary:\n"
        f"Images copied: {copied}\n"
        f"Images skipped: {skipped}\n"
        f"Errors: {errors}\n"
        f"Duration: {time.time() - start_time:.2f} seconds\n"
    )
    print(summary)
    log_message(summary)

def resume_copy_from_csv():
    """Resume copying files from a CSV log file."""
    csv_path = input("Enter path to CSV log file (default: photo_organizer.csv): ").strip() or CSV_LOG_FILE
    csv_path = csv_path.strip("'\"")
    load_config_from_csv(csv_path)
    processed = set()
    with open(csv_path, newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if not row.get('src_path') or row.get('src_path', '').startswith('CONFIG'):
                continue
            processed.add(row['src_path'])
    scan_and_organize_photos(processed_set=processed)

def file_hash(filepath, blocksize=65536):
    """Compute the SHA-256 hash of a file."""
    import hashlib
    hasher = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            for block in iter(lambda: f.read(blocksize), b''):
                hasher.update(block)
        return hasher.hexdigest()
    except Exception:
        return None

def file_hash_fast(filepath, max_bytes=8192):
    """Compute a fast partial hash for large files (optimized for SSDs).

    Delegates to ``dedup_utils.compute_partial_hash`` so there is a single
    implementation of the begin+middle+end sampling algorithm.
    """
    from dedup_utils import compute_partial_hash
    return compute_partial_hash(filepath, max_bytes)


# ── Shared processing helpers (used by json_mode, parallel_organizer, CLI) ──


def optimized_directory_scan(source_dir, supported_extensions):
    """Fast directory scan that prunes system dirs from os.walk in-place.

    Returns a flat list of absolute file paths whose extension matches
    *supported_extensions*.  Directories listed in ``SYSTEM_FOLDERS`` are
    never entered — the check modifies *dirs* in-place so ``os.walk``
    does not recurse into them.
    """
    files = []
    supported_lower = tuple(ext.lower() for ext in supported_extensions)

    for root, dirs, filenames in os.walk(source_dir):
        # Prune child dirs so os.walk will not descend into them.
        dirs[:] = [d for d in dirs if d.lower() not in SYSTEM_FOLDERS]
        # Skip this directory if any path component is a system folder
        root_components = {c.lower() for c in root.replace("\\", "/").split("/") if c}
        if root_components & SYSTEM_FOLDERS:
            continue
        for fname in filenames:
            if fname.lower().endswith(supported_lower):
                files.append(os.path.join(root, fname))
    return files


def process_single_file(src_path, dest_dir, min_width, min_height,
                        min_filesize, supported_extensions, system_folders,
                        hash_func, dedup_index, copy_semaphore=None):
    """Process one photo file — extract metadata, copy, and return a result dict.

    The result dict always contains:
      status      – "copied" | "skipped" | "error"
      src_path    – the original path
      dest_path   – destination path (or None)
      filename    – basename
      file_size   – source file size in bytes
      width       – image width  (or None)
      height      – image height (or None)
      date_taken  – ISO-format string (or None)
      skip_reason – human-readable reason (or None)
      bytes_copied – bytes of the destination file (0 unless copied)
    """
    result = {
        "status": None,
        "src_path": src_path,
        "dest_path": None,
        "filename": os.path.basename(src_path),
        "file_size": 0,
        "width": None,
        "height": None,
        "dpi": None,
        "date_taken": None,
        "skip_reason": None,
        "bytes_copied": 0,
        "duplicate_of": None,
        "similarity": None,
        "hash": None,
    }

    # Capture log messages so we can extract skip reasons.
    captured = []
    def _log(msg):
        captured.append(msg)

    try:
        result["file_size"] = os.path.getsize(src_path)
        status, dest_path = copy_photo_with_metadata(
            src_path, dest_dir, min_width, min_height, min_filesize,
            supported_extensions, system_folders, False,
            hash_func, log_csv, _log,
            dedup_index=dedup_index,
            copy_semaphore=copy_semaphore,
        )
        result["status"] = status
        result["dest_path"] = dest_path

        if status == "copied" and dest_path:
            try:
                result["bytes_copied"] = os.path.getsize(dest_path)
            except OSError:
                pass
        elif status == "skipped":
            for msg in captured:
                if "Skipped" in msg:
                    start = msg.find("(")
                    end = msg.find(")")
                    if start != -1 and end != -1:
                        result["skip_reason"] = msg[start + 1:end]
                    break

        # ── Extract duplicate info from the dedup index directly ────
        # The dedup index stores every record that was processed.  We
        # look up the most recent record for this src_path to get the
        # similarity score and matched path — no log-parsing needed.
        if dedup_index:
            with dedup_index._lock:
                for rec in reversed(list(dedup_index._records.values())):
                    if rec.get("src_path") == src_path:
                        sim = rec.get("similarity")
                        if sim is not None and sim > 0:
                            result["similarity"] = float(sim)
                            result["duplicate_of"] = (
                                rec.get("matched_final_path")
                                or rec.get("matched_src_path")
                                or rec.get("final_path")
                            )
                        break

        # Fallback: detect file-exists identical from log messages
        # (covers the case where dedup_index is None)
        if result["similarity"] is None:
            for msg in captured:
                if "already exists, identical" in msg.lower():
                    result["similarity"] = 100.0
                    result["duplicate_of"] = dest_path
                    break

        if status not in ("copied", "skipped"):
            for msg in captured:
                if "Error" in msg:
                    result["skip_reason"] = msg
                    break

    except Exception as exc:
        result["status"] = "error"
        result["skip_reason"] = str(exc)

    # Image dimensions and DPI
    try:
        from PIL import Image as _Img
        with _Img.open(src_path) as im:
            result["width"], result["height"] = im.size
            info = im.info or {}
            dpi_val = info.get("dpi")
            if dpi_val and isinstance(dpi_val, (tuple, list)) and len(dpi_val) >= 1:
                result["dpi"] = int(round(dpi_val[0]))
    except Exception:
        pass

    # Date taken
    try:
        dt = extract_date_taken(src_path)
        if dt:
            result["date_taken"] = dt.isoformat()
    except Exception:
        pass

    # File hash — used by the backend to populate the photos.hash column
    try:
        result["hash"] = hash_func(src_path)
    except Exception:
        pass

    return result

def json_mode():
    """Run the organizer in JSON-line mode (called by the Node.js backend).

    Reads a JSON config object from stdin:
      { "source_dir", "dest_dir", "min_width", "min_height", "min_filesize", "job_id" }

    Emits newline-delimited JSON events to stdout:
      { "event": "progress", ... }
      { "event": "photo", ... }
      { "event": "done", "summary": { ... } }
      { "event": "error", "message": "..." }

    When ``enable_multithreading`` is ``"true"`` in the config the file
    processing loop uses a ``ThreadPoolExecutor`` — the same batched
    strategy as ``parallel_organizer.py`` — while still emitting the
    per-file JSON events that the Node.js bridge expects.
    """
    import json as _json
    import threading as _threading

    # Serialises counter updates + stdout writes so threaded
    # batches don't interleave JSON lines.
    # RLock allows the same thread to re-enter (e.g. _handle_result
    # holds it, then calls emit() which also acquires it).
    _emit_lock = _threading.RLock()

    def emit(obj):
        """Write a single JSON line to stdout.  Thread-safe via _emit_lock."""
        line = _json.dumps(obj, default=str)
        with _emit_lock:
            print(line, flush=True)

    # ── Parse config from stdin ─────────────────────────────────────
    try:
        raw = sys.stdin.read()
        cfg = _json.loads(raw)
    except Exception as e:
        emit({"event": "error", "message": f"Failed to parse config from stdin: {e}"})
        sys.exit(1)

    global SOURCE_DIR, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE, ENABLE_CSV_LOG, SUPPORTED_EXTENSIONS
    SOURCE_DIR = cfg.get("source_dir", "")
    DEST_DIR = cfg.get("dest_dir", "")
    MIN_WIDTH = int(cfg.get("min_width", 600))
    MIN_HEIGHT = int(cfg.get("min_height", 600))
    MIN_FILESIZE = int(cfg.get("min_filesize", 51200))
    ENABLE_CSV_LOG = None  # skip prompt

    # Override supported file extensions if provided
    ext_override = cfg.get("supported_extensions", "")
    if ext_override:
        SUPPORTED_EXTENSIONS = tuple(
            e.strip().lower() if e.strip().startswith(".") else "." + e.strip().lower()
            for e in ext_override.split(",") if e.strip()
        )

    # Multi-threading configuration
    use_threading = cfg.get("enable_multithreading", "false") == "true"
    sequential = cfg.get("sequential_processing", "false") == "true"
    max_workers = int(cfg.get("max_worker_threads", 4))
    batch_size = int(cfg.get("batch_size", 25))
    concurrent_copies = int(cfg.get("concurrent_copies", 2))
    parallel_hash_workers = int(cfg.get("parallel_hash_workers", 4))
    hash_bytes_cfg = int(cfg.get("hash_bytes", 8192))

    # Override fast-hash sample size if provided
    global FAST_HASH_BYTES, ENABLE_FAST_HASH
    FAST_HASH_BYTES = hash_bytes_cfg
    ENABLE_FAST_HASH = cfg.get("enable_fast_hash", "true") == "true"

    # Override dedup thresholds from settings
    global DEDUP_STRICT_THRESHOLD, DEDUP_LOG_THRESHOLD
    DEDUP_STRICT_THRESHOLD = float(cfg.get("dedup_strict_threshold", DEDUP_STRICT_THRESHOLD))
    DEDUP_LOG_THRESHOLD = float(cfg.get("dedup_log_threshold", DEDUP_LOG_THRESHOLD))

    # Sequential processing forces single-threaded
    if sequential:
        use_threading = False

    # Demo mode: slow down processing so the UI looks active in screenshots.
    # Also force sequential so progress updates arrive file-by-file (threaded
    # batches would cause the bar to jump in chunks).
    demo_mode = os.environ.get("SNAPSORT_DEMO", "").lower() in ("1", "true", "yes")
    demo_delay = float(os.environ.get("SNAPSORT_DEMO_DELAY", "0.35")) if demo_mode else 0
    if demo_mode:
        use_threading = False
        emit({"event": "progress", "message": f"Demo mode active — {demo_delay}s delay per file, sequential processing"})

    if use_threading:
        try:
            import concurrent.futures as _cf
            emit({"event": "progress", "message": f"Multi-threading enabled: {max_workers} workers, batch_size={batch_size}, concurrent_copies={concurrent_copies}"})
        except ImportError:
            use_threading = False
            emit({"event": "progress", "message": "concurrent.futures unavailable, falling back to sequential"})
    elif sequential:
        emit({"event": "progress", "message": "Sequential processing mode (optimised for HDDs)"})

    # ── Validate paths ──────────────────────────────────────────────
    if not SOURCE_DIR or not os.path.isdir(SOURCE_DIR):
        emit({"event": "error", "message": f"Source directory does not exist: {SOURCE_DIR}"})
        sys.exit(1)

    try:
        os.makedirs(DEST_DIR, exist_ok=True)
    except Exception as e:
        emit({"event": "error", "message": f"Cannot create destination: {DEST_DIR} ({e})"})
        sys.exit(1)

    # ── Dedup index (thread-safe thanks to internal locking) ────────
    # Use the same hash_bytes for both the dedup index and file_hash_fast
    # so that seeded hashes match the hashes computed during processing.
    #
    # In JSON mode we suppress file logging — all events go through the
    # JSON protocol to the Node.js backend instead.
    def _noop_log(_msg):
        pass

    dedup_index = DeduplicationIndex(
        strict_threshold=DEDUP_STRICT_THRESHOLD,
        log_threshold=DEDUP_LOG_THRESHOLD,
        partial_hash_bytes=hash_bytes_cfg,
    )

    # Use parallel hashing for seeding when multi-threading is enabled
    seed_workers = parallel_hash_workers if use_threading and not sequential else 1
    seeded = dedup_index.seed_from_directory(
        DEST_DIR, SUPPORTED_EXTENSIONS, _noop_log,
        max_workers=seed_workers,
    )
    if seeded:
        emit({"event": "progress", "message": f"Seeded dedup index with {seeded} existing files (workers={seed_workers})"})

    # ── Phase 1: fast directory scan (prunes system dirs) ───────────
    all_files = optimized_directory_scan(SOURCE_DIR, SUPPORTED_EXTENSIONS)
    total_files = len(all_files)

    emit({"event": "progress", "processed": 0, "copied": 0, "skipped": 0,
          "errors": 0, "total_files": total_files})

    # Use a partial to bind the configured hash_bytes
    if ENABLE_FAST_HASH:
        import functools as _functools
        hash_func = _functools.partial(file_hash_fast, max_bytes=hash_bytes_cfg)
    else:
        hash_func = file_hash

    # Shared mutable counters — only mutated from ``_handle_result`` which
    # is called from within the _emit_lock in threaded mode, or sequentially.
    counters = {"processed": 0, "copied": 0, "skipped": 0, "errors": 0, "total_bytes": 0}

    def _handle_result(r):
        """Emit JSON events for a single processed file and update counters.

        Acquires ``_emit_lock`` so the counter mutation and the two
        ``emit()`` calls are atomic — no interleaved JSON lines.
        """
        with _emit_lock:
            counters["processed"] += 1
            if r["status"] == "copied":
                counters["copied"] += 1
                counters["total_bytes"] += r["bytes_copied"]
            elif r["status"] == "skipped":
                counters["skipped"] += 1
            else:
                counters["errors"] += 1

            emit({
                "event": "photo",
                "src_path": r["src_path"],
                "dest_path": r["dest_path"],
                "filename": r["filename"],
                "status": r["status"],
                "file_size": r["file_size"],
                "width": r["width"],
                "height": r["height"],
                "dpi": r["dpi"],
                "date_taken": r["date_taken"],
                "skip_reason": r["skip_reason"],
                "hash": r["hash"],
            })

            # Emit duplicate event when dedup info is available
            if r.get("similarity") is not None and r["similarity"] > 0:
                emit({
                    "event": "duplicate",
                    "src_path": r["src_path"],
                    "matched_path": r.get("duplicate_of"),
                    "similarity": r["similarity"],
                })

            emit({
                "event": "progress",
                "processed": counters["processed"],
                "copied": counters["copied"],
                "skipped": counters["skipped"],
                "errors": counters["errors"],
                "total_files": total_files,
            })

    # Create a copy semaphore to limit concurrent I/O operations
    _copy_semaphore = _threading.Semaphore(concurrent_copies) if use_threading else None

    # Common args for process_single_file
    _common = dict(
        dest_dir=DEST_DIR,
        min_width=MIN_WIDTH,
        min_height=MIN_HEIGHT,
        min_filesize=MIN_FILESIZE,
        supported_extensions=SUPPORTED_EXTENSIONS,
        system_folders=SYSTEM_FOLDERS,
        hash_func=hash_func,
        dedup_index=dedup_index,
        copy_semaphore=_copy_semaphore,
    )

    # ── Phase 2: process files ──────────────────────────────────────
    if use_threading and total_files > 0:
        import concurrent.futures as _cf

        # Split into batches
        batches = [all_files[i:i + batch_size] for i in range(0, total_files, batch_size)]

        def _process_batch(batch):
            """Process a batch and return list of result dicts."""
            results = []
            for fp in batch:
                results.append(process_single_file(fp, **_common))
                if demo_delay:
                    time.sleep(demo_delay)
            return results

        with _cf.ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(_process_batch, b) for b in batches]
            for future in _cf.as_completed(futures):
                try:
                    for r in future.result():
                        _handle_result(r)
                except Exception as exc:
                    emit({"event": "error", "message": f"Batch error: {exc}"})
    else:
        # Sequential — same logic, no threading overhead
        for fp in all_files:
            r = process_single_file(fp, **_common)
            _handle_result(r)
            if demo_delay:
                time.sleep(demo_delay)

    # ── Done ────────────────────────────────────────────────────────
    emit({
        "event": "done",
        "summary": {
            "total_files": total_files,
            "processed": counters["processed"],
            "copied": counters["copied"],
            "skipped": counters["skipped"],
            "errors": counters["errors"],
            "total_bytes": counters["total_bytes"],
        },
    })


if __name__ == "__main__":
    # Dependency check: provide a clear message if required packages are missing
    missing_deps = []
    try:
        import PIL  # noqa: F401
    except Exception:
        missing_deps.append("Pillow")
    try:
        import piexif  # noqa: F401
    except Exception:
        missing_deps.append("piexif")

    if missing_deps:
        msg = "Missing required Python packages: " + ", ".join(missing_deps)
        if "--json-config" in sys.argv:
            import json as _json
            print(_json.dumps({"event": "error", "message": msg}), flush=True)
        else:
            print(msg)
            print("Install them with: python3 -m pip install -r requirements.txt")
        sys.exit(1)

    # JSON mode — used by the Node.js backend
    if "--json-config" in sys.argv:
        json_mode()
        sys.exit(0)

    print("Choose mode:")
    print("[1] Normal copy (scan and process all)")
    print("[2] Manual copy (copy only files marked in CSV)")
    print("[3] Resume copy (continue where CSV left off)")
    mode = input("Mode (1/2/3): ").strip().lower()
    
    if mode == "2":
        manual_copy_from_csv()
    elif mode == "3":
        resume_copy_from_csv()
    else:
        scan_and_organize_photos()
