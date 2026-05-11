#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -x ".venv/bin/andromeda-dashboard" ]]; then
  echo "Missing .venv/bin/andromeda-dashboard. Create the virtualenv and install the project first." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${api_pid:-}" ]]; then
    kill "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

.venv/bin/andromeda-dashboard serve &
api_pid=$!

for _ in {1..40}; do
  if curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
  fi
  sleep 0.25
done

if ! curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  echo "Backend did not become healthy on http://127.0.0.1:8765." >&2
  exit 1
fi

npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
