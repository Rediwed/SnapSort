import hashlib
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from PIL import Image

from photo_utils import copy_file_atomic, copy_photo_with_metadata


def full_hash(file_path):
    hasher = hashlib.sha256()
    with open(file_path, "rb") as file_object:
        for chunk in iter(lambda: file_object.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class AtomicCopyTest(unittest.TestCase):
    def test_atomic_copy_installs_verified_file_without_temp_leaks(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source.bin"
            destination = Path(temp_root) / "destination" / "photo.bin"
            source.write_bytes(os.urandom(512 * 1024))

            final_path, copied = copy_file_atomic(
                source, destination, datetime(2026, 7, 18), full_hash
            )

            self.assertTrue(copied)
            self.assertEqual(Path(final_path).read_bytes(), source.read_bytes())
            self.assertEqual(list(destination.parent.glob(".snapsort-part-*")), [])

    def test_identical_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source.bin"
            destination = Path(temp_root) / "destination" / "photo.bin"
            destination.parent.mkdir()
            content = os.urandom(1024)
            source.write_bytes(content)
            destination.write_bytes(content)

            final_path, copied = copy_file_atomic(
                source, destination, datetime(2026, 7, 18), full_hash
            )

            self.assertFalse(copied)
            self.assertEqual(final_path, str(destination))
            self.assertEqual(destination.read_bytes(), content)

    def test_collision_creates_bounded_unique_name_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source.bin"
            destination = Path(temp_root) / "destination" / "photo.bin"
            destination.parent.mkdir()
            source.write_bytes(b"new")
            destination.write_bytes(b"existing")

            final_path, copied = copy_file_atomic(
                source, destination, datetime(2026, 7, 18, 12, 30), full_hash
            )

            self.assertTrue(copied)
            self.assertEqual(destination.read_bytes(), b"existing")
            self.assertEqual(Path(final_path).read_bytes(), b"new")
            self.assertNotEqual(final_path, str(destination))

    def test_verification_failure_removes_temp_and_preserves_destination(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source.bin"
            destination = Path(temp_root) / "destination" / "photo.bin"
            source.write_bytes(b"source")

            with self.assertRaisesRegex(OSError, "hash mismatch"):
                copy_file_atomic(
                    source,
                    destination,
                    datetime(2026, 7, 18),
                    lambda file_path: "source" if Path(file_path) == source else "different",
                )

            self.assertFalse(destination.exists())
            self.assertEqual(list(destination.parent.glob(".snapsort-part-*")), [])

    def test_configured_source_root_blocks_sibling_destination(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            nested_source = source_root / "nested"
            destination = source_root / "organized"
            nested_source.mkdir(parents=True)
            photo = nested_source / "photo.jpg"
            Image.new("RGB", (800, 800), "red").save(photo)

            with self.assertRaisesRegex(RuntimeError, "SOURCE SAFETY VIOLATION"):
                copy_photo_with_metadata(
                    str(photo),
                    str(destination),
                    0,
                    0,
                    0,
                    (".jpg",),
                    frozenset(),
                    False,
                    full_hash,
                    lambda *_args: None,
                    lambda *_args: None,
                    source_root=str(source_root),
                )


if __name__ == "__main__":
    unittest.main()