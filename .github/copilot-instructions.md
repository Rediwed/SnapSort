# Copilot Instructions

## Workflow

- **Do not run `npx vite build`** (or similar build commands) just to verify edits. Use the editor's built-in error checking instead. Only run builds when explicitly asked or when a build artifact is actually needed.
- Work on `feat/`, `fix/`, `chore/`, `docs/`, or `perf/` branches; do not commit feature work directly to `main`.
- Add a checked `- [x]` bullet under `CHANGELOG.md` → `## [Unreleased]` for every user-visible change.
- Keep `VERSION`, root/backend/frontend package versions, and lockfiles synchronized through `scripts/release.sh`; never bump them manually.
- Release only from clean `main` using `./scripts/release.sh patch|minor|major`.
