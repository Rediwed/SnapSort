"""
logging_utils.py

Utility functions for logging setup and management.
"""

import os
import csv
import gc
from datetime import datetime

LOG_FILE = "photo_organizer.log"
CSV_LOG_FILE = LOG_FILE.replace('.log', '.csv')
FLUSH_INTERVAL = 1000

def log_message(message, flush_counter=[0]):
    """Log a message to the log file with a timestamp.

    Args:
        message (str): The message to log.
        flush_counter (list, optional): A mutable counter to manage flush intervals. Defaults to [0].
    """
    with open(LOG_FILE, "a") as logf:
        logf.write(f"{datetime.now().isoformat()} {message}\n")
        flush_counter[0] += 1
        # The flush_counter is a mutable default argument to persist state across calls.
        # Flushing and garbage collection are performed every FLUSH_INTERVAL writes to reduce I/O overhead.
        if flush_counter[0] % FLUSH_INTERVAL == 0:
            logf.flush()
            os.fsync(logf.fileno())
            gc.collect()

def log_csv(action, reason, src_path, dest_path="", file_size=0, flush_counter=[0], enable_csv_log=True):
    """Log an action to the CSV log file with details about the file operation.

    Args:
        action (str): The action performed (e.g., "moved", "copied").
        reason (str): The reason for the action.
        src_path (str): The source file path.
        dest_path (str, optional): The destination file path. Defaults to "".
        file_size (int, optional): The size of the file in bytes. Defaults to 0.
        flush_counter (list, optional): A mutable counter to manage flush intervals. Defaults to [0].
        enable_csv_log (bool, optional): Flag to enable or disable CSV logging. Defaults to True.
    """
    if not enable_csv_log:
        return
    header = ['timestamp', 'action', 'reason', 'src_path', 'dest_path', 'file_size', 'copy_anyway']
    write_header = not os.path.exists(CSV_LOG_FILE)
    with open(CSV_LOG_FILE, "a", newline='') as csvfile:
        writer = csv.writer(csvfile)
        if write_header:
            writer.writerow(header)
        writer.writerow([
            datetime.now().isoformat(), action, reason, src_path, dest_path, file_size, ""
        ])
        flush_counter[0] += 1
        # Only log to CSV if enabled. Header is written if file does not exist.
        # Flushing and garbage collection are performed every FLUSH_INTERVAL writes to reduce I/O overhead.
        if flush_counter[0] % FLUSH_INTERVAL == 0:
            csvfile.flush()
            os.fsync(csvfile.fileno())
            gc.collect()

def ensure_csv_config():
    """Ensure the CSV configuration is present in the CSV log file.

    This function checks if the CSV log file exists and contains the required
    configuration as the second row. If the file or configuration is missing,
    it creates or updates the file accordingly.
    """
    import os
    import csv
    header = ['timestamp', 'action', 'reason', 'src_path', 'dest_path', 'file_size', 'copy_anyway']
    # Use your global config variables here, or pass them as arguments if needed
    from photo_organizer import SOURCE_DIR, DEST_DIR, MIN_WIDTH, MIN_HEIGHT, MIN_FILESIZE, SUPPORTED_EXTENSIONS, SYSTEM_FOLDERS, CSV_LOG_FILE
    config_items = [
        f"SOURCE_DIR={SOURCE_DIR}",
        f"DEST_DIR={DEST_DIR}",
        f"MIN_WIDTH={MIN_WIDTH}",
        f"MIN_HEIGHT={MIN_HEIGHT}",
        f"MIN_FILESIZE={MIN_FILESIZE}",
        f"SUPPORTED_EXTENSIONS={','.join(SUPPORTED_EXTENSIONS)}",
        f"SYSTEM_FOLDERS={','.join(SYSTEM_FOLDERS)}"
    ]
    config_row = ["CONFIG", ";".join(config_items)]

    if not os.path.exists(CSV_LOG_FILE):
        with open(CSV_LOG_FILE, "w", newline='') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(header)
            writer.writerow(config_row)
        return

    # Read all lines
    with open(CSV_LOG_FILE, "r", newline='') as csvfile:
        rows = list(csv.reader(csvfile))

    # Ensure header is first row
    if not rows or rows[0] != header:
        rows.insert(0, header)

    # Insert or update config as second row (single cell)
    if len(rows) < 2 or rows[1][0] != "CONFIG":
        rows.insert(1, config_row)
    else:
        rows[1] = config_row

    # Write back
    with open(CSV_LOG_FILE, "w", newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerows(rows)