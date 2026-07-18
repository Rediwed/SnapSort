#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-$(cat VERSION)}"
REGISTRY="${SNAPSORT_REGISTRY:-rediwed}"
IMAGE="${SNAPSORT_IMAGE:-snapsort}"
FULL_IMAGE="${REGISTRY}/${IMAGE}"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "${FULL_IMAGE}:${VERSION}" \
  --tag "${FULL_IMAGE}:latest" \
  --push .

echo "Published ${FULL_IMAGE}:${VERSION} and ${FULL_IMAGE}:latest"