#!/usr/bin/env bash
# demo/down.sh [name ...]   stops only what demo/up.sh started (by pid file: the loop's process group). No pattern kills.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; LOGS="$ROOT/.logs"
NAMES=("$@"); [ ${#NAMES[@]} -eq 0 ] && NAMES=(ui warden exec hub db)
for n in "${NAMES[@]}"; do
  f="$LOGS/$n.pid"
  [ -f "$f" ] || { echo "  $n: not started by up.sh"; continue; }
  pg="$(cat "$f")"
  if kill -0 "$pg" 2>/dev/null; then
    kill -TERM -- "-$pg" 2>/dev/null || kill -TERM "$pg" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8; do kill -0 "$pg" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pg" 2>/dev/null && { kill -KILL -- "-$pg" 2>/dev/null || true; }
    echo "  $n: stopped"
  else
    echo "  $n: was not running"
  fi
  rm -f "$f"
done
