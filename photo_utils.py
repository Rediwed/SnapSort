"""
photo_utils.py

Utility functions for photo metadata extraction and manipulation.
"""

import os
import shutil
from datetime import datetime
from typing import Optional

import piexif
from PIL import Image

JPEG_TIFF_EXTENSIONS = (".jpg", ".jpeg", ".tif", ".tiff")


def get_exif_with_exiftool(filepath):
    """Retrieve EXIF data from an image file using ExifTool."""
    import json
    import subprocess

    try:
        result = subprocess.run(
            ["exiftool", "-j", filepath],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        exif_list = json.loads(result.stdout)
        if exif_list:
            return exif_list[0]
    except Exception:
        return None
    return None


def get_date_taken_from_str(date_str):
    """Convert a date string to a datetime object."""
    try:
        return datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None


def extract_date_taken(src_path):
    """Extract the date when the photo was taken from the image file."""
    ext = os.path.splitext(src_path)[1].lower()
    exif_dict = None
    exiftool_dict = None
    date_taken: Optional[datetime] = None

    if ext in JPEG_TIFF_EXTENSIONS:
        try:
            img = Image.open(src_path)
            exif_data = img.info.get("exif")
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
                date_taken = datetime.strptime(
                    date_bytes.decode(errors="ignore"), "%Y:%m:%d %H:%M:%S"
                )
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


def _contains_system_folder(path_lower, system_folders):
    """Determine whether a path includes a configured system folder component."""
    normalized = path_lower.replace("\\", "/")
    components = [comp.strip() for comp in normalized.split("/") if comp]

    if components and len(components[0]) == 2 and components[0].endswith(":"):
        components = components[1:]

    for component in components:
        for folder in system_folders:
            if _component_matches_folder(component, folder):
                return True
    return False


def _component_matches_folder(component, folder):
    """Check whether the component should be treated as the given system folder."""
    if component == folder:
        return True
    if component.startswith(folder):
        suffix = component[len(folder) :]
        if suffix and suffix[0].isalnum():
            return False
        return True
    return False


def _resolve_match_path(dedup_match):
    if not dedup_match:
        return None
    return (
        dedup_match.get("final_path")
        or dedup_match.get("proposed_dest_path")
        or dedup_match.get("src_path")
    )


def copy_photo_with_metadata(
    src_path,
    dest_dir,
    min_width,
    min_height,
    min_file_size,
    supported_exts,
    system_folders,
    enable_csv_log,
    file_hash_func,
    log_csv_func,
    log_message_func,
    force_copy=False,
    dedup_index=None,
):
    """Copy a photo to the destination directory with metadata extraction and renaming."""
    width = None
    height = None

    if not force_copy:
        path_lower = src_path.lower()

        if "windows.old" not in path_lower:
            photo_cache_folders = [
                "lightroom",
                "adobe",
                "capture one",
                "luminar",
                "on1",
                "dxo",
                "acdsee",
                "zoner",
                "darktable",
                "rawtherapee",
                "photolab",
                "affinity",
                "corel",
                "skylum",
                "apple photos",
                "google photos",
                "picasa",
                "faststone",
                "xnview",
                "irfanview",
                "photodirector",
                "paintshop",
                "aftershot",
                "photoimpact",
                "photoplus",
                "photoscape",
                "photostudio",
                "photosuite",
                "photopad",
                "photodiva",
                "photoworks",
            ]
            is_system_path = _contains_system_folder(path_lower, system_folders)
            if is_system_path and not any(
                cache in path_lower for cache in photo_cache_folders
            ):
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
                        log_csv_func(
                            "skipped",
                            f"resolution too small ({width}x{height})",
                            src_path,
                        )
                    return "skipped", None
        except Exception:
            log_message_func(f"Skipped (cannot open image): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "cannot open image", src_path)
            return "skipped", None

    date_taken = extract_date_taken(src_path)
    if not date_taken:
        log_message_func(f"Skipped (no valid date): {src_path}")
        if enable_csv_log:
            log_csv_func("skipped", "no valid date", src_path)
        return "skipped", None

    from path_utils import construct_dest_path

    dest_path = construct_dest_path(src_path, dest_dir, date_taken)

    if os.path.exists(dest_path):
        src_hash = file_hash_func(src_path)
        dest_hash = file_hash_func(dest_path)
        if src_hash and dest_hash and src_hash == dest_hash:
            log_message_func(f"Skipped (already exists, identical): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "already exists, identical", src_path, dest_path)
            return "skipped", dest_path
        base, ext = os.path.splitext(os.path.basename(dest_path))
        timestamp = date_taken.strftime("%Y%m%d_%H%M%S")
        dest_path = os.path.join(os.path.dirname(dest_path), f"{base}_{timestamp}{ext}")

    dedup_record = None
    dedup_match = None
    dedup_score = 0.0
    if dedup_index:
        try:
            dedup_record = dedup_index.build_record(
                src_path,
                width=width,
                height=height,
                date_taken=date_taken,
                dest_path=dest_path,
            )
        except Exception:
            dedup_record = None
        if dedup_record:
            dedup_score, dedup_match = dedup_index.find_best_match(dedup_record)
            dedup_record["similarity"] = dedup_score
            if dedup_match:
                dedup_record["matched_record_id"] = dedup_match.get("_id")
                dedup_record["matched_src_path"] = dedup_match.get("src_path")
                dedup_record["matched_final_path"] = dedup_match.get("final_path")
            strict_threshold = getattr(dedup_index, "strict_threshold", 100.0)
            log_threshold = getattr(dedup_index, "log_threshold", 0.0)
            match_path = _resolve_match_path(dedup_match)

            if dedup_match and dedup_score >= strict_threshold and not force_copy:
                log_message_func(
                    f"Skipped (duplicate {dedup_score:.1f}% similarity): {src_path}"
                    + (f" matches {match_path}" if match_path else "")
                )
                if enable_csv_log:
                    log_csv_func(
                        "skipped",
                        f"duplicate {dedup_score:.1f%}",
                        src_path,
                        match_path or "",
                    )
                dedup_record["status"] = "skipped_duplicate"
                dedup_record["final_path"] = match_path
                dedup_index.add_record(dedup_record)
                return "skipped", match_path

            if dedup_match and dedup_score >= log_threshold:
                log_message_func(
                    f"Potential duplicate ({dedup_score:.1f}% similarity): {src_path}"
                    + (f" ~ {match_path}" if match_path else "")
                )
                if enable_csv_log:
                    log_csv_func(
                        "notice",
                        f"potential duplicate {dedup_score:.1f%}",
                        src_path,
                        match_path or "",
                    )

    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        shutil.copy2(src_path, dest_path)
        file_size = os.path.getsize(dest_path)
        log_message_func(f"Copied: {src_path} -> {dest_path}")
        if enable_csv_log:
            log_csv_func("copied", "success", src_path, dest_path, file_size)
        if dedup_index and dedup_record:
            dedup_record["status"] = "copied"
            dedup_record["final_path"] = dest_path
            dedup_index.add_record(dedup_record)
        return "copied", dest_path
    except Exception as exc:
        log_message_func(f"Error copying {src_path}: {exc}")
        if enable_csv_log:
            log_csv_func("error", str(exc), src_path, dest_path)
        if dedup_index and dedup_record:
            dedup_record["status"] = "error"
            dedup_record["final_path"] = dest_path
            dedup_index.add_record(dedup_record)
        return "error", None
