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

VOICE_CLONE_DIR="${VOICE_CLONE_DIR:-services/tts}"

if [ ! -d "$VOICE_CLONE_DIR" ]; then
  echo "TTS directory not found: $VOICE_CLONE_DIR"
  exit 1
fi

if [ -n "${PYTHON_BASE:-}" ]; then
  BASE_PY="$PYTHON_BASE"
elif command -v python3.10 >/dev/null 2>&1; then
  BASE_PY="python3.10"
else
  BASE_PY="python3"
fi

VENV_PATH="${VENV_PATH:-$VOICE_CLONE_DIR/myenv}"

echo "Creating venv at: $VENV_PATH"
"$BASE_PY" -m venv "$VENV_PATH"

echo "Installing Python dependencies from $VOICE_CLONE_DIR/requirements.txt"
"$VENV_PATH/bin/pip" install -r "$VOICE_CLONE_DIR/requirements.txt"

echo "Setup complete."
echo "Optional: set PYTHON_BIN in .env to pin interpreter:"
echo "PYTHON_BIN=$ROOT_DIR/$VENV_PATH/bin/python"
