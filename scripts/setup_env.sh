#!/usr/bin/env bash
# Helper script to create a virtual environment and install dependencies
set -euo pipefail

VENV_NAME=".venv"
PYTHON="python3"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "$PYTHON not found. Please install Python 3.8+ first."
  exit 1
fi

# Create venv
$PYTHON -m venv "$VENV_NAME"

# Activate and install
# shellcheck source=/dev/null
source "$VENV_NAME/bin/activate"
python -m pip install --upgrade pip
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
else
  echo "No requirements.txt found."
fi

echo "Virtual environment created in $VENV_NAME and dependencies installed. Activate with: source $VENV_NAME/bin/activate"
