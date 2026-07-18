"""
Regression tests for SnapSort source-safety and dedup atomicity.

Covers:
  * CA-03 — source-root guard blocks writes anywhere inside the source tree.
  * CA-06 — atomic copy produces identical bytes and leaves no partial files.
  * CA-05 — two byte-identical files processed concurrently yield exactly one
             copy (the check-then-register race is closed).

Runnable directly (``python3 tests/test_engine_safety.py``) or via pytest.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402
import photo_utils  # noqa: E402


def _make_image(path, color, size=(800, 800)):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "JPEG", quality=95)


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def test_source_root_guard_blocks_write_inside_source():
    workdir = Path(tempfile.mkdtemp())
    try:
        source = workdir / "source"
        img = source / "nested" / "a.jpg"
        _make_image(img, (10, 20, 30))
        dest_inside = source / "organized"  # inside the source ROOT

        raised = False
        try:
            photo_utils.copy_photo_with_metadata(
                str(img), str(dest_inside), 0, 0, 0,
                (".jpg",), frozenset(), False,
                lambda p: "h", lambda *a, **k: None, lambda *a, **k: None,
                source_root=str(source),
            )
        except RuntimeError as exc:
            raised = "SOURCE SAFETY" in str(exc)
        assert raised, "expected SOURCE SAFETY violation when dest is inside source root"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_atomic_copy_identical_and_no_partial():
    workdir = Path(tempfile.mkdtemp())
    try:
        src = workdir / "a.jpg"
        _make_image(src, (5, 15, 25))
        out_dir = workdir / "out"
        out_dir.mkdir()
        final = out_dir / "a.jpg"

        photo_utils._atomic_copy(str(src), str(final))

        assert final.exists()
        assert _sha(src) == _sha(final), "atomic copy must preserve bytes exactly"
        leftovers = list(out_dir.glob(".snapsort-part-*"))
        assert not leftovers, f"partial files left behind: {leftovers}"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_dedup_race_two_identical_concurrent():
    workdir = Path(tempfile.mkdtemp())
    try:
        source = workdir / "source"
        dest = workdir / "dest"
        dest.mkdir(parents=True)
        # Two byte-identical images, same basename in different folders so the
        # dedup similarity score is unambiguously above the strict threshold.
        first = source / "a" / "photo.jpg"
        _make_image(first, (100, 120, 140))
        second = source / "b" / "photo.jpg"
        second.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(first, second)
        assert _sha(first) == _sha(second)

        cfg = {
            "source_dir": str(source), "dest_dir": str(dest),
            "min_width": 0, "min_height": 0, "min_filesize": 0,
            "job_id": "test", "json_output": True,
            "enable_multithreading": "true", "max_worker_threads": "4",
            "concurrent_copies": "4", "batch_size": "1",
            "dedup_strict_threshold": "90", "dedup_log_threshold": "70",
        }
        env = dict(os.environ, SNAPSORT_JSON_MODE="1")
        proc = subprocess.run(
            [sys.executable, str(ROOT / "photo_organizer.py"), "--json-config", "-"],
            input=json.dumps(cfg), capture_output=True, text=True, env=env, timeout=90,
        )
        copied = skipped = 0
        for line in proc.stdout.splitlines():
            try:
                evt = json.loads(line)
            except ValueError:
                continue
            if evt.get("event") == "photo":
                if evt.get("status") == "copied":
                    copied += 1
                elif evt.get("status") == "skipped":
                    skipped += 1
        assert copied == 1, f"expected exactly 1 copied, got copied={copied} skipped={skipped}\n{proc.stdout}"
        parts = list(dest.rglob(".snapsort-part-*"))
        assert not parts, f"partial files left behind: {parts}"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    test_source_root_guard_blocks_write_inside_source()
    print("PASS  source_root_guard_blocks_write_inside_source")
    test_atomic_copy_identical_and_no_partial()
    print("PASS  atomic_copy_identical_and_no_partial")
    test_dedup_race_two_identical_concurrent()
    print("PASS  dedup_race_two_identical_concurrent")
    print("ALL PASS")
