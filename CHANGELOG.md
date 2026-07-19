# Changelog

All notable changes to SnapSort are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-07-19

Security & reliability hardening pass (audit findings CA-01 … CA-23), plus a Docker image CVE sweep.

### Security
- [x] Remove the benchmark remote-code-execution path: the storage benchmark is now a
  static `bench_engine.py` that reads a validated JSON config from stdin — no request
  field is ever interpolated into source code (CA-01).
- [x] Benchmarks are now source-safe: the engine reads existing source files read-only and
  writes test data only to a randomized scratch directory on the destination, removed in a
  `finally` block (CA-02, CA-08).
- [x] Optional bearer-token auth on all routes except `/api/health`; CORS restricted to an
  explicit allowlist (never `*`); server binds to loopback by default unless a token or
  `SNAPSORT_ALLOW_LAN=true` is set (CA-04).
- [x] Secret settings (`*_password`, `*_token`, `*_api_key`) are masked on read and preserved
  (never overwritten with a sentinel) on write (CA-04).
- [x] Canonical (`realpath`) source-safety checks close symlink/lexical bypasses; the copy
  engine now validates against the configured source **root**, not the file's parent; the
  override route and cross-job destination/source overlap are enforced (CA-03).
- [x] Photo preview rejects symlinks/non-regular files, serves only safe raster formats
  inline, downloads SVG/RAW/unknown types, and sets `X-Content-Type-Options` + CSP (CA-07).
- [x] Drive detection uses `execFileSync` (no shell) so a crafted volume name cannot inject
  a command (CA-15).
- [x] ntfy notifications validate the server URL (http/https only, block link-local/metadata)
  and use a 10 s timeout (CA-14).
- [x] Input validation: bounded benchmark/profile integers, setting key/value guards, photo
  page-size and search-length caps, JSON body size limit (CA-13).
- [x] Container hardening: non-root `USER`, strict `npm ci`, pinned Python deps, healthcheck;
  compose mounts the source read-only, drops capabilities, and pins the correct image tag
  (CA-17, CA-18).

### Reliability
- [x] Atomic copy: write to a temp file, fsync, verify size, `os.replace()`, fsync the
  directory, and clean partials on failure — no more corrupt files on crash/cancel (CA-06).
- [x] Deduplication is race-free: match-and-reserve is a single atomic operation and
  destination paths are reserved under a lock, so concurrent workers can't double-copy (CA-05).
- [x] Duplicate resolution updates the photo row and job counter in one transaction and marks
  overwritten pre-existing files so job cleanup never deletes a file it did not create (CA-11).
- [x] Interrupted `running`/`overriding` jobs are reconciled to `error` at startup; Python
  error messages are propagated (a completed-but-errored job no longer flips to `done`); late
  events after a terminal state are ignored; new `POST /jobs/:id/retry` (CA-09).

### Correctness
- [x] Resolution filter uses OR semantics (a 400×1000 image is filtered by a 600×600 minimum);
  RAW/non-Pillow formats process via metadata/hash fallback instead of erroring (CA-12).
- [x] Scan-only mode indexes source records so source-to-source duplicates are detected with
  an empty destination (CA-10).
- [x] Override job-counter math decrements `skipped` by exactly the previously-skipped photos
  that were copied (CA-23).

### Performance
- [x] Replace per-job `COUNT(*)` (N+1) with a single `DISTINCT job_id` query on the photo and
  duplicate job lists; add composite indexes (CA-16).

### Developer experience
- [x] Add engine + backend test suites, a GitHub Actions CI workflow, and this changelog (CA-20).
- [x] Frontend focus-trap/scroll-lock/ARIA on the shared modal; masked secret fields in
  Settings (CA-21, CA-22).

### Container image / CVE sweep
- [x] `apk upgrade` the runtime OS packages — OpenSSL 3.5.5→3.5.7 (3 critical + 13 high),
  musl 1.2.5-r21→r23, expat 2.7.5→2.8.2, zlib 1.3.1→1.3.2.
- [x] Pillow floor raised to `>=11.3.0`; the container now ships **Pillow 12.3.0** (all
  reported Pillow CVEs fixed) instead of the mistaken `==10.4.0` pin.
- [x] Install Python deps in an isolated builder stage (`pip --target`); the runtime no
  longer ships pip/setuptools/wheel, removing that CVE surface.
- [x] `npm audit fix` on backend production dependencies — 0 advisories remaining.
- Note: Perl, SQLite and BusyBox each carry one CVE with no upstream Alpine fix yet; these
  are OS-level and not reachable through SnapSort's auth-gated, loopback-bound API.
