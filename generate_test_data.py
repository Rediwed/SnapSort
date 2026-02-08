#!/usr/bin/env python3
"""
generate_test_data.py — Create realistic test datasets for SnapSort.

Generates 5 source datasets (simulating different drives/folders) and
1 destination dataset with pre-existing photos.  Exercises:

  • System/UI images that should be SKIPPED (small icons, banners, cache, etc.)
  • Real photos that should be COPIED (large, with EXIF dates)
  • Cross-set duplicates (same image in multiple sources)
  • Renamed duplicates already in the destination
  • Edge-cases: no EXIF, corrupt files, zero-byte, wrong extension, borderline size

Target: SnapSort organize run across all sources takes ~30 seconds.
"""

import json
import os
import random
import struct
import sys
import time
from datetime import datetime, timedelta
from io import BytesIO
from typing import Dict, List, Optional, Set, Tuple

from PIL import Image

try:
    import piexif
except ImportError:
    piexif = None  # EXIF injection will be skipped

# ── Configuration ──────────────────────────────────────────────────────
BASE_DIR = os.path.join(os.path.dirname(__file__), "test_data")
SEED = 42  # reproducible randomness

# How many "real photos" per source — tuned so organizing all 5 sources ≈ 30s
PHOTOS_PER_SOURCE = 60
# How many tiny UI/system images per source
UI_IMAGES_PER_SOURCE = 30

random.seed(SEED)

# ── Helpers ────────────────────────────────────────────────────────────

def _exif_bytes(dt: datetime) -> bytes:
    """Build minimal EXIF bytes with DateTimeOriginal set."""
    if piexif is None:
        return b""
    exif_dict = {
        "0th": {piexif.ImageIFD.Software: "SnapSort TestGen"},
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: dt.strftime("%Y:%m:%d %H:%M:%S").encode(),
            piexif.ExifIFD.DateTimeDigitized: dt.strftime("%Y:%m:%d %H:%M:%S").encode(),
        },
    }
    return piexif.dump(exif_dict)


def make_photo(
    width: int,
    height: int,
    seed_color: Optional[Tuple[int, int, int]] = None,
    dt: Optional[datetime] = None,
    fmt: str = "JPEG",
    unique_id: int = 0,
) -> bytes:
    """Generate a photo-like image in memory and return raw bytes.

    Uses deterministic seeded random state so identical (seed_color, unique_id)
    pairs produce byte-identical files — enabling dedup testing.
    Fast: uses numpy for bulk pixel generation instead of per-pixel loops.
    """
    import numpy as np

    rng = random.Random(hash((seed_color, unique_id)))
    np_rng = np.random.RandomState(abs(hash((seed_color, unique_id))) % (2**31))
    if seed_color is None:
        seed_color = (rng.randint(30, 225), rng.randint(30, 225), rng.randint(30, 225))

    # Build a gradient base + noise — fast via numpy
    ys = np.arange(height, dtype=np.float32).reshape(-1, 1)
    xs = np.arange(width, dtype=np.float32).reshape(1, -1)
    r = ((seed_color[0] + xs * 3 + ys) % 256).astype(np.uint8)
    g = ((seed_color[1] + ys * 2 + xs) % 256).astype(np.uint8)
    b = ((seed_color[2] + (xs + ys) * 2) % 256).astype(np.uint8)
    # Add per-pixel noise for realistic JPEG entropy (bigger files)
    noise = np_rng.randint(0, 40, (height, width, 3), dtype=np.uint8)
    arr = np.stack([r, g, b], axis=2)
    arr = np.clip(arr.astype(np.int16) + noise.astype(np.int16) - 20, 0, 255).astype(np.uint8)

    img = Image.fromarray(arr, "RGB")
    buf = BytesIO()
    save_kwargs = {}
    if fmt == "JPEG":
        save_kwargs["quality"] = rng.randint(80, 95)
        if dt and piexif:
            save_kwargs["exif"] = _exif_bytes(dt)
    img.save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


def make_icon(width: int, height: int, seed: int = 0) -> bytes:
    """Tiny icon/UI element — PNG, solid color with simple shape."""
    img = Image.new("RGBA", (width, height), (seed % 200, (seed * 7) % 200, (seed * 13) % 200, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def write_file(path: str, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def make_corrupt_jpeg(size: int = 80_000) -> bytes:
    """JPEG SOI marker followed by random garbage."""
    return b"\xff\xd8\xff\xe0" + os.urandom(size)


def make_zero_byte(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").close()


# ── Shared photo pool (used across sources for cross-set duplicates) ──

class PhotoPool:
    """Pre-generate a pool of photo data blobs that can be reused across sources."""

    def __init__(self):
        self.photos: List[dict] = []

    def generate(self, count: int):
        """Create *count* unique photos with random EXIF dates spanning 5 years.

        Images are generated at full resolution for realistic file sizes
        (500 KB – 2 MB each).  numpy makes this fast (~0.1s per image).
        """
        base_dt = datetime(2019, 3, 15, 10, 0, 0)
        t0 = time.time()
        for i in range(count):
            dt = base_dt + timedelta(
                days=random.randint(0, 1825),
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
                seconds=random.randint(0, 59),
            )
            # Vary dimensions: landscape, portrait, square
            orientation = random.choice(["landscape", "portrait", "square"])
            if orientation == "landscape":
                w, h = random.choice([(4032, 3024), (3840, 2160), (2048, 1536), (1920, 1080)])
            elif orientation == "portrait":
                w, h = random.choice([(3024, 4032), (2160, 3840), (1080, 1920)])
            else:
                w, h = random.choice([(2048, 2048), (1080, 1080)])

            color = (random.randint(20, 235), random.randint(20, 235), random.randint(20, 235))
            fmt = random.choices(["JPEG", "PNG"], weights=[85, 15], k=1)[0]
            data = make_photo(w, h, seed_color=color, dt=dt if fmt == "JPEG" else None, fmt=fmt, unique_id=i)

            self.photos.append({
                "id": i,
                "data": data,
                "dt": dt,
                "fmt": fmt,
                "ext": ".jpg" if fmt == "JPEG" else ".png",
                "w": w,
                "h": h,
            })

            if (i + 1) % 20 == 0 or i == count - 1:
                elapsed = time.time() - t0
                sz_mb = sum(len(p["data"]) for p in self.photos) / 1024 / 1024
                print(f"    {i + 1}/{count} photos ({sz_mb:.0f} MB) [{elapsed:.1f}s]", flush=True)

    def get(self, idx: int) -> dict:
        return self.photos[idx % len(self.photos)]


# ── Source generators ─────────────────────────────────────────────────

def gen_source_camera_sd(pool: PhotoPool, base: str):
    """Source 1 — Camera SD card (DCIM/100CANON structure)."""
    root = os.path.join(base, "source_camera_sd")
    folder_num = 100
    count = 0

    # Real photos in DCIM structure
    indices = random.sample(range(len(pool.photos)), min(PHOTOS_PER_SOURCE, len(pool.photos)))
    for i, idx in enumerate(indices):
        p = pool.get(idx)
        folder = f"DCIM/{folder_num + i // 10:03d}CANON"
        name = f"IMG_{8000 + i:04d}{p['ext']}"
        write_file(os.path.join(root, folder, name), p["data"])
        count += 1

    # Camera thumbnails (tiny — should be skipped)
    for i in range(8):
        data = make_icon(160, 120, seed=i + 500)
        write_file(os.path.join(root, "DCIM/.thumbnails", f"thumb_{i:03d}.jpg"), data)

    print(f"  camera_sd: {count} photos + 8 thumbnails")
    return indices


def gen_source_downloads(pool: PhotoPool, base: str, shared_indices: List[int]):
    """Source 2 — ~/Downloads with mixed content: photos, screenshots, memes."""
    root = os.path.join(base, "source_downloads")
    count = 0

    # Pick some unique photos and some that overlap with camera
    overlap = random.sample(shared_indices, min(8, len(shared_indices)))
    unique = random.sample(
        [i for i in range(len(pool.photos)) if i not in shared_indices],
        min(PHOTOS_PER_SOURCE - len(overlap), len(pool.photos) - len(shared_indices)),
    )
    indices = overlap + unique

    for i, idx in enumerate(indices):
        p = pool.get(idx)
        # Downloads have messy names
        name_styles = [
            f"photo_{random.randint(1000, 9999)}{p['ext']}",
            f"IMG-20{random.randint(19, 24)}{random.randint(10, 12):02d}{random.randint(10, 28):02d}-WA{random.randint(1000, 9999)}{p['ext']}",
            f"download ({random.randint(1, 50)}){p['ext']}",
            f"image{random.randint(1, 200)}{p['ext']}",
            f"Screenshot_20{random.randint(20, 25)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}{p['ext']}",
        ]
        name = random.choice(name_styles)
        write_file(os.path.join(root, name), p["data"])
        count += 1

    # Small web images / memes (under min size — should be skipped)
    for i in range(12):
        data = make_icon(random.randint(200, 400), random.randint(200, 400), seed=i + 1000)
        ext = random.choice([".jpg", ".png", ".gif"])
        write_file(os.path.join(root, f"meme_{i:02d}{ext}"), data)

    # Non-image files (should be ignored entirely)
    write_file(os.path.join(root, "document.pdf"), b"%PDF-1.4 fake pdf content" * 100)
    write_file(os.path.join(root, "notes.txt"), b"some text notes")
    write_file(os.path.join(root, "archive.zip"), b"PK\x03\x04" + os.urandom(500))

    print(f"  downloads: {count} photos + 12 small images + 3 non-images")
    return indices


def gen_source_phone_backup(pool: PhotoPool, base: str, shared_indices: List[int]):
    """Source 3 — Phone backup (WhatsApp, Camera, Screenshots dirs)."""
    root = os.path.join(base, "source_phone_backup")
    count = 0

    # Camera photos — some overlap
    overlap = random.sample(shared_indices, min(6, len(shared_indices)))
    unique = random.sample(
        [i for i in range(len(pool.photos)) if i not in set(shared_indices)],
        min(PHOTOS_PER_SOURCE - 12, len(pool.photos) - len(shared_indices)),
    )
    cam_indices = overlap + unique

    for i, idx in enumerate(cam_indices):
        p = pool.get(idx)
        name = f"IMG_20{p['dt'].strftime('%y%m%d_%H%M%S')}_{i:03d}{p['ext']}"
        write_file(os.path.join(root, "DCIM/Camera", name), p["data"])
        count += 1

    # WhatsApp images — some are duplicates of camera shots with different names
    wa_indices = random.sample(cam_indices[:10], min(6, len(cam_indices)))
    for i, idx in enumerate(wa_indices):
        p = pool.get(idx)
        name = f"IMG-20{p['dt'].strftime('%y%m%d')}-WA{random.randint(1000, 9999)}{p['ext']}"
        write_file(os.path.join(root, "WhatsApp/Media/WhatsApp Images", name), p["data"])
        count += 1

    # Screenshots (small, should be skipped or borderline)
    for i in range(10):
        w, h = random.choice([(540, 960), (720, 1280), (390, 844)])
        data = make_photo(w, h, seed_color=(50, 50, 60), unique_id=9000 + i, fmt="PNG")
        write_file(os.path.join(root, "DCIM/Screenshots", f"Screenshot_{i:03d}.png"), data)

    print(f"  phone_backup: {count} photos + 10 screenshots")
    return cam_indices + wa_indices


def gen_source_old_desktop(pool: PhotoPool, base: str, shared_indices: List[int]):
    """Source 4 — Old desktop backup with OS folders and buried photos."""
    root = os.path.join(base, "source_old_desktop")
    count = 0

    # Simulate OS / app folders with tiny UI images (should all be skipped)
    system_dirs = {
        "Windows/System32": [("shell32_{}.png", 32, 32, 20)],
        "Windows/SysWOW64": [("icon_{}.png", 16, 16, 10)],
        "Program Files/SomeApp/icons": [("app_icon_{}.png", 48, 48, 15)],
        "Program Files/Browser/cache": [("cached_{}.jpg", 80, 60, 12)],
        "AppData/Local/Temp": [("tmp_{}.png", 100, 100, 8)],
        "AppData/Local/Thumbnails": [("thumb_{}.jpg", 120, 90, 10)],
        "Program Files/SomeApp/banners": [("banner_{}.png", 468, 60, 5)],
        "AppData/Local/Icons": [("ico_{}.png", 24, 24, 10)],
    }
    ui_count = 0
    for folder, templates in system_dirs.items():
        for tmpl, w, h, n in templates:
            for i in range(n):
                data = make_icon(w, h, seed=hash((folder, i)))
                write_file(os.path.join(root, folder, tmpl.format(i)), data)
                ui_count += 1

    # Deeply nested real photos in "Users/John/Pictures"
    overlap = random.sample(shared_indices, min(10, len(shared_indices)))
    unique = random.sample(
        [i for i in range(len(pool.photos)) if i not in set(shared_indices)],
        min(PHOTOS_PER_SOURCE - len(overlap), len(pool.photos) - len(shared_indices)),
    )
    photo_indices = overlap + unique
    subfolders = ["Vacation 2020", "Family", "Birthday Party", "Random", "Camera Uploads"]

    for i, idx in enumerate(photo_indices):
        p = pool.get(idx)
        subfolder = random.choice(subfolders)
        # Sometimes renamed copies
        name_styles = [
            f"IMG_{4000 + i:04d}{p['ext']}",
            f"{subfolder.replace(' ', '_')}_{i:03d}{p['ext']}",
            f"Photo {p['dt'].strftime('%b %Y')} ({i}){p['ext']}",
            f"Copy of IMG_{4000 + i:04d}{p['ext']}",  # "Copy of" prefix
        ]
        name = random.choice(name_styles)
        write_file(os.path.join(root, "Users/John/Pictures", subfolder, name), p["data"])
        count += 1

    print(f"  old_desktop: {count} photos + {ui_count} OS/UI images in system folders")
    return photo_indices


def gen_source_external_hdd(pool: PhotoPool, base: str, shared_indices: List[int]):
    """Source 5 — External HDD dump with everything mixed together."""
    root = os.path.join(base, "source_external_hdd")
    count = 0

    # Grab photos — heavy overlap with other sources
    all_overlap = random.sample(shared_indices, min(15, len(shared_indices)))
    unique = random.sample(
        [i for i in range(len(pool.photos)) if i not in set(shared_indices)],
        min(PHOTOS_PER_SOURCE - len(all_overlap), len(pool.photos) - len(shared_indices)),
    )
    photo_indices = all_overlap + unique

    dirs = ["photos", "backup", "misc/old_photos", "unsorted", "2021", "2022", "camera_dump"]
    for i, idx in enumerate(photo_indices):
        p = pool.get(idx)
        d = random.choice(dirs)
        name = f"DSC{random.randint(1000, 9999)}{p['ext']}"
        write_file(os.path.join(root, d, name), p["data"])
        count += 1

    # ── EDGE CASES ────────────────────────────────────────────────────
    edge_dir = os.path.join(root, "edge_cases")

    # 1. Corrupt JPEG (valid SOI, garbage after)
    write_file(os.path.join(edge_dir, "corrupt_photo.jpg"), make_corrupt_jpeg())
    # 2. Zero-byte file
    make_zero_byte(os.path.join(edge_dir, "empty.jpg"))
    # 3. Wrong extension (PNG data in a .jpg file)
    png_data = make_photo(800, 600, seed_color=(100, 200, 50), unique_id=7777, fmt="PNG")
    write_file(os.path.join(edge_dir, "wrong_ext.jpg"), png_data)
    # 4. Very large filename
    long_name = "A" * 200 + ".jpg"
    write_file(os.path.join(edge_dir, long_name), pool.get(0)["data"])
    # 5. Photo exactly at MIN_FILESIZE boundary (50 KB)
    borderline = make_photo(300, 300, seed_color=(128, 128, 128), unique_id=8888, fmt="JPEG")
    # Pad or truncate to exactly 51200 bytes
    if len(borderline) < 51200:
        borderline += b"\x00" * (51200 - len(borderline))
    else:
        borderline = borderline[:51200]
    write_file(os.path.join(edge_dir, "borderline_50kb.jpg"), borderline)
    # 6. Photo with no EXIF (PNG, large enough to pass filters)
    no_exif = make_photo(1024, 768, seed_color=(60, 180, 120), unique_id=9999, fmt="PNG")
    write_file(os.path.join(edge_dir, "no_exif_large.png"), no_exif)
    # 7. HEIC extension stub (not a real HEIC, just to test extension handling)
    write_file(os.path.join(edge_dir, "fake_heic.heic"), b"fake heic content not real")
    # 8. Duplicate pair with only 1 byte difference
    base_data = bytearray(pool.get(5)["data"])
    base_data[-1] = (base_data[-1] + 1) % 256
    write_file(os.path.join(edge_dir, "near_duplicate.jpg"), bytes(base_data))
    # 9. Image at exactly min dimensions (600×600)
    exact_min = make_photo(600, 600, seed_color=(200, 100, 50), unique_id=6666, fmt="JPEG")
    write_file(os.path.join(edge_dir, "exact_min_600x600.jpg"), exact_min)
    # 10. Image just below min dimensions (599×599)
    below_min = make_photo(599, 599, seed_color=(200, 100, 50), unique_id=5555, fmt="JPEG")
    write_file(os.path.join(edge_dir, "below_min_599x599.jpg"), below_min)

    print(f"  external_hdd: {count} photos + 10 edge-case files")
    return photo_indices


def gen_destination(pool: PhotoPool, all_used_indices: Set[int], base: str):
    """Destination folder — pre-populated with some photos already organized.

    Simulates a previous run: Year/Month structure, some photos are the
    same content as source files but possibly with different names.
    """
    root = os.path.join(base, "destination")
    count = 0

    # Pick a subset of photos that "already exist" in dest
    pre_existing = random.sample(sorted(all_used_indices), min(50, len(all_used_indices)))

    for i, idx in enumerate(pre_existing):
        p = pool.get(idx)
        year = p["dt"].strftime("%Y")
        month = p["dt"].strftime("%m")

        # Sometimes same name as source, sometimes renamed
        if i % 3 == 0:
            # Exact same canonical name
            name = f"IMG_{idx:04d}{p['ext']}"
        elif i % 3 == 1:
            # Renamed but same content (dedup should catch by hash)
            name = f"organized_{random.randint(1, 999):03d}{p['ext']}"
        else:
            # Different naming pattern entirely
            name = f"{p['dt'].strftime('%Y-%m-%d_%H%M%S')}{p['ext']}"

        write_file(os.path.join(root, year, month, name), p["data"])
        count += 1

    # Add a few photos that exist ONLY in destination (should not be touched)
    for i in range(5):
        dt = datetime(2023, 6, 15, 12, 0, 0) + timedelta(days=i)
        data = make_photo(800, 600, seed_color=(10, 10, 10 + i * 40), dt=dt, unique_id=50000 + i)
        year = dt.strftime("%Y")
        month = dt.strftime("%m")
        write_file(os.path.join(root, year, month, f"dest_only_{i:03d}.jpg"), data)
        count += 1

    print(f"  destination: {count} pre-existing photos ({len(pre_existing)} are duplicates of source)")


# ── Main ──────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print(f"SnapSort Test Data Generator")
    print(f"Output directory: {BASE_DIR}\n")

    # Clean previous run
    if os.path.exists(BASE_DIR):
        import shutil
        shutil.rmtree(BASE_DIR)

    # Build shared photo pool  —  150 unique full-res photos ≈ 150-250 MB
    total_unique = 150
    print(f"Generating pool of {total_unique} unique full-resolution photos …")
    pool = PhotoPool()
    pool.generate(total_unique)
    print(f"  Pool ready ({len(pool.photos)} photos)\n")

    all_indices: Set[int] = set()

    print("Creating source datasets:")
    idx1 = gen_source_camera_sd(pool, BASE_DIR)
    all_indices.update(idx1)

    idx2 = gen_source_downloads(pool, BASE_DIR, idx1)
    all_indices.update(idx2)

    idx3 = gen_source_phone_backup(pool, BASE_DIR, idx1 + idx2)
    all_indices.update(idx3)

    idx4 = gen_source_old_desktop(pool, BASE_DIR, list(all_indices))
    all_indices.update(idx4)

    idx5 = gen_source_external_hdd(pool, BASE_DIR, list(all_indices))
    all_indices.update(idx5)

    print("\nCreating destination dataset:")
    gen_destination(pool, all_indices, BASE_DIR)

    elapsed = time.time() - t0

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Generation complete in {elapsed:.1f}s")
    print(f"Unique photos in pool: {total_unique}")
    print(f"Source datasets: 5")
    print(f"  1. source_camera_sd    — Camera DCIM structure")
    print(f"  2. source_downloads    — Messy downloads folder")
    print(f"  3. source_phone_backup — Phone with WhatsApp/Camera/Screenshots")
    print(f"  4. source_old_desktop  — OS drive with system folders + buried photos")
    print(f"  5. source_external_hdd — Mixed dump + edge cases")
    print(f"Destination: pre-seeded with duplicates for dedup testing")
    print(f"\nTo run SnapSort against each source:")
    print(f"  python3 photo_organizer.py")
    print(f"  Source: {os.path.join(BASE_DIR, 'source_camera_sd')}")
    print(f"  Dest:   {os.path.join(BASE_DIR, 'destination')}")

    # Write a manifest for programmatic use
    manifest = {
        "generated_at": datetime.now().isoformat(),
        "base_dir": os.path.abspath(BASE_DIR),
        "pool_size": total_unique,
        "sources": [
            "source_camera_sd",
            "source_downloads",
            "source_phone_backup",
            "source_old_desktop",
            "source_external_hdd",
        ],
        "destination": "destination",
        "edge_cases": [
            "corrupt_photo.jpg — JPEG SOI + garbage",
            "empty.jpg — zero-byte file",
            "wrong_ext.jpg — PNG data with .jpg extension",
            f"{('A' * 200)}.jpg — 200-char filename",
            "borderline_50kb.jpg — exactly at MIN_FILESIZE boundary",
            "no_exif_large.png — large PNG with no EXIF",
            "fake_heic.heic — invalid HEIC stub",
            "near_duplicate.jpg — 1-byte diff from pool photo #5",
            "exact_min_600x600.jpg — exactly at min dimensions",
            "below_min_599x599.jpg — 1px below min dimensions",
        ],
    }
    manifest_path = os.path.join(BASE_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest written to {manifest_path}")


if __name__ == "__main__":
    main()
