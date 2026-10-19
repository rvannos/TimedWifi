#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export MOCK_NETWORK="${MOCK_NETWORK:-true}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"

if [ ! -f ".venv/bin/pip" ]; then
  echo "[hotspot-app] Creating Python virtual environment (.venv)..."
  if ! python3 -m venv .venv 2>/dev/null; then
    rm -rf .venv
    python3 -m venv --without-pip .venv
    curl -sS https://bootstrap.pypa.io/get-pip.py | .venv/bin/python3
  fi
fi

source .venv/bin/activate

echo "[hotspot-app] Installing Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "================================================================"
echo "  Timed Hotspot Controller"
echo "  MOCK_NETWORK : ${MOCK_NETWORK}"
echo "  Display UI   : http://localhost:${PORT}/display"
echo "  Mobile Portal: http://localhost:${PORT}/portal"
echo "  Admin Panel  : http://localhost:${PORT}/admin (password: admin)"
echo "================================================================"

if command -v systemd-inhibit >/dev/null 2>&1; then
  exec systemd-inhibit --what=idle:sleep:handle-lid-switch \
    --who="TimedWifi Hotspot Controller" \
    --why="Keep display and hotspot active during event" \
    uvicorn backend.main:app --host "$HOST" --port "$PORT"
else
  exec uvicorn backend.main:app --host "$HOST" --port "$PORT"
fi
