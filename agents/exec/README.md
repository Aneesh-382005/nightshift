# agents/exec

Executors. One process hosts one SpacetimeDB identity per device (`web-1`, `web-2`, `pixel`). Each runs the active grants that target it, exactly once: consumeGrant, snapshot, run with timeout, record change, health check, auto-rollback if it fails, recordResult. It also watches `rollback.requested` events for its device and runs the stored inverse (only for changes it recorded itself).

## Run the containers (stand-in servers, say so in the demo)
```
docker compose -f demo/docker/docker-compose.yml up -d --build
demo/reset.sh            # restore config, logs and service on web-1 and web-2
```
Each container runs a small Python service with `/health` (also on 127.0.0.1:18081 and 18082), a log folder `/var/log/app`, config `/etc/app.conf` with a known-good copy at `/srv/app.conf.good`. Helper commands inside: `svc start|stop|restart|status web`, `health` (exit 0 is healthy), `rotate-logs` (moves the log folder aside, never deletes; `rotate-logs undo`).

## Run the executors
```
cd agents/exec && npm install
npm start                                   # web-1, web-2, pixel
NIGHTSHIFT_DEVICES=web-1,pixel npm start    # a subset
```
Needs SpacetimeDB on ws://127.0.0.1:3000 (override with NIGHTSHIFT_URI, NIGHTSHIFT_DB). Devices that are not reachable are skipped and retried every 15 s.
Tokens live in `agents/exec/.state/`. If the database is reset, delete `.state/*.token`.

## Android executor
Device id `pixel`, serial from `PIXEL_SERIAL` (default 54241FDAP002UZ). Commands run as `adb -s SERIAL shell`. Exit codes come from an `__RC=` marker. Output from `settings`, `svc`, `cmd`, `pm`, `am` that looks like a Java exception counts as failure even with exit 0. `settings get` returning `null` means absent, undone with `settings delete`. Wi-Fi uses `svc wifi enable|disable`; the health check is `ping -c 1 -W 2 8.8.8.8`. Keep the phone unlocked with USB debugging authorized.

## The three demo faults
```
demo/break.sh web-1 service   # service killed and held down   -> fix: svc restart web
demo/break.sh web-1 disk      # 30 MB flood in the log folder  -> fix: rotate-logs
demo/break.sh web-1 config    # config corrupted               -> fix: cp /srv/app.conf.good /etc/app.conf
demo/break.sh web-1 all       # all three
```
`/health` fails for each. Plan snapshots for the fixes: service `{"kind":"service","name":"web"}`, file `{"kind":"file","path":"/etc/app.conf"}`, health command `health`.

## Test
`npm test` runs the acceptance checks. It claims the GATE identity (last claim wins) and asks the CLI warden for undo, so do not run it while the real hub gate is up.
