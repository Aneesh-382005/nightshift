#!/bin/sh
# Install the Nightshift executor + demo web service on a Linux box as a LIMITED user (no sudo needed).
# Everything is outbound: the executor connects OUT to SpacetimeDB. No inbound ports are opened (the demo service
# listens on 127.0.0.1 only).
#   sh demo/vps/install.sh        (defaults: STDB_URI=ws://100.88.14.40:3000 NS_DEVICE_ID=vps-1; override via env)
# Optional: NS_ROOT (default ~/ns-demo), NS_PORT (8080), NS_ALERT_URL (hub webhook reachable from here, default: off, vitals only),
#           NS_DRY_RUN=1 (write files only: no nvm, npm or systemctl), NS_UNIT_DIR, NS_SKIP_NODE=1
set -e
STDB_URI=${STDB_URI:-ws://100.88.14.40:3000}   # the laptop's tailnet address (tailscale serve forwards tcp 3000 to the DB)
NS_DEVICE_ID=${NS_DEVICE_ID:-vps-1}
KIT=$(cd "$(dirname "$0")/../.." && pwd)
ROOT=${NS_ROOT:-$HOME/ns-demo}; PORT=${NS_PORT:-8080}; ALERT=${NS_ALERT_URL:-off}
BIN=$HOME/.local/bin; UNITS=${NS_UNIT_DIR:-$HOME/.config/systemd/user}; CFG=$HOME/.config/nightshift
dry() { [ -n "$NS_DRY_RUN" ]; }
say() { echo "==> $*"; }

# 1. Node 22, user level (nvm)
if dry || [ -n "$NS_SKIP_NODE" ]; then NODE=$(command -v node || echo /usr/bin/node)
else
  export NVM_DIR=$HOME/.nvm
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then say "installing nvm"; curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null sh; fi
  . "$NVM_DIR/nvm.sh"; say "installing Node 22"; nvm install 22 >/dev/null
  NODE=$(nvm which 22)
fi
NODEDIR=$(dirname "$NODE")

# 2. npm install (bindings need the spacetimedb client, the executor needs tsx)
if ! dry; then
  for d in agents/common agents/exec; do say "npm install in $d"; (cd "$KIT/$d" && PATH="$NODEDIR:$PATH" npm install --no-audit --no-fund >/dev/null); done
fi

# 3. wrapper scripts on PATH, demo root with known-good copies
say "installing helpers into $BIN and seeding $ROOT"
mkdir -p "$BIN" "$UNITS" "$CFG"
cp "$KIT"/demo/vps/bin/* "$BIN"/ && chmod +x "$BIN"/svc "$BIN"/health "$BIN"/rotate-tmp
NS_ROOT="$ROOT" sh "$KIT/demo/vps/seed.sh"

# 4. config for the executor (read by systemd)
cat > "$CFG/exec.env" <<ENV
STDB_URI=$STDB_URI
NS_DEVICE_ID=$NS_DEVICE_ID
NS_ROOT=$ROOT
NS_PORT=$PORT
NS_UNIT=ns-demo
NIGHTSHIFT_ALERT_URL=$ALERT
PATH=$BIN:$NODEDIR:/usr/local/bin:/usr/bin:/bin
ENV
chmod 600 "$CFG/exec.env"

# 5. systemd user units
cat > "$UNITS/ns-demo.service" <<UNIT
[Unit]
Description=Nightshift demo web service (stand-in)

[Service]
Environment=NS_ROOT=$ROOT NS_PORT=$PORT
ExecStart=/usr/bin/python3 $KIT/demo/vps/demoapp.py
Restart=always
RestartSec=1

[Install]
WantedBy=default.target
UNIT
cat > "$UNITS/nightshift-exec.service" <<UNIT
[Unit]
Description=Nightshift executor ($NS_DEVICE_ID), connects out to SpacetimeDB

[Service]
WorkingDirectory=$KIT/agents/exec
EnvironmentFile=$CFG/exec.env
ExecStart=$NODE --import tsx src/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT

if dry; then say "dry run: units written to $UNITS, skipping systemctl"; exit 0; fi
systemctl --user daemon-reload
systemctl --user enable --now ns-demo.service nightshift-exec.service
sleep 3
systemctl --user --no-pager status ns-demo.service nightshift-exec.service | sed -n '1,14p' || true
"$BIN/health" && say "demo service healthy"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
  say "NOTE: user services stop when you log out. One time, as an admin: sudo loginctl enable-linger $USER"
fi
say "logs: journalctl --user -u nightshift-exec -f"
