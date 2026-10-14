#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo 'Install Node.js 22 or later, then open this file again.'; read -r -p 'Press Enter to close.'; exit 1; fi
npm run build
node server.mjs &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
kill -0 "$PID" 2>/dev/null || { echo 'Server could not start. Check the message above (or whether port 8000 is occupied).'; exit 1; }
open "http://127.0.0.1:${PORT:-8000}"
wait "$PID"
