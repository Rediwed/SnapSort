import concurrent.futures
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from PIL import Image

from dedup_utils import DeduplicationIndex
from photo_organizer import file_hash_fast, process_single_file, scan_single_file


class DedupConcurrencyTest(unittest.TestCase):
    def test_copy_guard_serializes_identical_content(self):
        with tempfile.TemporaryDirectory() as temp_root:
            first = Path(temp_root) / "first.bin"
            second = Path(temp_root) / "second.bin"
            content = os.urandom(64 * 1024)
            first.write_bytes(content)
            second.write_bytes(content)
            index = DeduplicationIndex()
            state_lock = threading.Lock()
            active = 0
            max_active = 0

            def guarded(file_path):
                nonlocal active, max_active
                with index.copy_guard(str(file_path)):
                    with state_lock:
                        active += 1
                        max_active = max(max_active, active)
                    time.sleep(0.01)
                    with state_lock:
                        active -= 1

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(guarded, (first, second)))

            self.assertEqual(max_active, 1)

    def test_concurrent_identical_photos_copy_once(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            first_dir = source_root / "first"
            second_dir = source_root / "second"
            first_dir.mkdir(parents=True)
            second_dir.mkdir(parents=True)
            destination.mkdir()
            first = first_dir / "same.jpg"
            second = second_dir / "same.jpg"
            Image.new("RGB", (800, 800), "blue").save(first)
            second.write_bytes(first.read_bytes())
            timestamp = 1_700_000_000
            os.utime(first, (timestamp, timestamp))
            os.utime(second, (timestamp, timestamp))
            index = DeduplicationIndex(strict_threshold=90, log_threshold=70)

            def process(file_path):
                return process_single_file(
                    str(file_path),
                    dest_dir=str(destination),
                    min_width=0,
                    min_height=0,
                    min_filesize=0,
                    supported_extensions=(".jpg",),
                    system_folders=frozenset(),
                    hash_func=file_hash_fast,
                    dedup_index=index,
                    source_root=str(source_root),
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(process, (first, second)))

            statuses = sorted(result["status"] for result in results)
            copied_files = [
                file_path
                for file_path in destination.rglob("*")
                if file_path.is_file() and file_path.name != ".snapsort.lock"
            ]
            self.assertEqual(statuses, ["copied", "skipped"])
            self.assertEqual(len(copied_files), 1)

    def test_scan_only_detects_source_to_source_duplicates(self):
        with tempfile.TemporaryDirectory() as temp_root:
            first = Path(temp_root) / "first" / "same.jpg"
            second = Path(temp_root) / "second" / "same.jpg"
            first.parent.mkdir()
            second.parent.mkdir()
            Image.new("RGB", (800, 800), "green").save(first)
            second.write_bytes(first.read_bytes())
            timestamp = 1_700_000_000
            os.utime(first, (timestamp, timestamp))
            os.utime(second, (timestamp, timestamp))
            index = DeduplicationIndex(strict_threshold=90, log_threshold=70)

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(
                    lambda file_path: scan_single_file(str(file_path), file_hash_fast, index),
                    (first, second),
                ))

            duplicate_results = [result for result in results if result["similarity"] is not None]
            self.assertEqual(len(duplicate_results), 1)
            self.assertGreaterEqual(duplicate_results[0]["similarity"], 90)
            self.assertIn(
                duplicate_results[0]["duplicate_of"],
                {str(first), str(second)},
            )


if __name__ == "__main__":
    unittest.main()