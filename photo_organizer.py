"""
photo_organizer.py

Main script for organizing photos by date and metadata.
"""

import os
import sys
import time
import csv
import gc
from datetime import datetime
from photo_utils import copy_photo_with_metadata
from logging_utils import log_message, log_csv, ensure_csv_config
from path_utils import construct_dest_path

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
SYSTEM_FOLDERS = [
    "windows", "program files", "appdata", "cache", "thumbnails", "tmp", "temp", "icons", "banners", "ads", "browser"
]
ENABLE_CSV_LOG = False
CSV_LOG_FILE = LOG_FILE.replace('.log', '.csv') if LOG_FILE else "photo_organizer.csv"
FLUSH_INTERVAL = 1000

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

def print_progress(processed, total, copied, skipped, errors, start_time):
    """Print the progress of the photo organizing process."""
    elapsed = time.time() - start_time
    avg_time = elapsed / processed if processed else 0
    remaining = total - processed
    est_remaining = avg_time * remaining
    progress = (
        f"\rProcessing {processed}/{total} "
        f"({copied} copied, {skipped} skipped, {errors} errors) "
        f"ETA: {int(est_remaining // 60):02d}:{int(est_remaining % 60):02d} remaining..."
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

    spinner = ['-', '\\', '|', '/']
    spinner_index = 0
    print("Initializing file list... ", end="", flush=True)
    all_files = []
    last_update = time.time()
    for root, dirs, files in os.walk(SOURCE_DIR):
        for file in files:
            if file.lower().endswith(SUPPORTED_EXTENSIONS):
                all_files.append(os.path.join(root, file))
        if time.time() - last_update > 0.1:
            print(f"\rInitializing file list... {spinner[spinner_index % len(spinner)]}", end="", flush=True)
            spinner_index += 1
            last_update = time.time()
    print(f"\rInitializing file list... done.{' ' * 10}")

    total_files = len(all_files)
    processed_files = 0
    flush_counter = 0

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

    for src_path in all_files:
        if processed_set and src_path in processed_set:
            continue
        processed_files += 1
        print_progress(processed_files, total_files, images_copied, images_skipped, errors, start_time)
        try:
            result, dest_path = copy_photo_with_metadata(
                src_path, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE,
                SUPPORTED_EXTENSIONS, SYSTEM_FOLDERS, ENABLE_CSV_LOG,
                file_hash, log_csv, log_message
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
                # If dest_path is defined before the exception, pass it; otherwise, leave blank
                log_csv("error", f"processing error ({e})", src_path, dest_path if 'dest_path' in locals() else "")
            errors += 1
            continue

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
        result, actual_dest_path = copy_photo_with_metadata(
            src_path, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE,
            SUPPORTED_EXTENSIONS, SYSTEM_FOLDERS, ENABLE_CSV_LOG,
            file_hash, log_csv, log_message,
            force_copy=(row.get('copy_anyway', '').strip().lower() in ['yes', '1'])
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
        print("Missing required Python packages: " + ", ".join(missing_deps))
        print("Install them with: python3 -m pip install -r requirements.txt")
        sys.exit(1)
    print("Choose mode:")
    print("[1] Normal copy (scan and process all)")
    print("[2] Manual copy (copy only files marked in CSV)")
    print("[3] Resume copy (continue where CSV left off)")
    mode = input("Mode (1/2/3): ").strip()
    if mode == "2":
        manual_copy_from_csv()
    elif mode == "3":
        resume_copy_from_csv()
    else:
        scan_and_organize_photos()
