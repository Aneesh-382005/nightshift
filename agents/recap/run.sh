#!/bin/sh
# Morning recap: read the night from SpacetimeDB (viewer only), then render ui/public/recap/latest.mp4.
#   agents/recap/run.sh [hours]        (default 12, 0 = everything)
# Prints one JSON status line. Needs: node/npx, uv, ffmpeg. Claims nothing, touches no devices.
cd "$(dirname "$0")" || exit 1
OUT=../../ui/public/recap
mkdir -p "$OUT" out
if ! npx tsx src/recap.ts --out recap.json --hours "${1:-12}" >out/recap.log 2>&1; then
  printf '{"ok":false,"stage":"recap","error":%s}\n' "$(tail -n 3 out/recap.log | tr '\n' ' ' | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().strip()))')"; exit 1
fi
status=$(uv run --quiet --with pillow python render.py recap.json "$OUT/latest.tmp.mp4") || { echo "$status"; rm -f "$OUT/latest.tmp.mp4"; exit 1; }
mv "$OUT/latest.tmp.mp4" "$OUT/latest.mp4"
echo "$status" | python3 -c 'import json,sys,os; j=json.load(sys.stdin); j["path"]=os.path.abspath("'"$OUT"'/latest.mp4"); j["url"]="/recap/latest.mp4"; print(json.dumps(j))'
