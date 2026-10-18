#!/usr/bin/env bash
# Starts aftercall locally: the API (uvicorn, :8000) and the web UI (Vite, :5173).
# Anything already listening on those ports is stopped first. Ctrl+C stops both.
#
# The API runs on an in-memory store (STORE_BACKEND=memory) and seeds a demo workspace whose API key
# is DEV_API_KEY. The key is generated once into the root .env; the web dev proxy sends it as
# AFTERCALL_API_KEY (apps/web/.env.local). Data is lost when the API restarts.
#
#   ./start.sh          real backend
#   ./start.sh -dev     UI on its mock data (VITE_API_MOCK=true), no backend
#                       (--dev and --mock do the same)
#   ./start.sh --free   mock, on pay as you go with billing on: Pro features are gated   (:5173)
#   ./start.sh --pro    mock, on Pro with billing on: everything open                    (:5174)
#                       Different ports keep each mode's saved state apart, so both can run at once.
#
# Mock URL switches: ?signed-out  ?onboarding  ?fresh  ?role=admin|member|viewer  ?quiet  ?billing=off
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
API_PORT=8000
WEB_PORT=5173
MOCK=false
MOCK_PLAN=
case "${1:-}" in
  -dev|--dev|--mock) MOCK=true ;;
  --free) MOCK=true; MOCK_PLAN=free ;;
  --pro) MOCK=true; MOCK_PLAN=pro; WEB_PORT=5174 ;;
  "") ;;
  *) printf 'Unknown option: %s\nUsage: ./start.sh [-dev | --free | --pro]\n' "$1" >&2; exit 1 ;;
esac

ENV_FILE="$ROOT/.env"
ENV_LOCAL="$ROOT/apps/web/.env.local"

say() { printf '\033[1;34m>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mx\033[0m %s\n' "$*" >&2; exit 1; }

# PIDs listening on a TCP port: lsof where it exists, else netstat (Git Bash on Windows).
listening_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
  else
    netstat -ano 2>/dev/null | tr -d '\r' | awk -v port=":$1" '$1 == "TCP" && $4 == "LISTENING" && $2 ~ port "$" { print $5 }' | sort -u
  fi
}

kill_pids() {
  local signal="$1"; shift
  if command -v taskkill >/dev/null 2>&1 && ! command -v lsof >/dev/null 2>&1; then
    local pid
    for pid in "$@"; do taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true; done
  else
    kill "$signal" "$@" 2>/dev/null || true
  fi
}

stop_port() {
  local pids
  pids="$(listening_pids "$1")"
  [[ -z "$pids" ]] && return 0
  say "Stopping what's running on :$1 (pid $(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill_pids -TERM $pids
  for _ in {1..20}; do
    [[ -z "$(listening_pids "$1")" ]] && return 0
    sleep 0.25
  done
  # shellcheck disable=SC2086
  kill_pids -KILL $pids
}

# Sets KEY=value in a file: replaces the line if present, else appends it.
set_env_value() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    [[ -s "$file" && -n "$(tail -c1 "$file")" ]] && echo >> "$file"
    echo "${key}=${value}" >> "$file"
  fi
}

random_key() {
  printf 'dev_%s' "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
}

# The demo workspace's key: generated once, kept in .env (git-ignored), never printed.
ensure_dev_api_key() {
  if ! grep -qs '^DEV_API_KEY=.\+' "$ENV_FILE"; then
    say "First run: generating DEV_API_KEY in .env"
    set_env_value "$ENV_FILE" DEV_API_KEY "$(random_key)"
  fi
  local key
  key="$(sed -n 's/^DEV_API_KEY=//p' "$ENV_FILE" | tr -d '\r')"
  [[ -n "$key" ]] || fail "DEV_API_KEY in .env is empty"
  sed -i.bak '/^VITE_API_KEY=/d' "$ENV_LOCAL" 2>/dev/null && rm -f "$ENV_LOCAL.bak" || true
  set_env_value "$ENV_LOCAL" AFTERCALL_API_KEY "$key"
}

$MOCK || stop_port "$API_PORT"
stop_port "$WEB_PORT"

if [[ ! -d "$ROOT/apps/web/node_modules" ]]; then
  say "Installing web dependencies"
  (cd "$ROOT/apps/web" && npm install --no-audit --no-fund)
fi

if $MOCK; then
  say "Web UI on mock data${MOCK_PLAN:+ (${MOCK_PLAN} plan)}: http://localhost:$WEB_PORT"
  cd "$ROOT/apps/web" && exec env VITE_API_MOCK=true VITE_MOCK_PLAN="$MOCK_PLAN" ./node_modules/.bin/vite --port "$WEB_PORT" --strictPort
fi

# The backend's virtualenv (bin/ on macOS and Linux, Scripts/ on Windows).
PY="$ROOT/.venv/bin/python"
[[ -x "$PY" ]] || PY="$ROOT/.venv/Scripts/python"
if [[ ! -x "$PY" ]]; then
  say "Creating .venv and installing the backend"
  python3 -m venv "$ROOT/.venv" || python -m venv "$ROOT/.venv"
  PY="$ROOT/.venv/bin/python"
  [[ -x "$PY" ]] || PY="$ROOT/.venv/Scripts/python"
  "$PY" -m pip install -q -e "$ROOT/apps/backend[dev]"
fi

# The Jev key: from the environment or the repo's .env, else from ~/.typesafe.env.
if [[ -z "${TYPESAFE_API_KEY:-}" ]] && ! grep -qs '^TYPESAFE_API_KEY=.\+' "$ENV_FILE" && [[ -f "$HOME/.typesafe.env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.typesafe.env"
  export TYPESAFE_API_KEY
fi
[[ -n "${TYPESAFE_API_KEY:-}" ]] || grep -qs '^TYPESAFE_API_KEY=.\+' "$ENV_FILE" \
  || say "No TYPESAFE_API_KEY: calls won't be analysed and the overlap check is off"
grep -qs '^GEMINI_API_KEY=.\+' "$ENV_FILE" || [[ -n "${GEMINI_API_KEY:-}" ]] \
  || say "No GEMINI_API_KEY: Ask alteria and audio transcripts are off (get one at aistudio.google.com)"

ensure_dev_api_key

API_PID=
WEB_PID=
cleanup() {
  trap - EXIT INT TERM
  say "Stopping"
  kill $API_PID $WEB_PID 2>/dev/null || true
  wait $API_PID $WEB_PID 2>/dev/null || true
}

say "API: http://127.0.0.1:$API_PORT (docs at /docs), in-memory store"
(cd "$ROOT/apps/backend" && STORE_BACKEND=memory exec "$PY" -m uvicorn aftercall.api:app --port "$API_PORT") &
API_PID=$!
trap cleanup EXIT INT TERM

for _ in {1..60}; do
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && break
  kill -0 "$API_PID" 2>/dev/null || fail "The API didn't start; see the output above"
  sleep 0.5
done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || fail "The API didn't answer on :$API_PORT"

say "Web UI: http://localhost:$WEB_PORT"
# In the background too, so Ctrl+C (or closing the script any other way) stops both at once.
(cd "$ROOT/apps/web" && exec ./node_modules/.bin/vite --port "$WEB_PORT" --strictPort) &
WEB_PID=$!
wait "$WEB_PID"
