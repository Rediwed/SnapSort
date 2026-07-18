import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import benchmark_runner


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNNER = PROJECT_ROOT / "benchmark_runner.py"


def tree_snapshot(root):
    snapshot = {}
    for current_root, directories, filenames in os.walk(root):
        directories.sort()
        for filename in sorted(filenames):
            file_path = Path(current_root) / filename
            relative_path = file_path.relative_to(root).as_posix()
            snapshot[relative_path] = hashlib.sha256(file_path.read_bytes()).hexdigest()
    return snapshot


class BenchmarkRunnerTest(unittest.TestCase):
    def run_benchmark(self, config):
        completed = subprocess.run(
            [sys.executable, str(RUNNER)],
            input=json.dumps(config),
            text=True,
            capture_output=True,
            cwd=PROJECT_ROOT,
            check=False,
        )
        events = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
        return completed, events

    def test_benchmark_keeps_source_unchanged_and_cleans_destination(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source.mkdir()
            destination.mkdir()
            (source / "sample.bin").write_bytes(os.urandom(1024 * 1024))
            before = tree_snapshot(source)
            source.chmod(0o555)
            (source / "sample.bin").chmod(0o444)

            try:
                completed, events = self.run_benchmark({
                    "source_dir": str(source),
                    "dest_dir": str(destination),
                    "file_count": 1,
                    "file_size_mb": 1,
                })
            finally:
                source.chmod(0o755)
                (source / "sample.bin").chmod(0o644)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(tree_snapshot(source), before)
            self.assertEqual(list(destination.iterdir()), [])
            summary = next(event for event in events if event.get("event") == "summary")
            self.assertEqual(summary["copy_bytes"], 1024 * 1024)
            self.assertEqual(summary["source_bytes"], summary["dest_bytes"])
            self.assertEqual(summary["source_bytes"], summary["copy_bytes"])
            self.assertIn(summary["bottleneck"], {"source", "destination", "pipeline", "cpu"})
            self.assertNotIn("source_write_mbps", summary)
            self.assertEqual(summary["measurement_runs"], 3)
            self.assertEqual(len(summary["source_read_samples_mbps"]), 3)
            self.assertEqual(len(summary["dest_write_samples_mbps"]), 3)
            self.assertEqual(len(summary["copy_samples_mbps"]), 3)

    def test_benchmark_rejects_numeric_code_injection(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source.mkdir()
            destination.mkdir()

            completed, events = self.run_benchmark({
                "source_dir": str(source),
                "dest_dir": str(destination),
                "file_count": "1; __import__('os').system('touch /tmp/snapsort-pwned')",
                "file_size_mb": 1,
            })

            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(events[-1]["event"], "error")
            self.assertIn("file_count must be an integer", events[-1]["message"])

    def test_benchmark_rejects_symlink_overlap(self):
        if sys.platform == "win32":
            self.skipTest("Symlink creation requires elevated privileges on Windows")
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            source.mkdir()
            alias = Path(temp_root) / "source-alias"
            alias.symlink_to(source, target_is_directory=True)

            completed, events = self.run_benchmark({
                "source_dir": str(source),
                "dest_dir": str(alias),
                "file_count": 1,
                "file_size_mb": 1,
            })

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("disjoint folders", events[-1]["message"])

    def test_interruption_cleans_destination_temp_directory(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source.mkdir()
            destination.mkdir()
            source_file = source / "sample.bin"
            source_file.write_bytes(b"sample")
            config = benchmark_runner.parse_config({
                "source_dir": str(source),
                "dest_dir": str(destination),
                "file_count": 1,
                "file_size_mb": 1,
            })

            with mock.patch.object(benchmark_runner, "emit"), mock.patch.object(
                benchmark_runner, "read_sample", side_effect=KeyboardInterrupt
            ):
                with self.assertRaises(KeyboardInterrupt):
                    benchmark_runner.run_benchmark(config)

            self.assertEqual(list(destination.iterdir()), [])

    def test_throughput_and_profile_boundaries(self):
        self.assertEqual(benchmark_runner.throughput_mb_per_second(10 * 1024 * 1024, 2), 5)
        self.assertEqual(benchmark_runner.suggested_profile_for(2001), "nvme_gen4")
        self.assertEqual(benchmark_runner.suggested_profile_for(801), "nvme_gen3")
        self.assertEqual(benchmark_runner.suggested_profile_for(301), "sata_ssd")
        self.assertEqual(benchmark_runner.suggested_profile_for(101), "hdd_7200rpm")
        self.assertEqual(benchmark_runner.suggested_profile_for(41), "hdd_5400rpm")
        self.assertEqual(benchmark_runner.suggested_profile_for(40), "usb_external")
        self.assertEqual(benchmark_runner.percentile([1, 2, 3], 95), 3)


if __name__ == "__main__":
    unittest.main()