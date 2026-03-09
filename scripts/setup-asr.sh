#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ".env"
  set +a
fi

ASR_DIR="${ASR_DIR:-services/asr}"

if [ ! -d "$ASR_DIR" ]; then
  echo "ASR directory not found: $ASR_DIR"
  exit 1
fi

if [ -n "${ASR_PYTHON_BASE:-}" ]; then
  BASE_PY="$ASR_PYTHON_BASE"
elif [ -n "${PYTHON_BASE:-}" ]; then
  BASE_PY="$PYTHON_BASE"
elif command -v python3.12 >/dev/null 2>&1; then
  BASE_PY="python3.12"
elif command -v python3.11 >/dev/null 2>&1; then
  BASE_PY="python3.11"
elif command -v python3.10 >/dev/null 2>&1; then
  BASE_PY="python3.10"
else
  BASE_PY="python3"
fi

VENV_PATH="${ASR_VENV_PATH:-$ASR_DIR/myenv}"

echo "Creating ASR venv at: $VENV_PATH"
"$BASE_PY" --version
"$BASE_PY" -m venv --clear "$VENV_PATH"

echo "Installing Python dependencies from $ASR_DIR/requirements.txt"
"$VENV_PATH/bin/pip" install -r "$ASR_DIR/requirements.txt"

echo "Setup complete."
echo "Optional: set ASR_PYTHON_BIN in .env to pin interpreter:"
echo "ASR_PYTHON_BIN=$ROOT_DIR/$VENV_PATH/bin/python"
echo "Optional: set ASR_PYTHON_BASE in .env to pin the Python version used for ASR setup:"
echo "ASR_PYTHON_BASE=/opt/homebrew/bin/python3.12"
