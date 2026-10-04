#!/bin/sh
# Create the demo root (default ~/ns-demo) with config, app folder, known-good copies. Idempotent: never overwrites existing files.
R=${NS_ROOT:-$HOME/ns-demo}; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$R/etc" "$R/srv/app/static" "$R/log/app" "$R/tmp"
[ -e "$R/srv/app.conf.good" ] || printf 'port=8080\nmode=prod\nworkers=2\n' > "$R/srv/app.conf.good"
[ -e "$R/etc/app.conf" ] || cp "$R/srv/app.conf.good" "$R/etc/app.conf"
[ -e "$R/srv/app/index.html" ] || printf '<h1>vps stand-in</h1>\n' > "$R/srv/app/index.html"
[ -e "$R/srv/app/data.json" ] || printf '{"version":1,"items":["a","b","c"]}\n' > "$R/srv/app/data.json"
[ -e "$R/srv/app/static/style.css" ] || printf 'body{font-family:sans-serif}\n' > "$R/srv/app/static/style.css"
if [ ! -d "$R/srv/app.snapshot" ]; then
  cp -a "$R/srv/app" "$R/srv/app.snapshot"
  (cd "$R/srv" && find app -type f | sort | xargs sha256sum > app.manifest)
fi
echo "seeded $R"
