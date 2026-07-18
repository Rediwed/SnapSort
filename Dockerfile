# ============================================================
# SnapSort — Unified Dockerfile (frontend + backend + Python)
# ============================================================

# ---- Stage 1: Build the React frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Install backend dependencies ----
FROM node:20-alpine AS backend-deps
WORKDIR /build
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

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
RUN mkdir -p /app/backend/data

VOLUME ["/app/backend/data"]
EXPOSE 4000

CMD ["node", "src/index.js"]
