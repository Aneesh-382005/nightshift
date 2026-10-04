#!/bin/sh
# usage: demo/reset-all.sh [--keep-db]
# Default: republish the nightshift DB with --delete-data=always (wipes every table), then restore the targets.
# --keep-db: keep the data, close stale open incidents through the hub gate instead (the monitor stays quiet while one is open).
# Always: reset web-1, web-2, laptop and the phone to healthy via demo/reset.sh.
# Restarts nothing. After a wipe, restart the hub (claims the gate), the warden (claims the warden) and the executors (re-register).
# Do not run while a demo is live.
set -u
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.local/bin"
if [ "${1:-}" = "--keep-db" ]; then
  (cd hub && npx tsx src/cli.ts close-incidents 2>&1 | grep -v INFO)
else
  echo "wiping the nightshift database (local server)"
  spacetime publish nightshift --server local --module-path spacetime/spacetimedb --delete-data=always --yes || { echo "publish failed" >&2; exit 1; }
fi
demo/reset.sh web-1 web-2 laptop pixel
