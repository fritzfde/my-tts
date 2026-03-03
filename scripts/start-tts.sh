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
TTS_SERVER="${TTS_SERVER:-$VOICE_CLONE_DIR/tts_server.py}"

if [ ! -f "$TTS_SERVER" ]; then
  echo "TTS server not found at: $TTS_SERVER"
  exit 1
fi

if [ -n "${PYTHON_BIN:-}" ]; then
  if [ ! -x "$PYTHON_BIN" ]; then
    echo "Configured PYTHON_BIN is not executable: $PYTHON_BIN"
    exit 1
  fi
  PY_BIN="$PYTHON_BIN"
elif [ -x "$VOICE_CLONE_DIR/myenv/bin/python" ]; then
  PY_BIN="$VOICE_CLONE_DIR/myenv/bin/python"
elif [ -x "$VOICE_CLONE_DIR/.venv/bin/python" ]; then
  PY_BIN="$VOICE_CLONE_DIR/.venv/bin/python"
elif [ -x "$VOICE_CLONE_DIR/venv/bin/python" ]; then
  PY_BIN="$VOICE_CLONE_DIR/venv/bin/python"
else
  PY_BIN="python3"
fi

if ! "$PY_BIN" -c "import flask" >/dev/null 2>&1; then
  echo "Python interpreter '$PY_BIN' is missing Flask."
  echo "Run: npm run setup:tts"
  exit 1
fi

echo "Starting Python TTS server: $PY_BIN $TTS_SERVER"
exec "$PY_BIN" "$TTS_SERVER"
