#!/usr/bin/env bash
# demo/doctor.sh   one green or red line per check. Exit 1 if a CRITICAL check is red. Never prints the Gemini key.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$PATH:$HOME/.local/bin"
G=$'\033[32m'; R=$'\033[31m'; N=$'\033[0m'
bad=0
line() { # line <ok 0|1> <critical 1|0> <name> <detail>
  if [ "$1" = 1 ]; then printf '%s[ ok ]%s %s  %s\n' "$G" "$N" "$3" "$4"
  else printf '%s[FAIL]%s %s  %s%s\n' "$R" "$N" "$3" "$4" "$([ "$2" = 1 ] || echo '  (non-critical)')"; [ "$2" = 1 ] && bad=1; fi
}
chk() { local crit="$1" name="$2"; shift 2; local d; if d=$("$@" 2>&1); then line 1 "$crit" "$name" "$d"; else line 0 "$crit" "$name" "$d"; fi; }

# identity and device checks through the hub's gate token (hub/src/doctor.ts)
if [ -x "$ROOT/hub/node_modules/.bin/tsx" ]; then
  while IFS= read -r l; do
    case "$l" in '{'*) ;; *) continue;; esac
    name=$(printf '%s' "$l" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["name"])')
    ok=$(printf '%s' "$l" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(1 if d["ok"] else 0)')
    cr=$(printf '%s' "$l" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(1 if d["critical"] else 0)')
    de=$(printf '%s' "$l" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["detail"])')
    line "$ok" "$cr" "$name" "$de"
  done < <(cd "$ROOT/hub" && ./node_modules/.bin/tsx src/doctor.ts 2>/dev/null)
else line 0 1 "hub dependencies" "run: cd hub && npm install"; fi

# board
if ls /dev/ttyACM* >/dev/null 2>&1; then line 1 0 "FREE-WILi board" "$(ls /dev/ttyACM* | tr '\n' ' ')$(lsusb 2>/dev/null | grep -q 093c && echo '(USB 093c present)')"
else line 0 0 "FREE-WILi board" "no /dev/ttyACM*, warden will use the sim backend"; fi

# phone
adbout=$(adb devices 2>/dev/null | tail -n +2 | grep -w device)
if [ -n "$adbout" ]; then
  wifi=$(adb shell settings get global wifi_on 2>/dev/null | tr -d '\r')
  line 1 0 "phone authorized (adb)" "$(echo "$adbout" | awk '{print $1}')"
  line "$([ "$wifi" = 1 ] && echo 1 || echo 0)" 0 "phone Wi-Fi" "wifi_on=$wifi"
else line 0 0 "phone authorized (adb)" "no device listed (unauthorized or unplugged)"; line 0 0 "phone Wi-Fi" "unknown"; fi

# Ollama and GPU
if curl -fs -m 3 http://127.0.0.1:11434/api/tags >/dev/null; then
  gpu="CPU only"; nvidia-smi >/dev/null 2>&1 && gpu="GPU driver ok"
  line 1 0 "Ollama" "up, $gpu; models: $(curl -s -m 3 http://127.0.0.1:11434/api/tags | python3 -c 'import sys,json;print(",".join(m["name"] for m in json.load(sys.stdin)["models"]))' 2>/dev/null)"
else line 0 0 "Ollama" "not answering on :11434"; fi
nvidia-smi >/dev/null 2>&1 && line 1 0 "Ollama GPU" "nvidia-smi works" || line 0 0 "Ollama GPU" "no working NVIDIA driver, local model runs on CPU"

# Gemini key present + live 1 token call (key never printed)
KEY=$(grep -E '^\s*GEMINI_API_KEY\s*=' "$ROOT/.env" 2>/dev/null | head -1 | sed -E 's/^[^=]*=\s*//; s/^["'"'"']//; s/["'"'"']\s*$//')
[ -z "$KEY" ] && KEY="${GEMINI_API_KEY:-}"
if [ -n "$KEY" ]; then
  line 1 0 "Gemini key present" "(not shown)"
  MODEL="${DOCTOR_GEMINI_MODEL:-gemini-3.8-flash}"
  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H @<(printf 'x-goog-api-key: %s\nContent-Type: application/json' "$KEY") \
    -d '{"contents":[{"parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":1}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent")
  line "$([ "$code" = 200 ] && echo 1 || echo 0)" 0 "Gemini live call ($MODEL)" "HTTP $code$([ "$code" = 429 ] && echo ' (quota)')"
else line 0 0 "Gemini key present" "no GEMINI_API_KEY in .env or env"; fi
unset KEY

# tailscale
if tailscale status >/dev/null 2>&1; then line 1 0 "Tailscale" "$(tailscale ip -4 2>/dev/null | head -1)"; else line 0 0 "Tailscale" "not up"; fi

# ports
for pc in "3000:SpacetimeDB:1" "8787:hub webhook:1" "5174:UI:0" "8899:warden phone page:0"; do
  p=${pc%%:*}; rest=${pc#*:}; nm=${rest%%:*}; cr=${rest##*:}
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then line 1 "$cr" "port $p ($nm)" "listening"; else line 0 "$cr" "port $p ($nm)" "nothing listening"; fi
done

# supervised processes
for n in db hub exec warden ui; do
  f="$ROOT/.logs/$n.pid"
  if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then line 1 0 "process $n (up.sh)" "pgid $(cat "$f")"
  elif [ "$n" = db ]; then :; else line 0 0 "process $n (up.sh)" "not started by up.sh (may be run by hand)"; fi
done

echo
if [ $bad = 0 ]; then echo "${G}doctor: all critical checks green${N}"; else echo "${R}doctor: critical check(s) red${N}"; fi
exit $bad
