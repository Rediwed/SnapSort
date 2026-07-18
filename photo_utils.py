"""
photo_utils.py

Utility functions for photo metadata extraction and manipulation.
"""

import os
import shutil
import uuid
from datetime import datetime
from typing import Optional

import piexif
from PIL import Image

JPEG_TIFF_EXTENSIONS = (".jpg", ".jpeg", ".tif", ".tiff")

# Raster formats Pillow is expected to open. A failure to open one of these is a
# genuinely broken image (error); failures on other extensions (e.g. RAW) fall
# through to metadata/hash-based processing with dimensions simply unavailable.
_PILLOW_RASTER_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff")


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


def _atomic_copy(src_path, final_path):
    """Copy *src_path* to *final_path* atomically.

    Writes to a temporary ``.snapsort-part-*.tmp`` file in the destination
    directory, fsyncs it, verifies its size, then ``os.replace()``s it into
    place and fsyncs the directory. The partial file is removed on failure so a
    crash or cancellation can never leave a corrupt file in the library. The
    ``.tmp`` suffix keeps partials out of the supported-extension scan/seed.
    """
    dest_dir = os.path.dirname(final_path)
    tmp_path = os.path.join(dest_dir, f".snapsort-part-{uuid.uuid4().hex}.tmp")
    try:
        with open(src_path, "rb") as src, open(tmp_path, "wb") as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)
            dst.flush()
            os.fsync(dst.fileno())
        # Preserve mtime/permissions (parity with the previous shutil.copy2).
        shutil.copystat(src_path, tmp_path)
        if os.path.getsize(tmp_path) != os.path.getsize(src_path):
            raise IOError("size mismatch after copy")
        os.replace(tmp_path, final_path)
        try:
            dir_fd = os.open(dest_dir, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError:
            pass
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
        raise


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
    copy_semaphore=None,
    source_root=None,
):
    """Copy a photo to the destination directory with metadata extraction and renaming.

    ⚠️  SOURCE SAFETY: This function ONLY reads from src_path and writes to
    dest_dir.  It NEVER modifies, renames, moves, or deletes the source file.
    The destination is always verified to NOT be inside the source directory.
    """
    width = None
    height = None

    # ── Source-safety check: destination must be disjoint from the SOURCE ROOT ──
    # Compare against the configured (canonicalized) source root rather than the
    # file's immediate parent, so a file deep in the source tree can never be
    # written to another location inside that same source tree. realpath() also
    # resolves symlinks, closing symlink-alias bypasses.
    _dest_real = os.path.realpath(dest_dir)
    _root = source_root if source_root else os.path.dirname(src_path)
    _src_real = os.path.realpath(_root)
    if _dest_real == _src_real or _dest_real.startswith(_src_real + os.sep):
        raise RuntimeError(
            f"SOURCE SAFETY VIOLATION: destination '{dest_dir}' is inside source "
            f"root '{_src_real}'. SnapSort never writes to source directories."
        )
    if _src_real.startswith(_dest_real + os.sep):
        raise RuntimeError(
            f"SOURCE SAFETY VIOLATION: source root '{_src_real}' is inside "
            f"destination '{dest_dir}'. This would cause re-processing of output."
        )

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
                if width < min_width or height < min_height:
                    log_message_func(f"Skipped (resolution too small): {src_path}")
                    if enable_csv_log:
                        log_csv_func(
                            "skipped",
                            f"resolution too small ({width}x{height})",
                            src_path,
                        )
                    return "skipped", None
        except Exception:
            # Formats Pillow cannot open (many RAW types) are not errors: continue
            # with metadata/hash-based processing (dimensions simply unavailable).
            # Only a format Pillow *should* handle is treated as a broken image.
            _ext = os.path.splitext(src_path)[1].lower()
            if _ext in _PILLOW_RASTER_EXTS:
                log_message_func(f"Error (cannot open image): {src_path}")
                if enable_csv_log:
                    log_csv_func("error", "cannot open image", src_path)
                return "error", None
            width = height = None

    date_taken = extract_date_taken(src_path)
    if not date_taken:
        log_message_func(f"Skipped (no valid date): {src_path}")
        if enable_csv_log:
            log_csv_func("skipped", "no valid date", src_path)
        return "skipped", None

    from path_utils import construct_dest_path

    dest_path = construct_dest_path(src_path, dest_dir, date_taken)

    # ── Step 1: Dedup index check (primary duplicate detection) ─────
    # Run BEFORE the file-exists check so that every duplicate —
    # whether caught by similarity scoring or by exact-hash at the
    # destination — is recorded in the dedup index and surfaced on the
    # Duplicates page.
    dedup_record = None
    match_path = None
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

    if dedup_index and dedup_record:
        dedup_score, dedup_match, reserved = dedup_index.find_and_reserve(dedup_record)
        log_threshold = getattr(dedup_index, "log_threshold", 0.0)
        match_path = _resolve_match_path(dedup_match)
        if dedup_match:
            dedup_record["matched_record_id"] = dedup_match.get("_id")
            dedup_record["matched_src_path"] = dedup_match.get("src_path")
            dedup_record["matched_final_path"] = dedup_match.get("final_path")

        if not reserved:
            # Strict duplicate, detected atomically under the index lock.
            if not force_copy:
                log_message_func(
                    f"Skipped (duplicate {dedup_score:.1f}% similarity): {src_path}"
                    + (f" matches {match_path}" if match_path else "")
                )
                if enable_csv_log:
                    log_csv_func(
                        "skipped",
                        f"duplicate {dedup_score:.1f}%",
                        src_path,
                        match_path or "",
                    )
                dedup_record["status"] = "skipped_duplicate"
                dedup_record["final_path"] = match_path
                dedup_index.add_record(dedup_record)
                return "skipped", match_path
            # force_copy: reserve so later files still match it, then copy.
            dedup_index.reserve(dedup_record)
        elif dedup_match and dedup_score >= log_threshold:
            log_message_func(
                f"Potential duplicate ({dedup_score:.1f}% similarity): {src_path}"
                + (f" ~ {match_path}" if match_path else "")
            )
            if enable_csv_log:
                log_csv_func(
                    "notice",
                    f"potential duplicate {dedup_score:.1f}%",
                    src_path,
                    match_path or "",
                )

    # ── Step 2: File-exists safety net ──────────────────────────────
    # If an identical file already sits at the destination path, skip
    # the copy but still record the event in the dedup index so the
    # Duplicates page reflects it.
    if os.path.exists(dest_path):
        src_hash = file_hash_func(src_path)
        dest_hash = file_hash_func(dest_path)
        if src_hash and dest_hash and src_hash == dest_hash:
            log_message_func(f"Skipped (already exists, identical): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "already exists, identical", src_path, dest_path)
            if dedup_index and dedup_record:
                dedup_index.update_record(
                    dedup_record,
                    status="skipped_duplicate",
                    similarity=100.0,
                    matched_final_path=dest_path,
                    final_path=dest_path,
                )
            return "skipped", dest_path

    # Reserve a collision-safe destination path (thread-safe when a dedup index is present).
    if dedup_index:
        final_path = dedup_index.claim_dest_path(dest_path)
    else:
        final_path = dest_path
        if os.path.exists(final_path):
            base, ext = os.path.splitext(os.path.basename(final_path))
            timestamp = date_taken.strftime("%Y%m%d_%H%M%S")
            final_path = os.path.join(os.path.dirname(final_path), f"{base}_{timestamp}{ext}")

    try:
        os.makedirs(os.path.dirname(final_path), exist_ok=True)
        if copy_semaphore:
            copy_semaphore.acquire()
        try:
            _atomic_copy(src_path, final_path)
        finally:
            if copy_semaphore:
                copy_semaphore.release()
        file_size = os.path.getsize(final_path)
        log_message_func(f"Copied: {src_path} -> {final_path}")
        if enable_csv_log:
            log_csv_func("copied", "success", src_path, final_path, file_size)
        if dedup_index and dedup_record:
            dedup_index.update_record(dedup_record, status="copied", final_path=final_path)
        return "copied", final_path
    except Exception as exc:
        log_message_func(f"Error copying {src_path}: {exc}")
        if enable_csv_log:
            log_csv_func("error", str(exc), src_path, final_path)
        if dedup_index:
            dedup_index.release_dest_path(final_path)
        if dedup_index and dedup_record:
            dedup_index.update_record(dedup_record, status="error", final_path=final_path)
        return "error", None
