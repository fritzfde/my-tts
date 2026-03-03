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
TTS_PORT="${TTS_PORT:-5000}"

if [ ! -f "$TTS_SERVER" ]; then
  echo "TTS server not found at: $TTS_SERVER"
  echo "Set VOICE_CLONE_DIR or TTS_SERVER, for example:"
  echo "VOICE_CLONE_DIR=services/tts npm run start:all"
  exit 1
fi

# Pick Python interpreter
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
  echo "Use a TTS virtualenv, for example:"
  echo "npm run setup:tts"
  echo "Or install dependencies from: $VOICE_CLONE_DIR/requirements.txt"
  exit 1
fi

echo "Starting Python TTS server: $PY_BIN $TTS_SERVER"
"$PY_BIN" "$TTS_SERVER" &
TTS_PID=$!

cleanup() {
  echo "Stopping services..."
  kill "$TTS_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Waiting for Python TTS health: http://127.0.0.1:$TTS_PORT/health"
READY=0
for _ in $(seq 1 60); do
  if ! kill -0 "$TTS_PID" 2>/dev/null; then
    echo "Python TTS process exited before becoming ready."
    echo "Tip: set PYTHON_BIN explicitly if needed, e.g."
    echo "PYTHON_BIN=/absolute/path/to/venv/bin/python npm run start:all"
    exit 1
  fi

  if curl -fsS "http://127.0.0.1:$TTS_PORT/health" >/dev/null 2>&1; then
    READY=1
    break
  fi

  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Python TTS did not become healthy on port $TTS_PORT."
  echo "Check for port conflict and server logs above."
  exit 1
fi

echo "Python TTS is ready."
echo "Starting Node app: npm --prefix apps/web start"
npm --prefix apps/web start
