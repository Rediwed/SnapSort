#!/usr/bin/env python3
"""
generate_demo_data.py — Download real photos for beautiful SnapSort screenshots.

Uses Lorem Picsum (backed by Unsplash, freely licensed) to fetch realistic
photos, then injects EXIF metadata so SnapSort's date-sorting and dedup
logic still works correctly.

Usage:
    python3 generate_demo_data.py              # default: 80 photos
    python3 generate_demo_data.py --count 40   # fewer photos (faster)

The resulting demo_data/ folder mirrors the same structure as test_data/
so the app's test-presets endpoint can discover it.
"""

import json
import os
import random
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from io import BytesIO
from typing import List, Optional, Set, Tuple

try:
    from PIL import Image
except ImportError:
    print("Missing Pillow — install with: pip install Pillow")
    sys.exit(1)

try:
    import piexif
except ImportError:
    piexif = None
    print("Warning: piexif not installed — EXIF dates will not be injected.")
    print("Install with: pip install piexif")

# ── Configuration ──────────────────────────────────────────────────────
BASE_DIR = os.path.join(os.path.dirname(__file__), "demo_data")
SEED = 42
PICSUM_BASE = "https://picsum.photos/seed"

# Photo pool sizes
DEFAULT_POOL_SIZE = 80   # unique photos to download
DOWNLOAD_TIMEOUT = 15    # seconds per image

# Resolutions that look like real camera/phone photos
RESOLUTIONS = [
    (4032, 3024),  # iPhone 12+
    (3840, 2160),  # 4K landscape
    (3024, 4032),  # iPhone portrait
    (2048, 1536),  # compact camera
    (1920, 1080),  # Full HD
    (1080, 1920),  # phone portrait FHD
    (2048, 2048),  # square
    (1600, 1200),  # 2MP landscape
]

random.seed(SEED)

# ── Helpers ────────────────────────────────────────────────────────────

def _exif_bytes(dt: datetime, camera: str = "Canon EOS R5") -> bytes:
    """Build EXIF bytes with DateTimeOriginal and camera model."""
    if piexif is None:
        return b""
    exif_dict = {
        "0th": {
            piexif.ImageIFD.Make: camera.split()[0].encode(),
            piexif.ImageIFD.Model: camera.encode(),
            piexif.ImageIFD.Software: "SnapSort DemoGen".encode(),
        },
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: dt.strftime("%Y:%m:%d %H:%M:%S").encode(),
            piexif.ExifIFD.DateTimeDigitized: dt.strftime("%Y:%m:%d %H:%M:%S").encode(),
        },
    }
    return piexif.dump(exif_dict)


def download_photo(seed_id: int, width: int, height: int) -> Optional[bytes]:
    """Download a photo from Lorem Picsum. Returns JPEG bytes or None."""
    url = f"{PICSUM_BASE}/{seed_id}/{width}/{height}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SnapSort-DemoGen/1.0"})
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as resp:
            return resp.read()
    except Exception as e:
        print(f"    ⚠ Failed to download seed {seed_id}: {e}")
        return None


def inject_exif(jpeg_bytes: bytes, dt: datetime, camera: str = "Canon EOS R5") -> bytes:
    """Re-save a JPEG with EXIF metadata injected."""
    if piexif is None:
        return jpeg_bytes
    try:
        img = Image.open(BytesIO(jpeg_bytes))
        buf = BytesIO()
        exif = _exif_bytes(dt, camera)
        img.save(buf, format="JPEG", quality=92, exif=exif)
        return buf.getvalue()
    except Exception:
        return jpeg_bytes


def write_file(path: str, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def make_small_image(width: int, height: int, seed: int = 0) -> bytes:
    """Create a tiny placeholder image (icons, thumbnails, UI elements)."""
    img = Image.new("RGB", (width, height), (seed % 200, (seed * 7) % 200, (seed * 13) % 200))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Photo pool via Picsum ──────────────────────────────────────────────

class DemoPhotoPool:
    """Download and cache a pool of real photos from Lorem Picsum."""

    def __init__(self):
        self.photos: List[dict] = []

    def download(self, count: int):
        """Download *count* photos with random EXIF dates spanning 5 years."""
        base_dt = datetime(2019, 3, 15, 10, 0, 0)
        cameras = [
            "Canon EOS R5", "Nikon Z6 II", "Sony A7 IV",
            "iPhone 14 Pro", "Samsung Galaxy S23", "Google Pixel 8",
            "Fujifilm X-T5", "Canon EOS 5D Mark IV",
        ]
        t0 = time.time()
        failures = 0

        for i in range(count):
            dt = base_dt + timedelta(
                days=random.randint(0, 1825),
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
                seconds=random.randint(0, 59),
            )
            w, h = random.choice(RESOLUTIONS)
            camera = random.choice(cameras)

            # Use deterministic seed IDs so re-running gives the same photos
            seed_id = 1000 + i

            # Download at a reasonable size (Picsum is fast at smaller sizes)
            # We'll request the actual resolution but cap at 1920 for speed
            dl_w = min(w, 1920)
            dl_h = min(h, int(1920 * h / w)) if w > 1920 else h

            data = download_photo(seed_id, dl_w, dl_h)
            if data is None:
                failures += 1
                if failures > 10:
                    print("    Too many failures, stopping download.")
                    break
                continue

            # Inject EXIF metadata
            data = inject_exif(data, dt, camera)

            self.photos.append({
                "id": i,
                "data": data,
                "dt": dt,
                "camera": camera,
                "ext": ".jpg",
                "w": dl_w,
                "h": dl_h,
            })

            elapsed = time.time() - t0
            sz_mb = sum(len(p["data"]) for p in self.photos) / 1024 / 1024
            if (i + 1) % 10 == 0 or i == count - 1:
                print(f"    {len(self.photos)}/{count} downloaded ({sz_mb:.1f} MB) [{elapsed:.1f}s]", flush=True)

        if failures:
            print(f"    ({failures} downloads failed)")

    def get(self, idx: int) -> dict:
        return self.photos[idx % len(self.photos)]


# ── Source generators ─────────────────────────────────────────────────

def gen_source_camera_sd(pool: DemoPhotoPool, base: str, count: int = 25):
    """Source 1 — Camera SD card (DCIM/100CANON structure)."""
    root = os.path.join(base, "source_camera_sd")
    n = 0
    indices = random.sample(range(len(pool.photos)), min(count, len(pool.photos)))

    for i, idx in enumerate(indices):
        p = pool.get(idx)
        folder = f"DCIM/{100 + i // 10:03d}CANON"
        name = f"IMG_{8000 + i:04d}{p['ext']}"
        write_file(os.path.join(root, folder, name), p["data"])
        n += 1

    # Thumbnails (should be skipped)
    for i in range(5):
        data = make_small_image(160, 120, seed=i + 500)
        write_file(os.path.join(root, "DCIM/.thumbnails", f"thumb_{i:03d}.jpg"), data)

    print(f"  source_camera_sd: {n} photos + 5 thumbnails")
    return indices


def gen_source_downloads(pool: DemoPhotoPool, base: str, shared: List[int], count: int = 20):
    """Source 2 — ~/Downloads with mixed content."""
    root = os.path.join(base, "source_downloads")
    n = 0

    # Some overlap with camera
    overlap = random.sample(shared, min(5, len(shared)))
    remaining = [i for i in range(len(pool.photos)) if i not in set(shared)]
    unique = random.sample(remaining, min(count - len(overlap), len(remaining)))
    indices = overlap + unique

    for i, idx in enumerate(indices):
        p = pool.get(idx)
        styles = [
            f"photo_{random.randint(1000, 9999)}{p['ext']}",
            f"IMG-20{random.randint(19, 24)}{random.randint(10, 12):02d}{random.randint(10, 28):02d}-WA{random.randint(1000, 9999)}{p['ext']}",
            f"download ({random.randint(1, 50)}){p['ext']}",
        ]
        name = random.choice(styles)
        write_file(os.path.join(root, name), p["data"])
        n += 1

    # Small web images (should be skipped)
    for i in range(8):
        data = make_small_image(random.randint(200, 400), random.randint(200, 400), seed=i + 1000)
        write_file(os.path.join(root, f"meme_{i:02d}.jpg"), data)

    write_file(os.path.join(root, "notes.txt"), b"some random text file")
    print(f"  source_downloads: {n} photos + 8 small images")
    return indices


def gen_source_phone_backup(pool: DemoPhotoPool, base: str, shared: List[int], count: int = 20):
    """Source 3 — Phone backup with Camera + WhatsApp."""
    root = os.path.join(base, "source_phone_backup")
    n = 0

    overlap = random.sample(shared, min(4, len(shared)))
    remaining = [i for i in range(len(pool.photos)) if i not in set(shared)]
    unique = random.sample(remaining, min(count - len(overlap) - 4, len(remaining)))
    cam_indices = overlap + unique

    for i, idx in enumerate(cam_indices):
        p = pool.get(idx)
        name = f"IMG_20{p['dt'].strftime('%y%m%d_%H%M%S')}_{i:03d}{p['ext']}"
        write_file(os.path.join(root, "DCIM/Camera", name), p["data"])
        n += 1

    # WhatsApp duplicates
    wa_indices = random.sample(cam_indices[:8], min(4, len(cam_indices)))
    for i, idx in enumerate(wa_indices):
        p = pool.get(idx)
        name = f"IMG-20{p['dt'].strftime('%y%m%d')}-WA{random.randint(1000, 9999)}{p['ext']}"
        write_file(os.path.join(root, "WhatsApp/Media/WhatsApp Images", name), p["data"])
        n += 1

    # Screenshots (small)
    for i in range(6):
        data = make_small_image(390, 844, seed=9000 + i)
        write_file(os.path.join(root, "DCIM/Screenshots", f"Screenshot_{i:03d}.png"), data)

    print(f"  source_phone_backup: {n} photos + 6 screenshots")
    return cam_indices + wa_indices


def gen_source_old_desktop(pool: DemoPhotoPool, base: str, shared: List[int], count: int = 20):
    """Source 4 — Old desktop backup with OS folders + buried photos."""
    root = os.path.join(base, "source_old_desktop")
    n = 0

    # OS/system images (should be skipped)
    system_dirs = {
        "Windows/System32": (32, 32, 10),
        "Program Files/SomeApp/icons": (48, 48, 8),
        "Program Files/Browser/cache": (80, 60, 6),
        "AppData/Local/Temp": (100, 100, 5),
        "AppData/Local/Thumbnails": (120, 90, 6),
    }
    ui_count = 0
    for folder, (w, h, n_items) in system_dirs.items():
        for i in range(n_items):
            data = make_small_image(w, h, seed=hash((folder, i)))
            write_file(os.path.join(root, folder, f"img_{i:03d}.png"), data)
            ui_count += 1

    # Deeply nested real photos
    overlap = random.sample(shared, min(6, len(shared)))
    remaining = [i for i in range(len(pool.photos)) if i not in set(shared)]
    unique = random.sample(remaining, min(count - len(overlap), len(remaining)))
    photo_indices = overlap + unique
    subfolders = ["Vacation 2020", "Family", "Birthday Party", "Camera Uploads"]

    for i, idx in enumerate(photo_indices):
        p = pool.get(idx)
        subfolder = random.choice(subfolders)
        name = f"IMG_{4000 + i:04d}{p['ext']}"
        write_file(os.path.join(root, "Users/John/Pictures", subfolder, name), p["data"])
        n += 1

    print(f"  source_old_desktop: {n} photos + {ui_count} system images")
    return photo_indices


def gen_source_external_hdd(pool: DemoPhotoPool, base: str, shared: List[int], count: int = 20):
    """Source 5 — External HDD dump."""
    root = os.path.join(base, "source_external_hdd")
    n = 0

    overlap = random.sample(shared, min(8, len(shared)))
    remaining = [i for i in range(len(pool.photos)) if i not in set(shared)]
    unique = random.sample(remaining, min(count - len(overlap), len(remaining)))
    photo_indices = overlap + unique

    dirs = ["photos", "backup", "misc/old_photos", "unsorted", "2021", "camera_dump"]
    for i, idx in enumerate(photo_indices):
        p = pool.get(idx)
        d = random.choice(dirs)
        name = f"DSC{random.randint(1000, 9999)}{p['ext']}"
        write_file(os.path.join(root, d, name), p["data"])
        n += 1

    # Edge cases
    edge_dir = os.path.join(root, "edge_cases")
    # Corrupt JPEG
    write_file(os.path.join(edge_dir, "corrupt_photo.jpg"), b"\xff\xd8\xff\xe0" + os.urandom(50000))
    # Zero-byte
    write_file(os.path.join(edge_dir, "empty.jpg"), b"")
    # No EXIF (PNG)
    no_exif = make_small_image(1024, 768, seed=7777)
    write_file(os.path.join(edge_dir, "no_exif_large.png"), no_exif)

    print(f"  source_external_hdd: {n} photos + 3 edge cases")
    return photo_indices


def gen_destination(pool: DemoPhotoPool, all_used: Set[int], base: str):
    """Destination with some pre-existing organized photos."""
    root = os.path.join(base, "destination")
    n = 0
    pre_existing = random.sample(sorted(all_used), min(20, len(all_used)))

    for i, idx in enumerate(pre_existing):
        p = pool.get(idx)
        year = p["dt"].strftime("%Y")
        month = p["dt"].strftime("%m")
        if i % 2 == 0:
            name = f"IMG_{idx:04d}{p['ext']}"
        else:
            name = f"{p['dt'].strftime('%Y-%m-%d_%H%M%S')}{p['ext']}"
        write_file(os.path.join(root, year, month, name), p["data"])
        n += 1

    print(f"  destination: {n} pre-existing photos ({len(pre_existing)} duplicates)")


# ── Main ──────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate demo data with real photos from Lorem Picsum")
    parser.add_argument("--count", type=int, default=DEFAULT_POOL_SIZE,
                        help=f"Number of unique photos to download (default: {DEFAULT_POOL_SIZE})")
    args = parser.parse_args()

    pool_size = args.count
    t0 = time.time()
    print("SnapSort Demo Data Generator (real photos via Lorem Picsum)")
    print(f"Output directory: {BASE_DIR}")

    # Skip if demo data already exists
    manifest_path = os.path.join(BASE_DIR, "manifest.json")
    if os.path.exists(manifest_path):
        print("\nDemo data already exists — skipping download.")
        print("To regenerate, delete the demo_data/ folder first:")
        print(f"  rm -rf {BASE_DIR}")
        sys.exit(0)

    print(f"Downloading {pool_size} photos — this requires an internet connection.\n")

    # Clean previous run
    if os.path.exists(BASE_DIR):
        shutil.rmtree(BASE_DIR)

    # Download photo pool
    print(f"Downloading {pool_size} photos from picsum.photos …")
    pool = DemoPhotoPool()
    pool.download(pool_size)

    if len(pool.photos) < 10:
        print("\n✖ Too few photos downloaded. Check your internet connection.")
        sys.exit(1)

    print(f"\n  Pool ready: {len(pool.photos)} photos\n")

    # Distribute across sources (roughly: 25 + 20 + 20 + 20 + 20 = 105 slots,
    # but with overlap they reuse pool photos — so 80 unique is plenty)
    per_source = max(5, len(pool.photos) // 5)

    all_indices: Set[int] = set()

    print("Creating source datasets:")
    idx1 = gen_source_camera_sd(pool, BASE_DIR, count=per_source)
    all_indices.update(idx1)

    idx2 = gen_source_downloads(pool, BASE_DIR, idx1, count=per_source)
    all_indices.update(idx2)

    idx3 = gen_source_phone_backup(pool, BASE_DIR, idx1 + idx2, count=per_source)
    all_indices.update(idx3)

    idx4 = gen_source_old_desktop(pool, BASE_DIR, list(all_indices), count=per_source)
    all_indices.update(idx4)

    idx5 = gen_source_external_hdd(pool, BASE_DIR, list(all_indices), count=per_source)
    all_indices.update(idx5)

    print("\nCreating destination dataset:")
    gen_destination(pool, all_indices, BASE_DIR)

    elapsed = time.time() - t0

    print(f"\n{'=' * 60}")
    print(f"Demo data generated in {elapsed:.1f}s")
    print(f"Unique photos downloaded: {len(pool.photos)}")
    print(f"Source datasets: 5")
    print(f"  1. source_camera_sd    — Camera DCIM structure")
    print(f"  2. source_downloads    — Messy downloads folder")
    print(f"  3. source_phone_backup — Phone with WhatsApp/Camera")
    print(f"  4. source_old_desktop  — OS drive with buried photos")
    print(f"  5. source_external_hdd — Mixed dump + edge cases")
    print(f"Destination: pre-seeded with duplicates")

    # Write manifest (same format as test_data for compatibility)
    manifest = {
        "generated_at": datetime.now().isoformat(),
        "base_dir": os.path.abspath(BASE_DIR),
        "pool_size": len(pool.photos),
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
            "no_exif_large.png — large PNG with no EXIF",
        ],
        "demo": True,
    }
    manifest_path = os.path.join(BASE_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest written to {manifest_path}")
    print(f"\nRun the demo with:  npm run demo")


if __name__ == "__main__":
    main()
