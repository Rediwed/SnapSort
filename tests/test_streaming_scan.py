import tempfile
import unittest
from pathlib import Path

from photo_organizer import iter_batches, iter_directory_files


class StreamingScanTest(unittest.TestCase):
    def test_directory_iterator_prunes_system_folders_and_yields_supported_files(self):
        with tempfile.TemporaryDirectory() as temp_root:
            root = Path(temp_root)
            (root / "photos").mkdir()
            (root / "cache").mkdir()
            (root / "photos" / "one.jpg").write_bytes(b"one")
            (root / "photos" / "ignore.txt").write_bytes(b"text")
            (root / "cache" / "hidden.jpg").write_bytes(b"hidden")

            files = list(iter_directory_files(root, (".jpg",)))

            self.assertEqual(files, [str(root / "photos" / "one.jpg")])

    def test_batch_iterator_never_exceeds_requested_size(self):
        batches = list(iter_batches((str(index) for index in range(10)), 3))
        self.assertEqual([len(batch) for batch in batches], [3, 3, 3, 1])
        self.assertEqual([item for batch in batches for item in batch], [str(i) for i in range(10)])


if __name__ == "__main__":
    unittest.main()