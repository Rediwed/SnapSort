import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from photo_utils import copy_photo_with_metadata
from dedup_utils import DeduplicationIndex
from photo_organizer import process_single_file


def file_hash(file_path):
    return hashlib.sha256(Path(file_path).read_bytes()).hexdigest()


def noop(*_args):
    return None


class PhotoFilterTest(unittest.TestCase):
    def test_rejects_photo_when_either_dimension_is_below_minimum(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source_root.mkdir()
            destination.mkdir()
            photo = source_root / "portrait.jpg"
            Image.new("RGB", (400, 1000), "red").save(photo)

            result, _ = copy_photo_with_metadata(
                photo, destination, 600, 600, 0, (".jpg",), frozenset(),
                False, file_hash, noop, noop, source_root=source_root,
            )

            self.assertEqual(result, "skipped")

    def test_exiftool_confirmed_raw_file_can_be_copied(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source_root.mkdir()
            destination.mkdir()
            photo = source_root / "photo.cr2"
            photo.write_bytes(b"raw-photo-fixture")
            metadata = {
                "ImageWidth": 4000,
                "ImageHeight": 3000,
                "DateTimeOriginal": "2026:07:18 12:30:00",
            }

            with mock.patch('photo_utils.get_exif_with_exiftool', return_value=metadata) as exiftool:
                result, copied_path = copy_photo_with_metadata(
                    photo, destination, 600, 600, 0, (".cr2",), frozenset(),
                    False, file_hash, noop, noop, source_root=source_root,
                )

            self.assertEqual(result, "copied")
            self.assertTrue(Path(copied_path).exists())
            self.assertEqual(exiftool.call_count, 1)

    def test_non_image_custom_extension_remains_an_error(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source_root.mkdir()
            destination.mkdir()
            file_path = source_root / "not-photo.txt"
            file_path.write_text("plain text")

            with mock.patch('photo_utils.get_exif_with_exiftool', return_value={"FileType": "TXT"}):
                result, _ = copy_photo_with_metadata(
                    file_path, destination, 0, 0, 0, (".txt",), frozenset(),
                    False, file_hash, noop, noop, source_root=source_root,
                )

            self.assertEqual(result, "error")

    def test_json_processing_reuses_raw_metadata_without_reopening(self):
        with tempfile.TemporaryDirectory() as temp_root:
            source_root = Path(temp_root) / "source"
            destination = Path(temp_root) / "destination"
            source_root.mkdir()
            destination.mkdir()
            photo = source_root / "photo.nef"
            photo.write_bytes(b"raw-photo-fixture")
            metadata = {
                "ImageWidth": 6000,
                "ImageHeight": 4000,
                "DateTimeOriginal": "2026:07:18 12:30:00",
            }

            with mock.patch('photo_utils.get_exif_with_exiftool', return_value=metadata) as exiftool:
                result = process_single_file(
                    str(photo),
                    dest_dir=str(destination),
                    min_width=600,
                    min_height=600,
                    min_filesize=0,
                    supported_extensions=(".nef",),
                    system_folders=frozenset(),
                    hash_func=file_hash,
                    dedup_index=DeduplicationIndex(),
                    source_root=str(source_root),
                )

            self.assertEqual(result["status"], "copied")
            self.assertEqual(result["width"], 6000)
            self.assertEqual(result["height"], 4000)
            self.assertIsNotNone(result["hash"])
            self.assertEqual(exiftool.call_count, 1)


if __name__ == "__main__":
    unittest.main()