"""Utilities for identifying duplicate or near-duplicate photos."""

from __future__ import annotations

import hashlib
import os
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from typing import Dict, Iterable, Optional, Set, Tuple, cast


def compute_partial_hash(filepath: str, max_bytes: int = 1024) -> Optional[str]:
    """Return a SHA-256 hash of the first *max_bytes* of a file."""
    try:
        hasher = hashlib.sha256()
        with open(filepath, "rb") as handle:
            chunk = handle.read(max_bytes)
            if not chunk:
                return None
            hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return None


class DeduplicationIndex:
    """Index for computing similarity between photos based on lightweight features."""

    def __init__(
        self,
        strict_threshold: float = 90.0,
        log_threshold: float = 70.0,
        partial_hash_bytes: int = 1024,
        size_bucket_bytes: int = 65536,
    ) -> None:
        self.strict_threshold = strict_threshold
        self.log_threshold = log_threshold
        self.partial_hash_bytes = partial_hash_bytes
        self._size_bucket_bytes = max(1024, size_bucket_bytes)

        self._records: Dict[int, Dict[str, object]] = {}
        self._next_id = 1

        self._by_partial_hash: Dict[str, Set[int]] = defaultdict(set)
        self._by_size_exact: Dict[int, Set[int]] = defaultdict(set)
        self._by_size_bucket: Dict[int, Set[int]] = defaultdict(set)
        self._by_resolution: Dict[int, Set[int]] = defaultdict(set)
        self._by_name: Dict[str, Set[int]] = defaultdict(set)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def build_record(
        self,
        src_path: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        date_taken: Optional[datetime] = None,
        dest_path: Optional[str] = None,
    ) -> Dict[str, object]:
        """Create a metadata record for *src_path* without registering it."""
        stat = os.stat(src_path)
        file_name: str = os.path.basename(src_path)
        record: Dict[str, object] = {
            "src_path": src_path,
            "proposed_dest_path": dest_path,
            "file_name": file_name,
            "size": stat.st_size,
            "width": width,
            "height": height,
            "partial_hash": compute_partial_hash(src_path, self.partial_hash_bytes),
            "mtime": stat.st_mtime,
            "date_taken": self._normalize_datetime(date_taken),
            "status": "pending",
        }
        record["normalized_name"] = self._normalize_name(file_name)
        record["resolution"] = self._resolution_value(width, height)
        return record

    def find_best_match(
        self, record: Dict[str, object]
    ) -> Tuple[float, Optional[Dict[str, object]]]:
        """Return the best similarity score and matching record for *record*."""
        candidate_ids = self._gather_candidate_ids(record)
        best_score = 0.0
        best_record: Optional[Dict[str, object]] = None

        for candidate_id in candidate_ids:
            candidate = self._records.get(candidate_id)
            if not candidate:
                continue
            if candidate.get("src_path") == record.get("src_path"):
                continue
            score = self._calculate_similarity(record, candidate)
            if score > best_score:
                best_score = score
                best_record = candidate
        return best_score, best_record

    def add_record(self, record: Dict[str, object]) -> int:
        """Persist *record* in the index and return its identifier."""
        record = dict(record)
        record_id = self._next_id
        self._next_id += 1
        record["_id"] = record_id
        self._records[record_id] = record

        partial_hash = record.get("partial_hash")
        if isinstance(partial_hash, str):
            self._by_partial_hash[partial_hash].add(record_id)

        size = record.get("size")
        if isinstance(size, int):
            self._by_size_exact[size].add(record_id)
            bucket = size // self._size_bucket_bytes
            for neighbor in (bucket - 1, bucket, bucket + 1):
                self._by_size_bucket[neighbor].add(record_id)

        resolution = record.get("resolution")
        if isinstance(resolution, int) and resolution > 0:
            self._by_resolution[resolution].add(record_id)

        normalized_name = record.get("normalized_name")
        if isinstance(normalized_name, str) and normalized_name:
            self._by_name[normalized_name].add(record_id)

        return record_id

    def seed_from_directory(
        self,
        directory: str,
        supported_exts: Iterable[str],
        log_message_func=None,
    ) -> int:
        """Seed the index with existing files from *directory*.

        Returns the number of files successfully added.
        """
        supported_lower = tuple(ext.lower() for ext in supported_exts)
        added = 0
        for root, _, files in os.walk(directory):
            for filename in files:
                if not filename.lower().endswith(supported_lower):
                    continue
                filepath = os.path.join(root, filename)
                try:
                    record = self.build_record(filepath, dest_path=filepath)
                    record["status"] = "seeded"
                    record["final_path"] = filepath
                    self.add_record(record)
                    added += 1
                except Exception as exc:  # pragma: no cover - best effort only
                    if log_message_func:
                        log_message_func(f"Dedup seed skipped {filepath}: {exc}")
        return added

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _gather_candidate_ids(self, record: Dict[str, object]) -> Set[int]:
        candidates: Set[int] = set()

        partial_hash = record.get("partial_hash")
        if isinstance(partial_hash, str) and partial_hash:
            candidates |= self._by_partial_hash.get(partial_hash, set())

        size = record.get("size")
        if isinstance(size, int):
            candidates |= self._by_size_exact.get(size, set())
            bucket = size // self._size_bucket_bytes
            for neighbor in (bucket - 1, bucket, bucket + 1):
                candidates |= self._by_size_bucket.get(neighbor, set())

        resolution = record.get("resolution")
        if isinstance(resolution, int) and resolution > 0:
            candidates |= self._by_resolution.get(resolution, set())

        normalized_name = record.get("normalized_name")
        if isinstance(normalized_name, str) and normalized_name:
            candidates |= self._by_name.get(normalized_name, set())

        return candidates

    def _calculate_similarity(
        self,
        left: Dict[str, object],
        right: Dict[str, object],
    ) -> float:
        score = 0.0

        weights = {
            "partial_hash": 45.0,
            "size": 20.0,
            "resolution": 15.0,
            "filename": 10.0,
            "date_taken": 5.0,
            "mtime": 5.0,
        }

        partial_left = left.get("partial_hash")
        partial_right = right.get("partial_hash")
        if isinstance(partial_left, str) and isinstance(partial_right, str):
            if partial_left == partial_right:
                score += weights["partial_hash"]

        size_left = left.get("size")
        size_right = right.get("size")
        if isinstance(size_left, int) and isinstance(size_right, int) and size_left and size_right:
            size_diff = abs(size_left - size_right)
            max_size = max(size_left, size_right)
            if size_diff == 0:
                score += weights["size"]
            else:
                relative_diff = size_diff / max_size
                if relative_diff < 0.01:
                    score += weights["size"] * (1 - relative_diff / 0.01)

        width_left = left.get("width")
        width_right = right.get("width")
        height_left = left.get("height")
        height_right = right.get("height")
        if all(isinstance(val, int) and val > 0 for val in (width_left, width_right, height_left, height_right)):
            width_left_int = cast(int, width_left)
            width_right_int = cast(int, width_right)
            height_left_int = cast(int, height_left)
            height_right_int = cast(int, height_right)

            if width_left_int == width_right_int and height_left_int == height_right_int:
                score += weights["resolution"]
            else:
                area_left = width_left_int * height_left_int
                area_right = width_right_int * height_right_int
                if area_left and area_right:
                    area_diff = abs(area_left - area_right) / max(area_left, area_right)
                    if area_diff < 0.05:
                        score += weights["resolution"] * (1 - area_diff / 0.05)

        name_left = left.get("file_name")
        name_right = right.get("file_name")
        if isinstance(name_left, str) and isinstance(name_right, str):
            ratio = SequenceMatcher(None, name_left.lower(), name_right.lower()).ratio()
            score += weights["filename"] * ratio

        date_left = self._parse_datetime(left.get("date_taken"))
        date_right = self._parse_datetime(right.get("date_taken"))
        if date_left and date_right:
            seconds = abs((date_left - date_right).total_seconds())
            if seconds == 0:
                score += weights["date_taken"]
            elif seconds < 300:
                score += weights["date_taken"] * (1 - seconds / 300)

        mtime_left = left.get("mtime")
        mtime_right = right.get("mtime")
        if isinstance(mtime_left, (int, float)) and isinstance(mtime_right, (int, float)):
            seconds = abs(mtime_left - mtime_right)
            if seconds == 0:
                score += weights["mtime"]
            elif seconds < 60:
                score += weights["mtime"] * (1 - seconds / 60)

        return round(min(score, 100.0), 2)

    @staticmethod
    def _normalize_name(filename: str) -> str:
        base, _ = os.path.splitext(filename.lower())
        return base

    @staticmethod
    def _resolution_value(width: Optional[int], height: Optional[int]) -> Optional[int]:
        if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
            return width * height
        return None

    @staticmethod
    def _normalize_datetime(value: Optional[datetime]) -> Optional[str]:
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    @staticmethod
    def _parse_datetime(value: object) -> Optional[datetime]:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
                try:
                    return datetime.strptime(value, fmt)
                except Exception:
                    continue
        return None
