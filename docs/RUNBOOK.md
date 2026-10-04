# Demo runbook (all commands, run from ~/Source/MHacks/nightshift)

## Cold start (after a reboot)
```
cd ~/Source/MHacks/nightshift
# 1. database, detached so closing a terminal does not kill it
mkdir -p .logs
setsid nohup ~/.local/bin/spacetime start --listen-addr 127.0.0.1:3000 > .logs/stdb.log 2>&1 < /dev/null & disown
# 2. stand-in servers (containers restart by themselves; this is a safety net)
docker compose -f demo/docker/docker-compose.yml up -d
# 3. everything else (hub, executors, warden, UI), restarts crashed parts
demo/up.sh
# 4. all green?
demo/doctor.sh
# 5. clean start for a take (devices healthy, stale incidents closed)
demo/reset-all.sh --keep-db
```
Wipe everything including trust back to zero (use before recording): `demo/reset-all.sh` (it republishes the DB; restart with `demo/up.sh restart hub warden exec` afterwards).

## Daily commands
- Status: `demo/doctor.sh`
- Stop what up.sh started: `demo/down.sh`
- Restart one part: `demo/up.sh restart hub` (or exec, warden, ui)
- Logs: `.logs/hub.log`, `.logs/warden.log`, `.logs/exec.log`, `.logs/ui.log`
- Dashboard: http://localhost:5174 ; phone over Tailscale: http://100.88.14.40:5174
- Phone approval page: the link with the token is printed in `.logs/warden.log` (`grep "phone Lantern" .logs/warden.log | tail -1`); it changes when the warden restarts. Keep it private.

## Make a fault (labelled MOCK stand-ins)
```
curl -s -XPOST localhost:8787/break -H 'content-type: application/json' -d '{"device":"web-1","fault":"service"}'
```
devices: web-1, web-2, laptop, pixel. faults: service, config, disk, folder, wifi (pixel only), poison. Or use the Demo controls on the dashboard.
Morning video: press "Make my morning video" or `curl -s -XPOST localhost:8787/recap`.

## SSH demo (ssh-box container, 127.0.0.1:2222)
```
sh demo/ssh/setup.sh && docker compose -f demo/ssh/docker-compose.yml up -d --build   # once; container may already be up
demo/up.sh restart exec                                                              # registers device ssh-box
ssh -i demo/ssh/keys/id_ed25519 -p 2222 nsuser@127.0.0.1                             # open a terminal on the box (key path: see demo/ssh/README or setup.sh)
demo/ssh/break.sh service|disk|config|folder|all ; demo/ssh/reset.sh
```
On camera: SSH in, break something by hand, watch Nightshift restore it.

## The Lantern (FREE-WILi)
Green approves 120 s, blue approves 30 s, red denies (and revokes when nothing is pending), gray undoes the last change, yellow shows recent events, double shake revokes everything. Never hold red more than 2 s. If the screen dies or the board is replugged: `demo/up.sh restart warden`.

## Phone
- Mirror to the screen: `cd ~/Downloads/scrcpy-linux-x86_64-v4.1 && ADB=$(which adb) ./scrcpy --stay-awake --window-title "Pixel 9 Pro (real device)"`
- Phone must be on USB, authorized (`adb devices`), Do Not Disturb on.
- Tailscale forwards (run once, persists): `sudo tailscale serve --bg --tcp 3000 tcp://127.0.0.1:3000`, same for 8899 and 8787.

## Offline mode (no internet at the venue)
Everything is local except the cloud model. Use the local model only:
```
demo/down.sh hub
cd hub && (set -a; . ../.env; set +a; NS_HARNESS=loop NS_LOOP_OFFLINE=1 NS_LOOP_CHAIN=ollama:qwen2.5-coder:7b npx tsx src/serve.ts) &
```
(or ask the lead). Check the GPU: `ollama ps` should say 100% GPU; if it says CPU: `sudo systemctl restart ollama`.

## If something is wrong
- Executors offline in the dashboard: `demo/up.sh restart exec`
- Warden warnings or board silent: `demo/up.sh restart warden`
- Gemini 429: expected on the top model; the loop falls back to flash-lite, then the local model.
- Do not run `pkill -f`; use `demo/down.sh`.
- Never run two things that claim the gate at once (test scripts claim it; stop the hub first).
