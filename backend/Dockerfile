# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip exiftool

# Install Python deps
WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages Pillow piexif -r requirements.txt

# Copy Python engine
COPY *.py ./
COPY VERSION ./

# Copy backend
WORKDIR /app/backend
COPY --from=build /app/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src

# Data volume for the SQLite database
RUN mkdir -p /app/backend/data
VOLUME ["/app/backend/data"]

EXPOSE 4000
CMD ["node", "src/index.js"]
