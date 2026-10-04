#!/bin/sh
# Renders the sample recaps WITHOUT the database and checks the MP4. Also unit-tests the aggregation with fixtures.
cd "$(dirname "$0")" || exit 1
mkdir -p out; fail=0
check() { if [ "$2" = ok ]; then echo "ok    $1"; else echo "FAIL  $1  $3"; fail=1; fi; }
for s in sample quiet; do
  line=$(uv run --quiet --with pillow python render.py samples/$s-recap.json out/$s.mp4 2>&1 | tail -1)
  echo "$line" | python3 -c 'import json,sys; j=json.load(sys.stdin); sys.exit(0 if j["ok"] else 1)' && ok=ok || ok=no
  check "$s: render status ok" $ok "$line"
  info=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height -show_entries format=duration -of default=nw=1 out/$s.mp4 | tr '\n' ' ')
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/$s.mp4)
  echo "$info" | grep -q "codec_name=h264" && echo "$info" | grep -q "pix_fmt=yuv420p" && echo "$info" | grep -q "width=1280" && echo "$info" | grep -q "height=720" && ok=ok || ok=no
  check "$s: h264 yuv420p 1280x720" $ok "$info"
  python3 -c "import sys; d=float('$dur'); sys.exit(0 if 15<=d<=25 else 1)" && ok=ok || ok=no
  check "$s: duration 15-25 s" $ok "$dur"
  python3 -c "import json,sys; j=json.loads('''$line'''); sys.exit(0 if j['renderS']<20 else 1)" && ok=ok || ok=no
  check "$s: render under 20 s" $ok "$line"
  ffmpeg -loglevel error -y -ss 5 -i out/$s.mp4 -frames:v 1 out/$s-f.png && [ "$(wc -c < out/$s-f.png)" -gt 20000 ] && ok=ok || ok=no
  check "$s: frame at 5 s is not blank" $ok
done
npx tsx src/test-lib.ts || fail=1
[ $fail = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
