#!/usr/bin/env bash
# Regression suite for index.html. Runs test.js (Playwright) against a mocked nori API,
# so no login or network access to nori is needed.
set -u
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
python3 -m http.server "$PORT" > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

node test.js "http://localhost:$PORT/index.html"
