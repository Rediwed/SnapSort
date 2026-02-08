# SnapSort - Uncover Forgotten Moments

SnapSort helps you organize and extract personal photos from large, mixed-content drives with intelligent filtering and robust processing. It automatically sorts images by date while avoiding system files and application images, making it perfect for recovering memories from old hard drives or organizing large photo collections.

SnapSort is available as both a **Python CLI tool** and a **full-stack web GUI** — run it locally, in Docker, or on Unraid.

![License](https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue)

---

## ✨ Key Features

### 📅 Date-based Photo Organization
SnapSort automatically organizes your images into a clean folder structure based on when they were taken. It reads EXIF data from your photos to determine the actual capture date, falling back to file modification dates when EXIF data isn't available. Your photos are sorted into year/month/day folders, making it easy to find specific memories.

### 🧠 Intelligent Filtering System
The filtering system ensures you only get actual photos, not system icons, application images or thumbnails. It automatically skips system folders and filters out small images that are likely thumbnails or icons. SnapSort defaults to filtering out images less than 600×600 pixels or 50 KB, but allows you to flexibly choose these values. If enabled, SnapSort will save a CSV file that allows you to manually review its decision on a file-by-file basis, letting you force-process images that were misclassified.

**Supported image formats:**
SnapSort supports all image formats — just add the extension to the list before running! Default formats:
- `.jpg`, `.jpeg`, `.png`, `.cr2`, `.nef`, `.arw`, `.tif`, `.tiff`, `.rw2`, `.orf`, `.dng`, `.heic`, `.heif`

For EXIF extraction, it uses `piexif`/Pillow for JPEG/TIFF files and falls back to `exiftool` for other formats.

### 🔍 Deduplication Engine
SnapSort includes a multi-strategy deduplication system:
- **Hash-based**: SHA256 (full or fast partial-hash of first N bytes) to detect exact duplicates
- **Metadata-based**: Compares dimensions, date taken, and file size for near-duplicate detection
- **Configurable thresholds**: Strict threshold (auto-skip) and log threshold (flag for review)
- **Destination seeding**: Pre-indexes existing files in the destination to avoid re-copying

### ⏳ Progress Tracking
Real-time feedback during operation:
- Animated spinner during initialization
- Inline progress showing files processed, copied, skipped, errors, and ETA
- Comprehensive log file recording every action with explanations

### 🌐 Web GUI
A full-stack web interface for managing photo organization visually:

- **Dashboard** — overview stats across all jobs
- **Jobs** — create, start, monitor, and delete organization runs with live progress bars; choose a performance profile per job with a settings summary preview
- **Photos** — browse all processed photos with status filtering (copied/skipped/error), skip reasons, dimensions, date taken
- **Duplicates** — review flagged duplicate pairs
- **Benchmarks** — test real storage I/O on your source & destination folders, identify the bottleneck, and get a recommended performance profile (see below)
- **Settings** — configure filter, quality, performance, and format defaults with responsive grid layout
- **File Picker** — server-side directory browser with external drive detection
- **Test Data** — one-click test dataset loading for development and validation
- **Responsive** — fully responsive layout with a mobile top-down drawer navigation; all pages adapt from desktop to phone

### 📊 Storage Benchmarks & Profile Suggestions
SnapSort can benchmark the actual drives you'll use and recommend the best performance profile:

1. **Select your source and destination folders** using the file picker (with drive detection)
2. **Automated testing** measures sequential read, sequential write, and copy throughput on both volumes, plus single-thread and multi-thread hash speed using `ThreadPoolExecutor`
3. **Bottleneck analysis** identifies whether the source volume, destination volume, or CPU hashing is the limiting factor — shown with a visual bar chart
4. **Profile recommendation** suggests the best built-in profile based on the *slowest storage* in the chain — because the bottleneck sets the pace
5. **One-click apply** writes the recommended profile's settings as your global defaults

Same source/destination path is blocked at both the frontend and backend.

### ⚡ Performance Profiles
SnapSort ships with 7 built-in performance profiles tuned for different storage types:

| Profile | Workers | Batch | Hash KB | Copies | Threading | I/O Mode |
|---------|---------|-------|---------|--------|-----------|----------|
| NVMe Gen4 SSD | 16 | 100 | 16384 | 8 | Multi | Parallel |
| NVMe Gen3 SSD | 12 | 75 | 8192 | 6 | Multi | Parallel |
| SATA SSD | 8 | 50 | 4096 | 4 | Multi | Parallel |
| 7200 RPM HDD | 1 | 10 | 4096 | 1 | Single | Sequential |
| 5400 RPM HDD | 1 | 5 | 2048 | 1 | Single | Sequential |
| USB External | 2 | 15 | 2048 | 1 | Single | Sequential |
| Default | 4 | 25 | 4096 | 2 | Multi | Parallel |

Profiles can be applied globally from Settings, per-job during job creation, or automatically from benchmark results. You can also create custom profiles.

### �️ Source Safety Guarantee
SnapSort will **never** write to, modify, rename, move, or delete any file or directory in your source locations. Source drives and directories are treated as **strictly read-only** at every layer of the application:

- **Python engine**: Every copy operation verifies the destination is not inside the source directory before writing. A `RuntimeError` is raised if violated.
- **Node.js backend**: A dedicated `sourceGuard` module checks every destructive file operation against all known source directories. Job creation is rejected if the source and destination directories overlap in any direction.
- **API layer**: No endpoint exists that can modify or delete source files. The only file operations SnapSort performs on disk are writing to the destination directory and cleaning up its own output.
- **Overlap protection**: Job creation is rejected if source and destination paths overlap in any direction (same directory, destination inside source, or source inside destination). Enforced at the Python engine, Node.js backend, and React frontend.

This is SnapSort's **#1 invariant** — enforced by defense-in-depth across the full stack.

### �🐳 Docker & Unraid Support
SnapSort ships as a unified single container:

- **Multi-stage Dockerfile**: Frontend build → backend dependencies → runtime with Node.js + Python
- **Single service** on port 8080 (configurable)
- **docker-compose.yml** for easy deployment
- **Unraid XML template** for native Docker tab integration with configurable ports, photo share path, and appdata path

---

## 🏗️ Architecture

```
SnapSort/
├── photo_organizer.py        # Python engine (CLI + JSON mode)
├── photo_utils.py             # Image processing, EXIF, copy logic
├── dedup_utils.py             # Deduplication index & matching
├── fast_hash.py               # Optimized partial-file hashing
├── path_utils.py              # Destination path construction
├── logging_utils.py           # CSV/log utilities
├── backend/                   # Node.js Express API
│   └── src/
│       ├── index.js           # Express server (serves API + SPA)
│       ├── sourceGuard.js     # Read-only enforcement for source paths
│       ├── db/                # SQLite schema + DAO (incl. performance_profiles table)
│       ├── routes/            # REST endpoints (jobs, photos, duplicates, benchmarks, profiles, etc.)
│       └── services/          # Python bridge (spawns organizer, streams events)
├── frontend/                  # React 18 + Vite SPA
│   └── src/
│       ├── pages/             # Dashboard, Jobs, Photos, Duplicates, etc.
│       ├── components/        # Modal, DataTable, FilePicker, Badge, StatCard, Sidebar, etc.
│       └── styles/            # Custom CSS dark theme
├── Dockerfile                 # Unified multi-stage build
├── docker-compose.yml         # Single-service deployment
├── unraid/                    # Unraid Docker template
├── generate_test_data.py      # Test dataset generator
└── package.json               # Root dev script (concurrently)
```

**Tech Stack:**
- **Backend**: Node.js, Express 4, better-sqlite3 (WAL mode), uuid, cors
- **Frontend**: React 18, Vite 6, React Router 6, custom CSS dark theme
- **Engine**: Python 3.9+, Pillow, piexif
- **Deployment**: Docker (Alpine-based), Unraid XML template

---

## 🔧 Workflow Management

### 📝 CSV Logging and Configuration
SnapSort generates detailed CSV logs that serve multiple purposes beyond simple record-keeping. These files contain complete configuration information embedded within them, making each log self-contained and portable. Config and filtering heuristics are saved in the CSV as a single cell in the second row, making it robust and spreadsheet-friendly.

When running in manual or resume mode, the script automatically reads all config values from the CSV and applies them, ensuring consistency across sessions.

### 🔄 Operation Modes
SnapSort offers three distinct operation modes:

- **Normal Copy:** Scans and processes all files according to current heuristics
- **Manual Copy:** Only copies files explicitly marked in the CSV (`copy_anyway == yes`), with destination paths reconstructed automatically
- **Resume Copy:** Continues a previous operation by skipping files already listed in the CSV, reading and applying all config and heuristics from the existing file

---

## 🚀 Getting Started

### Quick Start (Docker)
```bash
docker compose up -d
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Quick Start (Development)
```bash
# Install all dependencies
npm install && npm install --prefix backend && npm install --prefix frontend
pip install -r requirements.txt

# Start both backend and frontend
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) — backend runs on port 4000, frontend on 5173 with proxy.

### CLI Usage
```bash
python3 photo_organizer.py
```
Choose your operation mode, set source/destination directories, and let SnapSort organize your photos.

### Test Data
Generate realistic test datasets to validate SnapSort's behavior:
```bash
python3 generate_test_data.py
```
This creates 5 source datasets simulating real scenarios (camera SD, downloads, phone backup, old desktop, external HDD) plus edge cases (corrupt files, zero-byte, wrong extensions, borderline dimensions). Then use the **🧪 Load Test Data** button in the GUI to run them all.

### 📋 Requirements
- Python 3.9+
- [Pillow](https://pypi.org/project/Pillow/)
- [piexif](https://pypi.org/project/piexif/)
- [exiftool](https://exiftool.org/) (optional, fallback for non-JPEG/TIFF EXIF)
- Node.js 18+ (for web GUI)

### Unraid
1. Copy `unraid/snapsort.xml` to `/boot/config/plugins/dockerMan/templates-user/`
2. Go to Docker → Add Container → select SnapSort template
3. Configure your photo share path and port

---

## 🎛️ Customization

- **Filtering heuristics**: Adjust minimum size, resolution, or system folders via the GUI Settings page or by editing constants in `photo_organizer.py`
- **Supported formats**: Add or remove extensions in the `SUPPORTED_EXTENSIONS` tuple
- **Deduplication**: Configure strict/log thresholds and partial hash size
- **Job management**: The GUI supports creating multiple jobs with different source/destination pairs, each with independent filter settings

---

## 🔀 Parallel Processing

You can run multiple instances of SnapSort simultaneously to process different folders or drives in parallel. The web GUI supports running multiple jobs concurrently with independent progress tracking.

**Tips:**
- Use different destination folders for each concurrent source to avoid duplicate naming conflicts
- The GUI's job system handles concurrent runs with separate progress bars and status tracking
- Directory creation and file copying are safe for concurrent use

---

## 🔮 Future Development

- **Improved folder-name awareness:** Retain event/memory grouping when photos span nested folders
- **Project management:** Support multi-drive projects with cross-drive analysis, manual evaluation, and unified reporting
- **Automatic drive handling:** Notifications when drives finish, safe ejection, and auto-start on new drive connection
- **Analyze-only mode:** Build CSV without copying files for manual review

---

## 📄 License and Support

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) License. You're free to use and adapt the project for non-commercial purposes with proper attribution to @Rediwed. See the LICENSE file for complete details.


