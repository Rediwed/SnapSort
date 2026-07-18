import os
import tempfile
import unittest
from pathlib import Path

from path_utils import canonicalize_path, path_is_within, paths_overlap


class PathSafetyTest(unittest.TestCase):
    def test_canonicalizes_missing_descendant_through_symlink(self):
        if os.name == "nt":
            self.skipTest("Symlink creation requires elevated privileges on Windows")
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            source.mkdir()
            alias = Path(temp_root) / "source-alias"
            alias.symlink_to(source, target_is_directory=True)

            canonical = canonicalize_path(alias / "missing" / "photo.jpg")

            self.assertEqual(
                canonical,
                os.path.join(os.path.realpath(source), "missing", "photo.jpg"),
            )

    def test_detects_nested_destination_inside_source(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            destination = source / "organized"
            source.mkdir()

            self.assertTrue(paths_overlap(source, destination))
            self.assertTrue(path_is_within(source, destination / "photo.jpg"))

    def test_disjoint_directories_do_not_overlap(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source.mkdir()
            destination.mkdir()

            self.assertFalse(paths_overlap(source, destination))


if __name__ == "__main__":
    unittest.main()