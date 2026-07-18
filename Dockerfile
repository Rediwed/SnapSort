# ============================================================
# SnapSort — Unified Dockerfile (frontend + backend + Python)
# ============================================================

# ---- Stage 1: Build the React frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Install backend dependencies ----
FROM node:20-alpine AS backend-deps
WORKDIR /build
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

# ---- Stage 3: Final runtime image ----
FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip exiftool

# Python dependencies
WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages Pillow piexif -r requirements.txt

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

# Data directory for SQLite
RUN mkdir -p /app/backend/data \
	&& chown -R node:node /app

VOLUME ["/app/backend/data"]
EXPOSE 4000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q --spider http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "src/index.js"]
