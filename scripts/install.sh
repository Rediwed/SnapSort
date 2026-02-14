#!/usr/bin/env bash
# SnapSort Installer
# Usage: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Rediwed/SnapSort/main/scripts/install.sh)"
set -euo pipefail

# ── Colours & helpers ───────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✔${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail()  { printf "${RED}✖ %s${NC}\n" "$1"; exit 1; }

# ── Detect OS & package manager ─────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

detect_pkg_manager() {
  if [[ "$OS" == "Darwin" ]]; then
    echo "brew"
  elif command -v apt-get &>/dev/null; then
    echo "apt"
  elif command -v dnf &>/dev/null; then
    echo "dnf"
  elif command -v yum &>/dev/null; then
    echo "yum"
  elif command -v pacman &>/dev/null; then
    echo "pacman"
  else
    echo "unknown"
  fi
}

PKG_MANAGER="$(detect_pkg_manager)"

# ── Helpers: install packages automatically ─────────────────
need_sudo() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "sudo"
  else
    echo ""
  fi
}

install_homebrew() {
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [[ "$ARCH" == "arm64" ]] && [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
}

install_with_pkg_manager() {
  local pkg="$1"
  local SUDO
  SUDO="$(need_sudo)"

  case "$PKG_MANAGER" in
    brew)
      brew install "$pkg"
      ;;
    apt)
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq "$pkg"
      ;;
    dnf)
      $SUDO dnf install -y -q "$pkg"
      ;;
    yum)
      $SUDO yum install -y -q "$pkg"
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm "$pkg"
      ;;
    *)
      return 1
      ;;
  esac
}

install_docker_desktop_mac() {
  info "Installing Docker Desktop for macOS..."
  if [[ "$ARCH" == "arm64" ]]; then
    local DMG_URL="https://desktop.docker.com/mac/main/arm64/Docker.dmg"
  else
    local DMG_URL="https://desktop.docker.com/mac/main/amd64/Docker.dmg"
  fi
  local TMP_DMG
  TMP_DMG="$(mktemp /tmp/Docker.XXXXXX.dmg)"
  curl -fsSL -o "$TMP_DMG" "$DMG_URL"
  hdiutil attach "$TMP_DMG" -quiet
  cp -R "/Volumes/Docker/Docker.app" /Applications/ 2>/dev/null || true
  hdiutil detach "/Volumes/Docker" -quiet 2>/dev/null || true
  rm -f "$TMP_DMG"
  info "Starting Docker Desktop (this may take a moment)..."
  open /Applications/Docker.app
  # Wait for Docker daemon to be ready (up to 120s)
  local tries=0
  while ! docker info &>/dev/null && [ $tries -lt 60 ]; do
    sleep 2
    tries=$((tries + 1))
  done
  if ! docker info &>/dev/null; then
    fail "Docker Desktop installed but the daemon didn't start in time.\n  Open Docker Desktop manually and re-run this installer."
  fi
  ok "Docker Desktop installed and running"
}

install_docker_linux() {
  info "Installing Docker Engine via official install script..."
  curl -fsSL https://get.docker.com | sh
  local SUDO
  SUDO="$(need_sudo)"
  # Start Docker and enable on boot
  $SUDO systemctl start docker 2>/dev/null || $SUDO service docker start 2>/dev/null || true
  $SUDO systemctl enable docker 2>/dev/null || true
  # Add current user to docker group so we don't need sudo
  if [ "$(id -u)" -ne 0 ]; then
    $SUDO usermod -aG docker "$USER" 2>/dev/null || true
    warn "Added $USER to the docker group — you may need to log out and back in for this to take effect."
  fi
  ok "Docker Engine installed"
}

# ── Banner ──────────────────────────────────────────────────
printf "\n${BOLD}"
cat << 'EOF'
  ____                   ____             _
 / ___| _ __   __ _ _ __/ ___|  ___  _ __| |_
 \___ \| '_ \ / _` | '_ \___ \ / _ \| '__| __|
  ___) | | | | (_| | |_) |__) | (_) | |  | |_
 |____/|_| |_|\__,_| .__/____/ \___/|_|   \__|
                    |_|
EOF
printf "${NC}\n"
info "SnapSort Installer — full-stack web GUI + Python engine"
printf "\n"

# ── Check & install: curl ───────────────────────────────────
if ! command -v curl &>/dev/null; then
  info "Installing curl..."
  install_with_pkg_manager curl || fail "Could not install curl. Please install it manually."
fi

# ── Check & install: Git ────────────────────────────────────
if ! command -v git &>/dev/null; then
  info "Git is not installed — installing it now..."
  if [[ "$OS" == "Darwin" ]]; then
    # On macOS, trigger Xcode CLT install which includes git
    if ! xcode-select -p &>/dev/null; then
      info "Installing Xcode Command Line Tools (includes Git)..."
      xcode-select --install 2>/dev/null || true
      # Wait for the install to finish
      info "Waiting for Xcode CLT installation to complete..."
      until xcode-select -p &>/dev/null; do sleep 5; done
    fi
  else
    install_with_pkg_manager git || fail "Could not install Git automatically.\n  Install it manually: https://git-scm.com"
  fi
fi
ok "Git found"

# ── Check & install: Docker ─────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Docker is not installed — installing it now..."
  if [[ "$OS" == "Darwin" ]]; then
    install_docker_desktop_mac
  elif [[ "$OS" == "Linux" ]]; then
    install_docker_linux
  else
    fail "Automatic Docker install is not supported on $OS.\n  Install Docker Desktop: https://docker.com/products/docker-desktop\n  Then re-run this installer."
  fi
fi
ok "Docker found ($(docker --version | head -1))"

# ── Check: Docker Compose ──────────────────────────────────
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  # Try to install compose plugin
  if [[ "$OS" == "Linux" ]]; then
    info "Installing Docker Compose plugin..."
    SUDO="$(need_sudo)"
    $SUDO apt-get install -y -qq docker-compose-plugin 2>/dev/null \
      || $SUDO dnf install -y -q docker-compose-plugin 2>/dev/null \
      || $SUDO yum install -y -q docker-compose-plugin 2>/dev/null \
      || true
    if docker compose version &>/dev/null; then
      COMPOSE="docker compose"
    else
      fail "Could not install Docker Compose.\n  See: https://docs.docker.com/compose/install/"
    fi
  else
    fail "Docker Compose is not available.\n  Docker Desktop includes it by default — make sure to install Docker Desktop."
  fi
fi
ok "Docker Compose found"

# ── Check: Docker daemon running ────────────────────────────
if ! docker info &>/dev/null; then
  if [[ "$OS" == "Darwin" ]]; then
    info "Starting Docker Desktop..."
    open /Applications/Docker.app 2>/dev/null || true
    tries=0
    while ! docker info &>/dev/null && [ $tries -lt 60 ]; do
      sleep 2
      tries=$((tries + 1))
    done
  elif [[ "$OS" == "Linux" ]]; then
    info "Starting Docker daemon..."
    $(need_sudo) systemctl start docker 2>/dev/null || $(need_sudo) service docker start 2>/dev/null || true
    sleep 3
  fi
  if ! docker info &>/dev/null; then
    fail "Docker daemon is not running. Please start Docker and try again."
  fi
fi
ok "Docker daemon is running"

# ── Install directory ───────────────────────────────────────
INSTALL_DIR="${SNAPSORT_DIR:-$HOME/SnapSort}"

if [ -d "$INSTALL_DIR" ]; then
  warn "Directory already exists: $INSTALL_DIR"
  info "Pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull --ff-only || warn "Could not fast-forward — using existing code"
else
  info "Cloning SnapSort into $INSTALL_DIR..."
  git clone https://github.com/Rediwed/SnapSort.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Source code ready"

# ── Photo path configuration ───────────────────────────────
printf "\n"
info "Where are the photos you want to organize?"
info "This path will be mounted into the container at /mnt/photos."
printf "${BOLD}  Photo folder path${NC} [default: $HOME/Pictures]: "
read -r PHOTO_PATH
PHOTO_PATH="${PHOTO_PATH:-$HOME/Pictures}"

# Expand ~ if typed literally
PHOTO_PATH="${PHOTO_PATH/#\~/$HOME}"

if [ ! -d "$PHOTO_PATH" ]; then
  warn "Directory does not exist yet: $PHOTO_PATH"
  printf "  Create it? [Y/n]: "
  read -r CREATE_DIR
  CREATE_DIR="${CREATE_DIR:-Y}"
  if [[ "$CREATE_DIR" =~ ^[Yy] ]]; then
    mkdir -p "$PHOTO_PATH"
    ok "Created $PHOTO_PATH"
  else
    warn "Continuing anyway — you can update docker-compose.yml later"
  fi
fi

# ── Port configuration ─────────────────────────────────────
printf "${BOLD}  Web UI port${NC} [default: 8080]: "
read -r PORT
PORT="${PORT:-8080}"

# ── Write docker-compose.override.yml ───────────────────────
cat > "$INSTALL_DIR/docker-compose.override.yml" << YAML
# Generated by SnapSort installer — $(date +%Y-%m-%d)
# Edit this file to change your photo path or port.
# This file is .gitignored and won't be overwritten by updates.
version: "3.9"

services:
  snapsort:
    ports:
      - "${PORT}:4000"
    volumes:
      - db-data:/app/backend/data
      - ${PHOTO_PATH}:/mnt/photos
YAML

ok "Configuration saved to docker-compose.override.yml"

# ── Build & start ───────────────────────────────────────────
printf "\n"
info "Building and starting SnapSort (this may take a few minutes on first run)..."
$COMPOSE up -d --build

# ── Done ────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}${BOLD}══════════════════════════════════════════${NC}\n"
printf "${GREEN}${BOLD}  SnapSort is running!${NC}\n"
printf "${GREEN}${BOLD}══════════════════════════════════════════${NC}\n"
printf "\n"
info "Web UI:      ${BOLD}http://localhost:${PORT}${NC}"
info "Photo path:  ${BOLD}${PHOTO_PATH}${NC}"
info "Install dir: ${BOLD}${INSTALL_DIR}${NC}"
printf "\n"
info "Useful commands:"
printf "  ${CYAN}cd %s${NC}\n" "$INSTALL_DIR"
printf "  ${CYAN}$COMPOSE logs -f${NC}        — follow logs\n"
printf "  ${CYAN}$COMPOSE down${NC}           — stop SnapSort\n"
printf "  ${CYAN}$COMPOSE up -d${NC}          — start SnapSort\n"
printf "  ${CYAN}$COMPOSE up -d --build${NC}  — rebuild after updates\n"
printf "\n"
