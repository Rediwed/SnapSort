# Changelog

All notable changes to SnapSort.

Versioning scheme:
- **X.X.1** — Patches: bug fixes, small UI tweaks, copy changes
- **X.1.X** — Minor: new features, calculation reworks, new settings
- **1.X.X** — Major: complete reworks, breaking data-model changes

## [Unreleased]

- [x] Replace unsafe storage benchmarks with bounded, destination-only, multi-pass measurements.
- [x] Require production authentication and mask stored notification credentials.
- [x] Enforce canonical read-only source roots and atomic, verified photo writes.
- [x] Add output provenance, safe duplicate resolution, exact override counters, and protected cleanup.
- [x] Re-encode previews safely and reject paths outside registered job roots.
- [x] Add restart recovery, retry workflow, scan-only duplicate detection, and bounded inputs.
- [x] Harden ntfy, drive detection, dependencies, Docker, Compose, and Unraid deployment.
- [x] Add backend, frontend, Python, container, and CI validation.

## [1.2.1] - 2026-07-18

### Added
- Initial release.
