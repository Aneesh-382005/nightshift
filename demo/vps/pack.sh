#!/bin/sh
# Run on the laptop: builds demo/vps/dist/nightshift-vps.tgz (executor, bindings, demo/vps). Copy it to the VPS with scp.
set -e
cd "$(dirname "$0")/../.."
mkdir -p demo/vps/dist
tar czf demo/vps/dist/nightshift-vps.tgz --transform 's,^,nightshift-vps/,' \
  agents/exec/package.json agents/exec/package-lock.json agents/exec/tsconfig.json agents/exec/src \
  agents/common/package.json agents/common/package-lock.json agents/common/src/module_bindings \
  demo/vps/bin demo/vps/demoapp.py demo/vps/seed.sh demo/vps/install.sh demo/vps/break.sh demo/vps/reset.sh
ls -l demo/vps/dist/nightshift-vps.tgz
