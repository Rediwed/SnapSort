#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-}"
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: $0 <patch|minor|major>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash changes first."
  exit 1
fi
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Releases must run from main."
  exit 1
fi

git pull --ff-only
npm test
npm audit
npm audit --prefix backend
npm audit --prefix frontend
docker build -t snapsort-release-check .

CURRENT_VERSION="$(cat VERSION)"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TODAY="$(date +%Y-%m-%d)"

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md has no [Unreleased] section."
  exit 1
fi
UNRELEASED_BODY="$(awk '
  /^## \[Unreleased\]/ {active=1; next}
  active && /^## \[/ {exit}
  active {print}
' CHANGELOG.md)"
if ! printf '%s\n' "$UNRELEASED_BODY" | grep -qE '^[[:space:]]*-[[:space:]]+\[[xX]\]'; then
  echo "No public - [x] release notes under [Unreleased]."
  exit 1
fi

for directory in . backend frontend; do
  npm --prefix "$directory" version --no-git-tag-version "$NEW_VERSION" >/dev/null
done
printf '%s\n' "$NEW_VERSION" > VERSION

awk -v version="$NEW_VERSION" -v today="$TODAY" '
  BEGIN { state = "before" }
  state == "before" && /^## \[Unreleased\]/ {
    print "## [Unreleased]"
    print ""
    print "## [" version "] - " today
    state = "unreleased"
    next
  }
  state == "unreleased" && /^## \[/ { state = "after"; print; next }
  state == "unreleased" {
    if ($0 ~ /^[[:space:]]*-[[:space:]]+\[[[:space:]]\]/) next
    sub(/-[[:space:]]+\[[xX]\][[:space:]]+/, "- ")
    print
    next
  }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md

git add VERSION package.json package-lock.json backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json CHANGELOG.md
git commit -m "release: v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push
git push --tags
./deploy.sh "$NEW_VERSION"
/Users/dewicadat/dev/homelab/scripts/notify.sh "Released SnapSort v$NEW_VERSION" || true

echo "Released SnapSort v$NEW_VERSION"