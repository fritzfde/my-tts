#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to configure hooks."
  exit 1
fi

git config core.hooksPath .githooks
echo "Configured git hooks path: $(git config core.hooksPath)"
