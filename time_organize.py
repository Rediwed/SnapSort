#!/usr/bin/env python3
"""Quick timing test: run SnapSort against all 5 test sources and measure total organize time."""

import os
import sys
import time
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import photo_organizer as po

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data")
SOURCES = [
    "source_camera_sd",
    "source_downloads",
    "source_phone_backup",
    "source_old_desktop",
    "source_external_hdd",
]
DEST = os.path.join(BASE, "destination")

# Copy destination to temp dir so we don't pollute the seed data
tmp_dest = tempfile.mkdtemp(prefix="snapsort_test_dest_")
shutil.copytree(DEST, tmp_dest, dirs_exist_ok=True)

print(f"Temp destination: {tmp_dest}")
print(f"{'=' * 60}\n")

total_t0 = time.time()
for src_name in SOURCES:
    src = os.path.join(BASE, src_name)
    po.SOURCE_DIR = src
    po.DEST_DIR = tmp_dest
    po.MIN_WIDTH = 600
    po.MIN_HEIGHT = 600
    po.MIN_FILESIZE = 51200
    po.ENABLE_CSV_LOG = None  # None != False, skips the interactive prompt

    t0 = time.time()
    po.scan_and_organize_photos()
    elapsed = time.time() - t0
    print(f"\n  >> {src_name}: {elapsed:.1f}s\n")

total = time.time() - total_t0
print(f"\n{'=' * 60}")
print(f"TOTAL ORGANIZE TIME: {total:.1f}s")
print(f"{'=' * 60}")

# Count what ended up in destination
file_count = sum(1 for _, _, files in os.walk(tmp_dest) for _ in files)
dir_size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fls in os.walk(tmp_dest) for f in fls)
print(f"Destination files: {file_count}")
print(f"Destination size:  {dir_size / 1024 / 1024:.0f} MB")

# Cleanup
shutil.rmtree(tmp_dest)
print(f"\nCleaned up temp dir.")
