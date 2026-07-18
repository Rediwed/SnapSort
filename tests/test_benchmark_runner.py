import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


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

            completed, events = self.run_benchmark({
                "source_dir": str(source),
                "dest_dir": str(destination),
                "file_count": 1,
                "file_size_mb": 1,
            })

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(tree_snapshot(source), before)
            self.assertEqual(list(destination.iterdir()), [])
            summary = next(event for event in events if event.get("event") == "summary")
            self.assertEqual(summary["copy_bytes"], 1024 * 1024)
            self.assertIn(summary["bottleneck"], {"source", "destination", "pipeline", "cpu"})
            self.assertNotIn("source_write_mbps", summary)

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


if __name__ == "__main__":
    unittest.main()