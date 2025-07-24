"""
photo_utils.py

Utility functions for photo metadata extraction and manipulation.
"""

import os
from datetime import datetime
from PIL import Image
import piexif
from logging_utils import log_message, log_csv
import shutil

JPEG_TIFF_EXTENSIONS = (".jpg", ".jpeg", ".tif", ".tiff")

def get_exif_with_exiftool(filepath):
    """
    Retrieve EXIF data from an image file using ExifTool.

    Args:
        filepath (str): Path to the image file.

    Returns:
        dict or None: EXIF data as a dictionary, or None if not available.
    """
    import subprocess, json
    try:
        result = subprocess.run(
            ['exiftool', '-j', filepath],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True
        )
        exif_list = json.loads(result.stdout)
        if exif_list:
            return exif_list[0]
    except Exception:
        return None
    return None

def get_date_taken_from_str(date_str):
    """
    Convert a date string to a datetime object.

    Args:
        date_str (str): Date string in the format 'YYYY:MM:DD HH:MM:SS'.

    Returns:
        datetime or None: Corresponding datetime object, or None if parsing fails.
    """
    try:
        return datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None

def extract_date_taken(src_path):
    """
    Extract the date when the photo was taken from the image file.

    Args:
        src_path (str): Path to the source image file.

    Returns:
        datetime or None: Date when the photo was taken, or None if not available.
    """
    ext = os.path.splitext(src_path)[1].lower()
    exif_dict = None
    exiftool_dict = None
    date_taken = None

    if ext in JPEG_TIFF_EXTENSIONS:
        try:
            img = Image.open(src_path)
            exif_data = img.info.get('exif')
            if exif_data:
                try:
                    exif_dict = piexif.load(exif_data)
                except Exception:
                    exif_dict = None
        except Exception:
            exif_dict = None
        if not exif_dict:
            exiftool_dict = get_exif_with_exiftool(src_path)
    else:
        exiftool_dict = get_exif_with_exiftool(src_path)

    if exif_dict and "Exif" in exif_dict:
        date_bytes = exif_dict["Exif"].get(piexif.ExifIFD.DateTimeOriginal, b"")
        if date_bytes:
            try:
                date_taken = datetime.strptime(date_bytes.decode(errors="ignore"), "%Y:%m:%d %H:%M:%S")
            except Exception:
                date_taken = None
    elif exiftool_dict:
        date_str = exiftool_dict.get("DateTimeOriginal", "")
        date_taken = get_date_taken_from_str(date_str)
    if not date_taken:
        try:
            mtime = os.path.getmtime(src_path)
            date_taken = datetime.fromtimestamp(mtime)
        except Exception:
            date_taken = None
    return date_taken

def copy_photo_with_metadata(
    src_path, dest_dir, min_width, min_height, min_file_size,
    supported_exts, system_folders, enable_csv_log, file_hash_func,
    log_csv_func, log_message_func, force_copy=False
):
    """
    Copy a photo to the destination directory with metadata extraction and renaming.

    Args:
        src_path (str): Source image file path.
        dest_dir (str): Destination directory.
        min_width (int): Minimum width of the image.
        min_height (int): Minimum height of the image.
        min_file_size (int): Minimum file size in bytes.
        supported_exts (tuple): Supported file extensions.
        system_folders (list): List of system folders to skip.
        enable_csv_log (bool): Flag to enable CSV logging.
        file_hash_func (function): Function to calculate file hash.
        log_csv_func (function): Function to log CSV entries.
        log_message_func (function): Function to log messages.
        force_copy (bool): Flag to force copy even if checks fail.

    Returns:
        tuple: Status and destination path or None.
    """
    if not force_copy:
        path_lower = src_path.lower()

        # Always allow anything under windows.old
        if "windows.old" not in path_lower:
            # List of photo software cache folders to allow (not skip)
            photo_cache_folders = [
                "lightroom", "adobe", "capture one", "luminar", "on1", "dxo", "acdsee", "zoner", "darktable",
                "rawtherapee", "photolab", "affinity", "corel", "skylum", "apple photos", "google photos",
                "picasa", "faststone", "xnview", "irfanview", "photodirector", "paintshop", "aftershot",
                "photoimpact", "photoplus", "photoscape", "photostudio", "photosuite", "photopad",
                "photodiva", "photoworks"
            ]
            # If it's a system/app folder, but NOT a photo cache folder, skip it
            if any(folder in path_lower for folder in system_folders) and not any(cache in path_lower for cache in photo_cache_folders):
                log_message_func(f"Skipped (system/app folder): {src_path}")
                if enable_csv_log:
                    log_csv_func("skipped", "system/app folder", src_path)
                return "skipped", None

        if os.path.getsize(src_path) < min_file_size:
            log_message_func(f"Skipped (file too small): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "file too small", src_path)
            return "skipped", None

        try:
            with Image.open(src_path) as img:
                width, height = img.size
                if width < min_width and height < min_height:
                    log_message_func(f"Skipped (resolution too small): {src_path}")
                    if enable_csv_log:
                        log_csv_func("skipped", f"resolution too small ({width}x{height})", src_path)
                    return "skipped", None
        except Exception:
            log_message_func(f"Skipped (cannot open image): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "cannot open image", src_path)
            return "skipped", None

    # Date extraction
    date_taken = extract_date_taken(src_path)
    if not date_taken:
        log_message_func(f"Skipped (no valid date): {src_path}")
        if enable_csv_log:
            log_csv_func("skipped", "no valid date", src_path)
        return "skipped", None

    # Path construction
    from path_utils import construct_dest_path
    dest_path = construct_dest_path(src_path, dest_dir, date_taken)

    # Duplicate handling
    if os.path.exists(dest_path):
        src_hash = file_hash_func(src_path)
        dest_hash = file_hash_func(dest_path)
        if src_hash and dest_hash and src_hash == dest_hash:
            log_message_func(f"Skipped (already exists, identical): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "already exists, identical", src_path, dest_path)
            return "skipped", dest_path
        else:
            base, ext = os.path.splitext(os.path.basename(dest_path))
            timestamp = date_taken.strftime("%Y%m%d_%H%M%S")
            dest_path = os.path.join(os.path.dirname(dest_path), f"{base}_{timestamp}{ext}")

    # Copy file
    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        shutil.copy2(src_path, dest_path)
        file_size = os.path.getsize(dest_path)
        log_message_func(f"Copied: {src_path} -> {dest_path}")
        if enable_csv_log:
            log_csv_func("copied", "success", src_path, dest_path, file_size)
        return "copied", dest_path
    except Exception as e:
        log_message_func(f"Error copying {src_path}: {e}")
        if enable_csv_log:
            log_csv_func("error", str(e), src_path, dest_path)
        return "error", None