# ============================================================
# SnapSort — Unified Dockerfile (frontend + backend + Python)
# ============================================================
# Base image is pinned to a major/minor tag. For fully reproducible builds,
# override with a digest, e.g.:
#   docker build --build-arg NODE_IMAGE=node:20-alpine@sha256:<digest> .
ARG NODE_IMAGE=node:20-alpine

# ---- Stage 1: Build the React frontend ----
FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Install backend dependencies ----
FROM ${NODE_IMAGE} AS backend-deps
WORKDIR /build
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: Python dependencies (isolated so pip/setuptools/wheel never reach the runtime) ----
FROM ${NODE_IMAGE} AS py-deps
RUN apk add --no-cache python3 py3-pip
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages --target=/pydeps -r requirements.txt

# ---- Stage 4: Final runtime image ----
FROM ${NODE_IMAGE}

# Patch OS packages (OpenSSL, musl, expat, zlib, busybox, ...) to the latest
# available in the base's Alpine branch, then add only runtime tools. py3-pip is
# intentionally NOT installed at runtime — its packaging tooling (pip/setuptools/
# wheel) is a needless CVE surface.
RUN apk upgrade --no-cache && apk add --no-cache python3 exiftool

# Python site-packages built in the py-deps stage (Pillow musllinux wheels are
# self-contained). Exposed via PYTHONPATH; no build tooling is shipped.
ENV PYTHONPATH=/opt/pydeps
COPY --from=py-deps /pydeps /opt/pydeps

WORKDIR /app

# Python engine files
COPY *.py ./
COPY VERSION ./

# Backend
WORKDIR /app/backend
COPY --from=backend-deps /build/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src

# Built frontend → served as static files by Express
COPY --from=frontend-build /build/dist ./public

# Data directory for SQLite, owned by the non-root runtime user (uid 1000).
# NOTE: a bind-mounted data dir must be writable by uid 1000 (or set matching PUID).
RUN mkdir -p /app/backend/data && chown -R node:node /app

# Drop root privileges for the runtime.
USER node

VOLUME ["/app/backend/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
