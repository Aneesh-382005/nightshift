#!/usr/bin/env bash
# demo/up.sh [restart <name>] | [name ...]     names: db hub exec warden ui   (default: all, in that order)
# Starts each piece detached under a small restart-on-crash loop. Logs: .logs/<name>.log, pids: .logs/<name>.pid
# (a pid file holds the process-group id of the loop, so demo/down.sh stops exactly what this started).
# Never wipes the database. A SpacetimeDB that was already running is left alone.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOGS="$ROOT/.logs"; mkdir -p "$LOGS"
export PATH="$PATH:$HOME/.local/bin"

if [ "${1:-}" = restart ]; then shift; "$ROOT/demo/down.sh" "$@"; fi
WANT=("$@"); [ ${#WANT[@]} -eq 0 ] && WANT=(db hub exec warden ui)
want() { for w in "${WANT[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

alive() { [ -f "$LOGS/$1.pid" ] && kill -0 "$(cat "$LOGS/$1.pid")" 2>/dev/null; }

# supervise <name> <dir> <command...>: restart on exit after 3 s, give up after 20 crashes in 60 s.
supervise() {
  local name="$1" dir="$2"; shift 2
  if alive "$name"; then echo "  $name: already running (pid $(cat "$LOGS/$name.pid"))"; return; fi
  setsid bash -c '
    name=$1; dir=$2; log=$3; shift 3
    cd "$dir"; n=0; t0=$(date +%s)
    while true; do
      echo "[$(date +%T)] start: $*" >> "$log"
      "$@" >> "$log" 2>&1 < /dev/null
      echo "[$(date +%T)] exited with $?, restarting in 3s" >> "$log"
      now=$(date +%s); if [ $((now - t0)) -gt 60 ]; then n=0; t0=$now; fi
      n=$((n + 1)); if [ $n -ge 20 ]; then echo "[$(date +%T)] crash loop, giving up" >> "$log"; exit 1; fi
      sleep 3
    done' _ "$name" "$dir" "$LOGS/$name.log" "$@" > /dev/null 2>&1 &
  echo $! > "$LOGS/$name.pid"
  echo "  $name: started (pgid $(cat "$LOGS/$name.pid")), log .logs/$name.log"
}

waitfor() { # waitfor <what> <seconds> <command...>
  local what="$1" s="$2"; shift 2
  for _ in $(seq "$s"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "  WARNING: $what not ready after ${s}s" >&2; return 1
}

echo "nightshift up (logs in .logs/)"

if want db; then
  if curl -fs -m 2 http://127.0.0.1:3000/v1/ping >/dev/null; then
    echo "  db: SpacetimeDB already running on :3000 (left alone, not managed by down.sh)"
  else
    supervise db "$ROOT" spacetime start --listen-addr 127.0.0.1:3000
    waitfor "SpacetimeDB" 30 curl -fs -m 2 http://127.0.0.1:3000/v1/ping
  fi
  if ! spacetime sql nightshift "SELECT 1 FROM device LIMIT 1" --server local >/dev/null 2>&1; then
    echo "  note: could not query database 'nightshift' with the CLI identity (may be fine). If it is missing: cd spacetime && spacetime publish nightshift --server local -p spacetimedb" >&2
  fi
fi

if want hub; then
  # GEMINI_API_KEY comes from the repo .env, sourced inside the supervised shell, never printed.
  supervise hub "$ROOT/hub" bash -c 'set -a; [ -f "$1/.env" ] && . "$1/.env"; set +a; exec ./node_modules/.bin/tsx src/serve.ts' _ "$ROOT"
  waitfor "hub webhook :8787" 20 bash -c 'exec 3<>/dev/tcp/127.0.0.1/8787'
fi

if want exec; then
  for c in web-1 web-2 laptop-sandbox; do
    docker ps --format '{{.Names}}' | grep -qx "$c" || { echo "  container $c is not running: starting the compose stack"; docker compose -f "$ROOT/demo/docker/docker-compose.yml" up -d >/dev/null 2>&1; break; }
  done
  devs="web-1,web-2,laptop"
  if adb devices 2>/dev/null | grep -qw device; then devs="$devs,pixel"; else echo "  WARNING: phone not listed by adb (unplugged or not authorized), starting executors without pixel" >&2; fi
  supervise exec "$ROOT/agents/exec" env NIGHTSHIFT_DEVICES="$devs" ./node_modules/.bin/tsx src/index.ts
fi

if want warden; then
  backend=sim; ls /dev/ttyACM* >/dev/null 2>&1 && backend=onewili
  # extra flags (buttons stream, shake) can be added with WARDEN_ARGS="--buttons stream --shake on"
  supervise warden "$ROOT/agents/warden" ./node_modules/.bin/tsx src/warden.ts --backend "$backend" --http-port 8899 --http-host 127.0.0.1 ${WARDEN_ARGS:-}
  echo "  warden backend: $backend (phone page on :8899, token is printed in .logs/warden.log)"
fi

if want ui; then
  (cd "$ROOT/ui" && node scripts/sync-bindings.mjs >/dev/null 2>&1)
  supervise ui "$ROOT/ui" ./node_modules/.bin/vite --host 0.0.0.0 --port 5174 --strictPort
fi

echo "done. Check everything with: demo/doctor.sh"
