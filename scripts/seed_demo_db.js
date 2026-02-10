#!/usr/bin/env node
/**
 * seed_demo_db.js — Pre-populate the SnapSort database with realistic
 * completed jobs, photo records, and duplicate entries so the Dashboard,
 * Photos, and Duplicates pages look populated in screenshots.
 *
 * Usage:  node scripts/seed_demo_db.js
 *   (also invoked automatically by `npm run demo`)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initDb } = require('../backend/src/db/schema');
const uuidv4 = () => crypto.randomUUID();

const DB_PATH = path.join(__dirname, '..', 'backend', 'data', 'snapsort.db');

/* ── Helpers ─────────────────────────────────────────────────────── */

function randomDate(startYear, endYear) {
  const y = startYear + Math.floor(Math.random() * (endYear - startYear + 1));
  const m = Math.floor(Math.random() * 12) + 1;
  const d = Math.floor(Math.random() * 28) + 1;
  const h = Math.floor(Math.random() * 24);
  const min = Math.floor(Math.random() * 60);
  const s = Math.floor(Math.random() * 60);
  return new Date(y, m - 1, d, h, min, s).toISOString();
}

function randomEl(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Recursively collect image files (jpg/jpeg/png) under a directory. */
function collectImages(dir) {
  const images = [];
  const validExts = new Set(['.jpg', '.jpeg', '.png']);
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // skip dotfiles/thumbnails
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (validExts.has(path.extname(entry.name).toLowerCase())) {
        try {
          const st = fs.statSync(full);
          if (st.size > 0) images.push(full);
        } catch { /* skip */ }
      }
    }
  }
  walk(dir);
  return images;
}

/* ── Main ────────────────────────────────────────────────────────── */

function seed() {
  console.log('Seeding demo data into database…');
  const db = initDb(DB_PATH);

  /* Check if demo data already seeded */
  const existing = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE source_dir LIKE '%demo_seed%' OR source_dir LIKE '%demo_data%'").get();
  if (existing.c > 0) {
    console.log('Demo data already present — skipping seed.');
    db.close();
    return;
  }

  const sources = [
    '/mnt/photos/Camera SD Card',
    '/mnt/photos/Downloads',
    '/mnt/photos/Phone Backup',
    '/mnt/photos/Old Desktop',
    '/mnt/photos/External HDD',
  ];

  const dest = '/mnt/organized/Photos';
  const extensions = ['.jpg', '.jpeg', '.png', '.cr2', '.nef', '.heic'];
  const cameras = ['Canon EOS R5', 'Nikon Z6 II', 'Sony A7 IV', 'iPhone 14 Pro', 'Samsung Galaxy S23', 'Google Pixel 8'];
  const resolutions = [[4032, 3024], [3840, 2160], [3024, 4032], [2048, 1536], [1920, 1080], [1080, 1920]];

  /* Build pools of real image files so photo records point to actual files */
  const demoDataDir = path.join(__dirname, '..', 'demo_data');
  const destImages = collectImages(path.join(demoDataDir, 'destination'));
  const sourceImagePools = [
    collectImages(path.join(demoDataDir, 'source_camera_sd')),
    collectImages(path.join(demoDataDir, 'source_downloads')),
    collectImages(path.join(demoDataDir, 'source_phone_backup')),
    collectImages(path.join(demoDataDir, 'source_old_desktop')),
    collectImages(path.join(demoDataDir, 'source_external_hdd')),
  ];
  /* Combined fallback pool for jobs whose source pool is empty */
  const allSourceImages = sourceImagePools.flat();
  console.log(`  Image pools — dest: ${destImages.length}, sources: ${sourceImagePools.map((p) => p.length).join(', ')}, total: ${destImages.length + allSourceImages.length}`);

  const insertJob = db.prepare(`
    INSERT INTO jobs (id, source_dir, dest_dir, status, mode, performance_profile, total_files, processed, copied, skipped, errors, total_bytes, created_at, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPhoto = db.prepare(`
    INSERT INTO photos (id, job_id, src_path, dest_path, filename, extension, file_size, width, height, date_taken, status, skip_reason, hash, dpi, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDup = db.prepare(`
    INSERT INTO duplicates (id, job_id, photo_id, matched_photo_id, src_path, matched_path, similarity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    /*
     * Job layout:
     *   j=0  Camera SD Card   → done    (usb_external — SD reader)
     *   j=1  Downloads        → done    (nvme_gen3 — internal SSD)
     *   j=2  Phone Backup     → error   (usb_external — USB tether)
     *   j=3  Old Desktop      → pending (hdd_5400rpm — old drive, ready to start)
     *   j=4  External HDD     → pending (hdd_7200rpm — real demo_data path)
     */
    const jobProfiles = ['usb_external', 'nvme_gen3', 'usb_external', 'hdd_5400rpm'];
    const jobStatuses = ['done', 'done', 'error', 'pending'];

    const demoDestDir = fs.existsSync(path.join(demoDataDir, 'destination'))
      ? path.resolve(demoDataDir, 'destination')
      : dest;

    /* Map source folder names to real demo_data paths for pending jobs */
    const demoSourceMap = {
      3: 'source_old_desktop',
    };

    for (let j = 0; j < 4; j++) {
      const jobId = uuidv4();
      const profile = jobProfiles[j];
      const isPending = jobStatuses[j] === 'pending';
      const isPartial = jobStatuses[j] === 'error';

      /* Use real demo_data path for pending jobs, cosmetic path for historical ones */
      let src;
      if (isPending && demoSourceMap[j] && fs.existsSync(path.join(demoDataDir, demoSourceMap[j]))) {
        src = path.resolve(demoDataDir, demoSourceMap[j]);
      } else {
        src = sources[j] + ' (demo_seed)';
      }

      if (isPending) {
        /* Pending job — no processing yet, just a ready-to-start entry */
        insertJob.run(jobId, src, demoDestDir, 'pending', 'normal', profile, 0, 0, 0, 0, 0, 0, new Date().toISOString(), null, null);
        continue;
      }

      const total = randomInt(80, 200);
      const processedRatio = isPartial ? (0.3 + Math.random() * 0.35) : 1;
      const processed = isPartial ? Math.floor(total * processedRatio) : total;
      const copied = Math.floor(processed * (0.4 + Math.random() * 0.3));
      const skipped = processed - copied - randomInt(0, 3);
      const errors = Math.max(0, processed - copied - Math.max(0, skipped));
      const totalBytes = copied * randomInt(800000, 3500000);
      const created = randomDate(2024, 2025);
      const started = new Date(new Date(created).getTime() + 1000).toISOString();
      const finished = isPartial
        ? new Date(new Date(started).getTime() + randomInt(8000, 45000)).toISOString()
        : new Date(new Date(started).getTime() + randomInt(15000, 120000)).toISOString();
      const jobStatus = jobStatuses[j];
      const errorMsg = isPartial ? 'Job interrupted — connection lost' : null;

      insertJob.run(jobId, src, dest, jobStatus, 'normal', profile, total, processed, copied, Math.max(0, skipped), errors, totalBytes, created, started, finished);

      /* Update error message for partial jobs */
      if (errorMsg) {
        db.prepare('UPDATE jobs SET error_message = ? WHERE id = ?').run(errorMsg, jobId);
      }

      /* Insert photo records for this job (only for processed files) */
      const photoIds = [];
      const photoMeta = []; // keep metadata for realistic duplicate generation
      const srcPool = sourceImagePools[j] && sourceImagePools[j].length > 0 ? sourceImagePools[j] : allSourceImages;

      for (let p = 0; p < processed; p++) {
        const photoId = uuidv4();
        photoIds.push(photoId);
        const [w, h] = randomEl(resolutions);
        const dateTaken = randomDate(2019, 2025);

        /*
         * Pick a real image file so that the preview endpoint can serve it.
         * "copied" photos get a real dest_path from the destination pool;
         * all photos get a real src_path from the source pool for that job.
         */
        const realSrc = srcPool[p % srcPool.length];
        const realSrcSize = fs.statSync(realSrc).size;
        const filename = path.basename(realSrc);
        const ext = path.extname(realSrc);
        const srcPath = realSrc;
        const fileSize = realSrcSize;

        let status, skipReason, destPath;
        if (p < copied) {
          status = 'copied';
          skipReason = null;
          /* Point to a real destination file */
          const realDest = destImages[p % destImages.length];
          destPath = realDest;
        } else if (p < copied + skipped) {
          status = 'skipped';
          skipReason = randomEl(['below min dimensions', 'system folder', 'below min filesize', 'duplicate (hash match)']);
          destPath = null;
        } else {
          status = 'error';
          skipReason = 'cannot open image';
          destPath = null;
        }

        const hash = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const dpi = randomEl([72, 96, 150, 300, null]);

        insertPhoto.run(photoId, jobId, srcPath, destPath, filename, ext, fileSize, w, h, dateTaken, status, skipReason, hash, dpi, finished);
        photoMeta.push({ photoId, filename, ext, w, h, dateTaken, fileSize, dpi, srcPath, destPath });
      }

      /*
       * Insert duplicate records (~10% of photos).
       * For each pair, create a "matched" photo whose attributes are
       * derived from the source photo so the similarity score is
       * consistent with what the UI shows side-by-side.
       *
       * Similarity is computed the same way as the Python engine:
       *   filename: 10%, size: 20%, resolution: 15%, date_taken: 5%,
       *   partial_hash: 45%, mtime: 5%.
       * Demo data can't match on partial_hash or mtime, so a
       * near-perfect match on all other attributes gives ~50%.
       * To get realistic 80-99% scores we re-use or slightly vary
       * each attribute per pair.
       */
      const dupCount = Math.floor(total * 0.1);
      for (let d = 0; d < dupCount && d < photoIds.length; d++) {
        const src = photoMeta[d];

        /* Decide how close this duplicate should be */
        const tier = Math.random();

        /* -- Filename: same base name, optionally with suffix ---------- */
        let matchFilename;
        const baseName = src.filename.replace(/\.[^.]+$/, '');
        if (tier > 0.4) {
          // Very similar name (copy suffix)
          matchFilename = `${baseName}_copy${src.ext}`;
        } else {
          // Identical filename (different folder)
          matchFilename = src.filename;
        }

        /* -- File size: identical or within 1% ------------------------ */
        let matchSize;
        if (tier > 0.6) {
          matchSize = src.fileSize; // exact
        } else {
          // within 0.5%
          const drift = Math.round(src.fileSize * (Math.random() * 0.005));
          matchSize = src.fileSize + (Math.random() > 0.5 ? drift : -drift);
        }

        /* -- Resolution: same or very close --------------------------- */
        let matchW, matchH;
        if (tier > 0.3) {
          matchW = src.w;
          matchH = src.h;
        } else {
          // Differ by a few pixels
          matchW = src.w + randomEl([-2, -1, 0, 1, 2]);
          matchH = src.h + randomEl([-2, -1, 0, 1, 2]);
        }

        /* -- Date taken: same or within a few seconds ----------------- */
        let matchDate;
        if (tier > 0.5) {
          matchDate = src.dateTaken; // exact
        } else {
          const offsetSec = randomInt(0, 120);
          matchDate = new Date(new Date(src.dateTaken).getTime() + offsetSec * 1000).toISOString();
        }

        /* -- DPI: same ------------------------------------------------ */
        const matchDpi = src.dpi;

        /* -- Hash: random (we can't fake partial-hash match) ---------- */
        const matchHash = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

        /* Insert the matched photo record — point to real files */
        const matchPhotoId = uuidv4();
        /* Pick a different real source file for the matched photo */
        const matchRealSrc = srcPool[(d + Math.floor(srcPool.length / 2)) % srcPool.length];
        const matchSrcPath = matchRealSrc;
        /* Pick a real dest file for preview */
        const matchRealDest = destImages[(d + Math.floor(destImages.length / 2)) % destImages.length];
        const matchDestPath = matchRealDest;

        insertPhoto.run(matchPhotoId, jobId, matchSrcPath, matchDestPath, matchFilename, src.ext, matchSize, matchW, matchH, matchDate, 'skipped', 'duplicate (hash match)', matchHash, matchDpi, finished);

        /* --- Compute similarity the same way as the Python engine ---- */
        let similarity = 0;

        // Size (20 pts): exact ⇒ 20, within 1% ⇒ proportional
        if (matchSize === src.fileSize) {
          similarity += 20;
        } else {
          const relDiff = Math.abs(matchSize - src.fileSize) / Math.max(matchSize, src.fileSize);
          if (relDiff < 0.01) similarity += 20 * (1 - relDiff / 0.01);
        }

        // Resolution (15 pts): exact ⇒ 15, within 5% area ⇒ proportional
        if (matchW === src.w && matchH === src.h) {
          similarity += 15;
        } else {
          const areaL = src.w * src.h;
          const areaR = matchW * matchH;
          const areaDiff = Math.abs(areaL - areaR) / Math.max(areaL, areaR);
          if (areaDiff < 0.05) similarity += 15 * (1 - areaDiff / 0.05);
        }

        // Filename (10 pts): SequenceMatcher ratio approximation
        const shorter = Math.min(matchFilename.length, src.filename.length);
        const longer = Math.max(matchFilename.length, src.filename.length);
        // Simple length-based ratio (close enough for demo purposes)
        let nameRatio;
        if (matchFilename.toLowerCase() === src.filename.toLowerCase()) {
          nameRatio = 1.0;
        } else {
          // Count matching prefix chars
          let match = 0;
          const a = src.filename.toLowerCase(), b = matchFilename.toLowerCase();
          for (let i = 0; i < Math.min(a.length, b.length); i++) {
            if (a[i] === b[i]) match++;
          }
          nameRatio = (2 * match) / (a.length + b.length);
        }
        similarity += 10 * nameRatio;

        // Date taken (5 pts): exact ⇒ 5, within 5 min ⇒ proportional
        const secDiff = Math.abs(new Date(src.dateTaken).getTime() - new Date(matchDate).getTime()) / 1000;
        if (secDiff === 0) {
          similarity += 5;
        } else if (secDiff < 300) {
          similarity += 5 * (1 - secDiff / 300);
        }

        // partial_hash (45 pts) and mtime (5 pts) won't match in demo data.
        // That's fine — realistic demo scores will be ~35-50 (attribute-only).
        // But that looks too low for a demo, so we give a bonus to simulate
        // that real files would share hashes.  Boost to 80–99 range.
        similarity += 45 * (0.7 + Math.random() * 0.3); // simulated hash affinity

        similarity = +Math.min(similarity, 99.9).toFixed(1);

        insertDup.run(
          uuidv4(), jobId, src.photoId, matchPhotoId,
          src.srcPath,
          matchDestPath || matchSrcPath,
          similarity
        );
      }
    }

    /* External HDD — pending job pointed at real demo_data so it can be started */
    const pendingSource = fs.existsSync(path.join(demoDataDir, 'source_external_hdd'))
      ? path.resolve(demoDataDir, 'source_external_hdd')
      : sources[4] + ' (demo_seed)';
    const pendingId = uuidv4();
    insertJob.run(pendingId, pendingSource, demoDestDir, 'pending', 'normal', 'hdd_7200rpm', 0, 0, 0, 0, 0, 0, new Date().toISOString(), null, null);
  });

  tx();

  const stats = db.prepare('SELECT COUNT(*) AS jobs FROM jobs').get();
  const photos = db.prepare('SELECT COUNT(*) AS photos FROM photos').get();
  const dups = db.prepare('SELECT COUNT(*) AS dups FROM duplicates').get();

  console.log(`  Jobs:       ${stats.jobs}`);
  console.log(`  Photos:     ${photos.photos}`);
  console.log(`  Duplicates: ${dups.dups}`);
  console.log('Demo database seeded successfully.');

  db.close();
}

seed();
