#!/usr/bin/env bash
# Start everything for local dev. Fill in as each piece lands.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/4] SpacetimeDB"
echo "      TODO: spacetime start (local), then spacetime publish keyring --project-path spacetime"
echo "[2/4] Hub        TODO: hub/"
echo "[3/4] Agents     TODO: agents/laptop, agents/android, agents/freewili"
echo "[4/4] UI         TODO: ui/ (npm run dev)"
