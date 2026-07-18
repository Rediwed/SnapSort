"""
photo_utils.py

Utility functions for photo metadata extraction and manipulation.
"""

import os
import shutil
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

import piexif
from PIL import Image

JPEG_TIFF_EXTENSIONS = (".jpg", ".jpeg", ".tif", ".tiff")
COPY_CHUNK_SIZE = 1024 * 1024
MAX_COLLISION_ATTEMPTS = 10000
_destination_locks = {}
_destination_locks_guard = threading.Lock()

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None


@contextmanager
def destination_lock(directory):
    """Serialize final-path selection and installation in one directory."""
    from path_utils import canonicalize_path

    canonical_directory = canonicalize_path(directory)
    with _destination_locks_guard:
        thread_lock = _destination_locks.setdefault(
            canonical_directory, threading.Lock()
        )

    with thread_lock:
        lock_path = os.path.join(canonical_directory, ".snapsort.lock")
        with open(lock_path, "a+b") as lock_file:
            if fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _fsync_directory(directory):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        directory_fd = os.open(directory, flags)
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _destination_candidates(dest_path, date_taken):
    yield dest_path
    base, ext = os.path.splitext(dest_path)
    timestamp = date_taken.strftime("%Y%m%d_%H%M%S")
    timestamped = f"{base}_{timestamp}{ext}"
    yield timestamped
    for counter in range(1, MAX_COLLISION_ATTEMPTS):
        yield f"{base}_{timestamp}_{counter}{ext}"


def copy_file_atomic(src_path, dest_path, date_taken, hash_func):
    """Copy and verify a file before atomically installing a unique final path.

    Returns ``(final_path, copied)``. ``copied`` is false when an identical
    destination already exists.
    """
    src_path = os.fspath(src_path)
    dest_path = os.fspath(dest_path)
    destination_directory = os.path.dirname(dest_path)
    os.makedirs(destination_directory, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(
        prefix=".snapsort-part-", suffix=".tmp", dir=destination_directory
    )

    try:
        with open(src_path, "rb") as source_file, os.fdopen(temp_fd, "wb") as temp_file:
            temp_fd = None
            shutil.copyfileobj(source_file, temp_file, length=COPY_CHUNK_SIZE)
            temp_file.flush()
            os.fsync(temp_file.fileno())

        shutil.copystat(src_path, temp_path, follow_symlinks=False)
        with open(temp_path, "rb") as temp_file:
            os.fsync(temp_file.fileno())

        if os.path.getsize(src_path) != os.path.getsize(temp_path):
            raise OSError("Atomic copy verification failed: size mismatch")
        source_hash = hash_func(src_path)
        temp_hash = hash_func(temp_path)
        if not source_hash or source_hash != temp_hash:
            raise OSError("Atomic copy verification failed: hash mismatch")

        with destination_lock(destination_directory):
            for candidate in _destination_candidates(dest_path, date_taken):
                if os.path.exists(candidate):
                    candidate_hash = hash_func(candidate)
                    if candidate_hash and candidate_hash == source_hash:
                        return candidate, False
                    continue

                os.replace(temp_path, candidate)
                temp_path = None
                _fsync_directory(destination_directory)
                return candidate, True

        raise OSError("Unable to allocate a unique destination filename")
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


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
            with Image.open(src_path) as img:
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


def _copy_photo_with_metadata_impl(
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

    # ── Source-safety check: source and destination must be completely disjoint ──
    from path_utils import canonicalize_path, path_is_within, paths_overlap

    canonical_source_root = canonicalize_path(
        source_root or os.path.dirname(src_path)
    )
    canonical_source_path = canonicalize_path(src_path)
    canonical_dest_dir = canonicalize_path(dest_dir)
    if not path_is_within(canonical_source_root, canonical_source_path):
        raise RuntimeError(
            f"SOURCE SAFETY VIOLATION: file '{src_path}' is outside configured "
            f"source root '{canonical_source_root}'."
        )
    if paths_overlap(canonical_source_root, canonical_dest_dir):
        raise RuntimeError(
            f"SOURCE SAFETY VIOLATION: source '{canonical_source_root}' and "
            f"destination '{canonical_dest_dir}' overlap."
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
            log_message_func(f"Error (cannot open image): {src_path}")
            if enable_csv_log:
                log_csv_func("error", "cannot open image", src_path)
            return "error", None

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
                        f"duplicate {dedup_score:.1f}%",
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
                        f"potential duplicate {dedup_score:.1f}%",
                        src_path,
                        match_path or "",
                    )

    try:
        if copy_semaphore:
            copy_semaphore.acquire()
        try:
            dest_path, copied = copy_file_atomic(
                src_path, dest_path, date_taken, file_hash_func
            )
        finally:
            if copy_semaphore:
                copy_semaphore.release()

        if not copied:
            log_message_func(f"Skipped (already exists, identical): {src_path}")
            if enable_csv_log:
                log_csv_func("skipped", "already exists, identical", src_path, dest_path)
            if dedup_index and dedup_record:
                dedup_record["status"] = "skipped_duplicate"
                dedup_record["similarity"] = 100.0
                dedup_record["matched_final_path"] = dest_path
                dedup_record["final_path"] = dest_path
                dedup_index.add_record(dedup_record)
            return "skipped", dest_path

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
    """Run match, copy, and index registration under an exact-content guard."""
    if dedup_index is None:
        return _copy_photo_with_metadata_impl(
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
            force_copy=force_copy,
            copy_semaphore=copy_semaphore,
            source_root=source_root,
        )

    with dedup_index.copy_guard(src_path):
        return _copy_photo_with_metadata_impl(
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
            force_copy=force_copy,
            dedup_index=dedup_index,
            copy_semaphore=copy_semaphore,
            source_root=source_root,
        )
