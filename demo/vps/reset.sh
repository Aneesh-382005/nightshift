#!/bin/sh
# Restore the demo root to known-good and restart the service.
R=${NS_ROOT:-$HOME/ns-demo}; UNIT=${NS_UNIT:-ns-demo}; H=$(cd "$(dirname "$0")" && pwd)/bin
cp "$R/srv/app.conf.good" "$R/etc/app.conf"
rm -f "$R"/tmp/flood.bin; rm -rf "$R"/tmp.rotated.* "$R"/.rotate.last "$R"/srv/app.undone.*
mkdir -p "$R/tmp" "$R/log/app"; rm -rf "$R/srv/app"; cp -a "$R/srv/app.snapshot" "$R/srv/app"
systemctl --user restart "$UNIT"; sleep 1
"$H/health" && echo "reset, health=ok" || echo "reset, health=FAIL"
