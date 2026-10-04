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

## Monitor (real alerts, vitals)
Every executor probes its device every 3 s (disable with `NIGHTSHIFT_MONITOR=0`):
- containers: `/health` status and body, df on /var/log, log folder size, PID 1 age (one `docker exec`)
- phone: adb liveness, `settings get global wifi_on`, battery level from `dumpsys battery`, uptime (one adb call). Failing means adb dead or wifi off.
- laptop sandbox: dirs from the snapshot that are missing, files missing or changed vs the snapshot checksums

Every 10 s it logs an event `kind: vitals`, `device` set, `detail` JSON, e.g. `{"ok":true,"health":200,"diskPct":37,"logMB":0,"uptimeS":14468}` (phone: `{"ok":true,"alive":true,"wifi":true,"battery":100,"uptimeS":..}`, laptop: `{"ok":true,"missing":[],"filesBad":0,"files":5,..}`).

After 2 failed probes in a row (healthy to failing) it POSTs `{"device","alert","source":"monitor"}` to `NIGHTSHIFT_ALERT_URL` (default http://127.0.0.1:8787/alert). The alert text is the probe result (`service down: /health not responding`, `health check failed: HTTP 500 bad config`, `folder missing in sandbox: projects/notes`). One alert per outage: it will not repeat until a healthy probe is seen, and it stays quiet while an incident for that device has status `open` (stale `open` rows therefore silence it). If the POST fails it retries on the next probe. Probing pauses while a grant or rollback is running on the device, so a fix is never alerted on. Note the phone alerts whenever wifi is off, including when it was off before you started.

## Sandbox laptop and the "folder deleted" fault
Device `laptop` is a SANDBOX, not the host. It is the container `laptop-sandbox` (compose service `laptop`): only `~/nightshift-playground` is mounted read-write, the known-good snapshot `~/.nightshift/playground-snapshot` is mounted read-only at `/snapshot`, no network, read-only root fs, all capabilities dropped, no sudo, runs as your uid. Commands from the gate run inside it, so the confinement does not depend on policy alone (policy should still deny paths outside /playground, sudo and network tools).
```
demo/laptop-setup.sh                                  # sample files + snapshot, only if no snapshot exists yet
docker compose -f demo/docker/docker-compose.yml up -d --build
demo/break.sh laptop folder                           # deletes projects/notes (the user deleting a folder)
demo/break.sh web-1 folder                            # deletes /srv/app (web-1 /health then says "app dir missing")
demo/reset.sh laptop web-1
```
Restore runbooks (plan.snapshots uses the new kind `dir`: records exists plus a tree hash; if the folder was absent the synthesized inverse moves it aside to `<path>.undone.<ts>`, never deletes):
- laptop: command `cp -a -n /snapshot/files/. /playground/` (restores only what is missing, never overwrites edits); snapshots `[{"kind":"dir","path":"/playground/projects/notes"}]`; health `cd /playground && sha256sum -c --quiet /snapshot/MANIFEST && for d in $(cat /snapshot/DIRS); do [ -d "$d" ] || exit 1; done`
- web-1/web-2: command `cp -a /srv/app.snapshot /srv/app`; snapshots `[{"kind":"dir","path":"/srv/app"}]`; health `test -d /srv/app && cd /srv && sha256sum -c --quiet /srv/app.manifest && health`

## Remote host (VPS) device
Framing: fix a remote machine from anywhere. The executor runs ON the machine as a limited user and connects OUT to SpacetimeDB. No inbound ports (the demo service listens on 127.0.0.1 only), no sudo (the unit sets `NoNewPrivileges=true`).

Target kind `host` (`HostTarget`): commands run as `sh -c` under that user with cwd = `NS_ROOT` (default `~/ns-demo`), so runbook paths are relative to the root. Service control goes through the narrow wrapper `svc status|start|stop|restart web` (only the demo unit, via `systemctl --user`), never raw systemctl. Snapshot kinds: `file`, `dir`, `service`. Config: env `NS_DEVICE_ID` (single host device), or a targets file (`NS_TARGETS`, default `agents/exec/targets.json`): `[{"id":"vps-1","type":"host","root":"~/ns-demo"},{"id":"web-1","type":"docker"},{"id":"pixel","type":"adb","serial":"..."}]`. DB address: `STDB_URI` (or `NIGHTSHIFT_URI`).

Deploy to Ubuntu 24.04 (UNVERIFIED on a real VPS: nvm, npm and systemctl steps were not run here; file generation, the executor, the scripts and the runbooks were run locally):
```
# laptop: pack (executor + bindings + demo/vps), copy
demo/vps/pack.sh
scp demo/vps/dist/nightshift-vps.tgz user@vps:
# vps, as a normal user. The VM must reach the DB: the laptop already forwards it on its tailnet address
# (tailscale serve, tcp 3000 to 127.0.0.1:3000), so no 0.0.0.0 listen is needed. Maincloud URI later.
tar xzf nightshift-vps.tgz && cd nightshift-vps
sh demo/vps/install.sh      # defaults: STDB_URI=ws://100.88.14.40:3000 NS_DEVICE_ID=vps-1
sudo loginctl enable-linger $USER      # once, so user services survive logout (needs an admin)
journalctl --user -u nightshift-exec -f
```
The installer: nvm + Node 22 (user level), `npm install` in agents/common and agents/exec, helpers `svc`, `health`, `rotate-tmp` into `~/.local/bin`, seeds `~/ns-demo`, writes `~/.config/nightshift/exec.env`, installs and starts two systemd user services: `ns-demo` (python http.server demo with `/health`, log file, `Restart=always`) and `nightshift-exec` (`Restart=always`). `NS_ALERT_URL` defaults to `off`: vitals still flow to the DB, but the executor cannot POST to a hub on the laptop's 127.0.0.1, so a remote device needs the hub to turn failing vitals into incidents, or a webhook reachable over Tailscale in `NS_ALERT_URL`. Re-run is idempotent. All install.sh steps that touch the system (nvm, npm install, systemctl, linger) are UNVERIFIED on a real VPS. Dry run into a fake HOME: `HOME=/tmp/x NS_DRY_RUN=1 STDB_URI=... NS_DEVICE_ID=... sh demo/vps/install.sh`.

Faults (run on the VPS, or `ssh vps 'sh nightshift-vps/demo/vps/break.sh disk'`; `reset.sh` restores):
| fault | break.sh | health says | runbook (command, snapshots, inverse) |
|---|---|---|---|
| service down | `service` (stops the unit) | `service down` | `svc restart web`; `[{"kind":"service","name":"web"}]`; inverse synthesized |
| config corrupted | `config` | `500 bad config` | `cp srv/app.conf.good etc/app.conf`; `[{"kind":"file","path":"etc/app.conf"}]`; inverse synthesized |
| disk fill | `disk` (30 MB in tmp/) | `503 tmp dir full` | `rotate-tmp` (moves tmp aside, never deletes); no snapshots; inverse `rotate-tmp undo` |
| folder deleted | `folder` (rm srv/app) | `500 app dir missing` | `cp -a srv/app.snapshot srv/app`; `[{"kind":"dir","path":"srv/app"}]`; inverse synthesized (moves aside) |

Health command for all but folder: `health`. For folder: `test -d srv/app && (cd srv && sha256sum -c --quiet app.manifest) && health`. Policy for the gateway (device type host, ids like vps-1): autonomous or ask entries for exactly the four commands above plus read commands `health`, `svc status web`, `tail -n 20 log/app/app.log`, `df -P .`, `du -sk tmp`, `ls srv`; forbid sudo, anything with absolute paths outside the root, `..`, network tools (curl, wget, nc, ssh, scp), `rm`, `systemctl`, `svc` with any name but `web`, and `mv`/`cp` targets outside the root.

## ssh target (heal a machine over SSH)
Device `ssh-box` (kind `ssh`, `SshTarget`): same contract as the docker target, but commands go through `ssh -i key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 2222 nsuser@127.0.0.1 -- timeout -s KILL N sh -c '<cmd>'` (plus IdentitiesOnly, a per-device known_hosts file in `agents/exec/.state/`, connect timeout and keepalives). Remote `timeout` really kills a hung command; ssh exit 255 is reported as `[ssh connection failed]`. Snapshots (`file`, `dir`, `service`), inverses, verification, health and the monitor probe are the shared helpers. If you rebuild the box its host key changes: delete `.state/ssh-box.known_hosts`.

The box (`demo/ssh/`, SANDBOX container `ssh-box`): python:3.12-slim + openssh-server, the same demo service and known-good copies as web-1 (so the linux-server runbooks apply unchanged), key-only auth for the unprivileged user `nsuser` (no password, no root login, no sudo, no tty, no forwarding), published on 127.0.0.1:2222 only. The ed25519 keypair is throwaway, created by `demo/ssh/setup.sh` in `demo/ssh/keys/` (gitignored).
```
sh demo/ssh/setup.sh                                          # keypair, once
docker compose -f demo/ssh/docker-compose.yml up -d --build   # container ssh-box on 127.0.0.1:2222
ssh -i demo/ssh/keys/id_ed25519 -p 2222 nsuser@127.0.0.1 health   # manual check
demo/ssh/break.sh service|disk|config|folder|all              # faults (docker exec as nsuser)
demo/ssh/reset.sh
# executor: ssh-box is in the default device list; to run only it:
cd agents/exec && NIGHTSHIFT_DEVICES=ssh-box npm start        # registers device ssh-box in the DB (live stack: only when told)
```
Targets file form: `{"id":"ssh-box","type":"ssh","host":"127.0.0.1","port":2222,"user":"nsuser","key":"/path/to/key"}`. Fix list for the gateway, identical to linux-server (paths absolute, as in web-1): restart-web `svc restart web`; restore-config `cp /srv/app.conf.good /etc/app.conf`; restore-folder `cp -a /srv/app.snapshot /srv/app` (snapshot kind dir); rotate-logs `rotate-logs` with inverse `rotate-logs undo`; health `health` (folder: `test -d /srv/app && (cd /srv && sha256sum -c --quiet app.manifest) && health`).

## Tests
`npm run test:ssh`: starts only the ssh-box container (stops it afterwards if the test started it), checks key-only auth, nsuser, no sudo, exit codes, remote timeout kill, the monitor probe, and the four runbooks with snapshot, inverse and verification. No executor, no DB, no gate.
`npm run test:host` runs the host target locally in a throwaway root with a throwaway systemd user unit (`ns-demo-test`, port 18090, removed afterwards), fake webhook :18789, device `vps-test`: registration, vitals, alert per fault with debounce, and each runbook with snapshot, inverse and verification. It does not claim the gate.
`npm run test:monitor` (vitals, alert, debounce, no repeat; own fake webhook on :18787) and `npm run test:folder` (monitor sees deleted folders on laptop and web-2, restore pieces, inverse and verification; fake webhook on :18788). Neither claims the gate. Neither tests the grant path for `dir` snapshots end to end, `npm test` does that for the other kinds.

## Test (full acceptance)
`npm test` runs the acceptance checks. It claims the GATE identity (last claim wins) and asks the CLI warden for undo, so do not run it while the real hub gate is up.
