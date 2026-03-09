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
ASR_PORT="${ASR_PORT:-8001}"

if [ ! -f "$ASR_DIR/main.py" ]; then
  echo "ASR server not found at: $ASR_DIR/main.py"
  exit 1
fi

if [ -n "${ASR_PYTHON_BIN:-}" ]; then
  if [ ! -x "$ASR_PYTHON_BIN" ]; then
    echo "Configured ASR_PYTHON_BIN is not executable: $ASR_PYTHON_BIN"
    exit 1
  fi
  PY_BIN="$ASR_PYTHON_BIN"
elif [ -x "$ASR_DIR/myenv/bin/python" ]; then
  PY_BIN="$ASR_DIR/myenv/bin/python"
elif [ -x "$ASR_DIR/.venv/bin/python" ]; then
  PY_BIN="$ASR_DIR/.venv/bin/python"
elif [ -x "$ASR_DIR/venv/bin/python" ]; then
  PY_BIN="$ASR_DIR/venv/bin/python"
else
  PY_BIN="python3"
fi

if ! "$PY_BIN" -c "import fastapi, uvicorn, websockets, requests, faster_whisper, webrtcvad" >/dev/null 2>&1; then
  echo "Python interpreter '$PY_BIN' is missing ASR dependencies (FastAPI/Uvicorn/WebSocket/faster-whisper stack)."
  echo "Run: npm run setup:asr"
  exit 1
fi

echo "Starting Mic ASR server: $PY_BIN -m uvicorn main:app --app-dir $ASR_DIR --host 127.0.0.1 --port $ASR_PORT"
exec "$PY_BIN" -m uvicorn main:app --app-dir "$ASR_DIR" --host 127.0.0.1 --port "$ASR_PORT"
