# SnapSort - Uncover Forgotten Moments

Organize and extract your personal photos from large, mixed-content drives with ease. This script is robust, efficient, and avoids copying system or application images. Below is a summary of its main features and usage.

---

## Features
### 📅 Date-based Organization
- **Organizes copied images into folders by year, month, and day**  
  Based on the photo's EXIF date or, if missing, the file's modification date.

  ### ⏳ Progress & Logging
- Animated spinner during file list initialization.
- Inline progress indicator during processing, showing:
  - Number of files processed, copied, skipped, errors, and estimated time remaining.
- **Detailed log file** records:
  - Every copied file (with source, destination, and size)
  - Every skipped file (with reason)
  - Errors and summary statistics
  
### 🚩 Supported Image Formats
- `.jpg`, `.jpeg`, `.png`, `.cr2`, `.nef`, `.arw`, `.tif`, `.tiff`, `.rw2`, `.orf`, `.dng`, `.heic`, `.heif`

### 🧠 Smart Filtering
- **Skips system and application folders:**  
  e.g., `windows`, `program files`, `appdata`, `cache`, etc.
- **Skips small images:**  
  To filter out non-photos, such as icons, downloaded images, thumbnails and other irrelevant images. We only want to organize/sort your memories!
  SnapSort defaults to filtering out images less than 600x600 pixels or 50 KB, but allows you to flexibly chose these values.
- **Prefers images with EXIF data** (from cameras or smartphones), but will also include large, high-resolution images without EXIF.
- **EXIF extraction:**  
  Uses `piexif`/Pillow for JPEG/TIFF and falls back to `exiftool` for other formats or when EXIF is missing.

### 🗂️ Duplicate Handling
- **Checks for existing files in the destination folder:**
  - If a file with the same name exists, compares the SHA256 hash of both files.
  - If the files are identical, the new file is skipped.
  - If the files differ, the new file is saved with a timestamp appended to the filename (to keep both versions).

### 🛡️ Robustness
- Handles errors gracefully (e.g., unreadable files, missing EXIF, permission issues).
- Logs all errors for later review.

---

## **New Features**

### 📝 CSV Logging & Config

- **CSV logging** can be enabled for review, manual copy, and resume operations.
- **Config and filtering heuristics are saved in the CSV** as a single cell in the second row, making the CSV robust and spreadsheet-friendly.
- **Automatic config loading:**  
  When running in manual or resume mode, the script reads all config values from the CSV and applies them automatically.
- **Future-proof:**  
  If new config items are added, the script will prompt for any missing values, ensuring compatibility with older CSV /project files.

### 🔄 Three Operation Modes

- **Normal Copy:**  
  Scans and processes all files according to the current heuristics.
- **Manual Copy:**  
  Only copies files explicitly marked in the CSV (`copy_anyway == yes`).  
  Destination paths are reconstructed if missing, using the config from the CSV.
- **Resume Copy:**  
  Continues a previous copy operation by skipping files already listed in the CSV.  
  Reads and applies all config and heuristics from the CSV.

---

## How It Works

1. **Initialization**
   - Scans the source directory for supported image files, showing a spinner while building the file list.
   - Loads config and heuristics from the CSV if running in manual or resume mode.

2. **Processing**
   - For each image:
     - Skips if in a system/app folder or too small.
     - Checks for EXIF data (using `piexif`/Pillow or `exiftool`).
     - If EXIF is missing but the image is large/high-res, still copies it.
     - Determines the destination folder based on the date.
     - Checks for duplicates in the destination:
       - If identical, skips.
       - If different, appends a timestamp to the filename.
     - Copies the file and logs the action.

3. **Summary**
   - Prints and logs a summary of the operation, including counts, total size, errors, and duration.

---

## Customization

- Change filtering heuristics (e.g., minimum size, resolution, or system folders) by editing the constants at the top of the script.
- Add or remove supported image formats by editing the `SUPPORTED_EXTENSIONS` tuple.
- Add new config items to the script and they will be automatically handled in future CSVs.

---

## Requirements

- Python 3.x
- [`Pillow`](https://pypi.org/project/Pillow/)
- [`piexif`](https://pypi.org/project/piexif/)
- [`exiftool`](https://exiftool.org/) (must be installed and in your PATH)

---

## Usage

1. Set the `SOURCE_DIR` and `DEST_DIR` variables at the top of the script, or let the script prompt you.
2. Run the script:
   ```bash
   python3 photo_organizer.py
   ```
3. Choose the desired mode:
   - **Normal copy** (scan and process all)
   - **Manual copy** (copy only files marked in CSV)
   - **Resume copy** (continue where CSV left off)
4. Review the `photo_organizer.log` and `photo_organizer.csv` files for details on copied/skipped files, config, and any errors.

---

## Running Multiple Instances

You can run multiple instances of this script at the same time to process different folders or drives in parallel.  
**However:**

- If multiple instances use the **same destination folder** or **log/CSV files**, you may get duplicate files (with timestamped names) and interleaved log entries.
- For best results, use a **different destination and log/CSV file for each instance**, or split your workload so each instance processes a unique part of your photo collection.
- Directory creation and file copying are safe for concurrent use, but log/CSV files may be harder to read if shared. Future versions of Photo Organizer may handle this more gracefully.

**Tip:**  
If you want to maximize speed, run one instance per source folder or drive, each with its own destination and log files.

---

## Backlog / Planned Future Changes

- **Multi-threaded processing and copying:**  
  Add support for multi-threaded or multi-process file handling to increase speed, especially on fast SSDs or when working with many small files.

- **Command-line argument support for configuration:**  
  Allow users to configure filters, supported image types, and other options directly via command-line arguments (e.g., `photo_organizer.py -s "source" -d "dest" --min-width 800 --min-size 100000`), making the script easier to use in automated workflows.

- **Automatic drive handling and notifications:**  
  Notify the user when a drive is finished, automatically and safely eject the drive, and optionally start processing automatically when a new drive is connected.

- **In-memory destination tree for faster duplicate detection:**  
  Build an in-memory representation of the destination folder/file structure at startup, so the script can quickly check for duplicates before attempting to copy, instead of checking the destination on disk for each source file.

- **Project-level summary and reporting:**  
  Provide a summary and statistics for the entire photo organization project, not just for a single run or task. This could include totals across multiple drives or sessions, and help track overall progress.

- **Analyze-only mode:**  
  Add a fourth operation mode that only analyzes the source and builds the `photo_organizer.csv` file, without copying any files. The user can then manually review and edit the CSV, including the action Photo Organizer would take for each file.

- **Improved script structure and packaging:**  
  Refactor the script to make better use of Python features (such as classes and modules), and package it so it can be imported into other Python projects.  
  Possible use cases:
  - Integrate photo organization into a larger digital asset management workflow.
  - Use the filtering and duplicate detection logic in custom scripts or GUIs.
  - Build automated pipelines for photo backup, deduplication, or cloud upload.

---

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) License. See the [LICENSE](./LICENSE) file for details.

- **Attribution:** If you use or adapt this project, please credit @Rediwed.
- **Non-commercial:** You may not use this project or its derivatives for commercial purposes.

This script is provided as-is, without warranty. For more information, see the LICENSE file.

> **Note:**  
> Log and CSV files are created in the folder where you run the script (your current working directory), not necessarily in the script’s own folder.  
> If you want logs and CSVs to always be saved alongside the script, adjust the script to use absolute paths based on `__file__`.
