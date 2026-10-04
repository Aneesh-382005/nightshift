# Targets cheat sheet (Android adb, Docker, SSH)

Tags: VERIFIED = confirmed in a fetched source this session. UNVERIFIED = from memory or not seen in a source; test before relying on it.
Nothing here was executed on a device or container.

Sources
- S1 https://developer.android.com/tools/adb
- S2 https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/user/adb.1.md
- S3 https://raw.githubusercontent.com/M0Rf30/android-udev-rules/main/README.md
- S4 https://packages.ubuntu.com/noble/adb
- S5 https://raw.githubusercontent.com/mscdex/ssh2/master/README.md
- S6 https://raw.githubusercontent.com/mscdex/ssh2/master/lib/client.js
- S7 https://raw.githubusercontent.com/apocas/dockerode/master/README.md
- S8 https://raw.githubusercontent.com/apocas/dockerode/master/examples/exec_running_container.js
- S9 https://docs.docker.com/reference/cli/docker/container/exec/
- S10 https://docs.docker.com/reference/cli/docker/container/diff/
- S11 https://docs.docker.com/reference/cli/docker/container/cp/

## 1. Android over adb (Ubuntu 24.04)

### Install and udev
```
sudo apt install adb android-sdk-platform-tools-common   # VERIFIED pkg exists: noble adb 1:34.0.4-1build3 (S4); common pkg is only "Recommended"
sudo usermod -aG plugdev $USER                           # UNVERIFIED: the Debian common pkg ships udev rules using plugdev; re-login needed
adb kill-server && adb start-server && adb devices        # VERIFIED flow (S3 uses kill-server, replug, devices)
```
Alternative community rules (VERIFIED, S3): rules go in `/etc/udev/rules.d/51-android.rules`, group is `adbusers`:
```
sudo gpasswd -a $(whoami) adbusers
sudo udevadm control --reload-rules
sudo systemctl restart systemd-udevd.service
```
Phone side: enable Developer options, turn on USB debugging, replug, tap "Allow" on the RSA prompt (VERIFIED that USB debugging and RSA auth are needed, S1). Check "Always allow" so the key persists (UNVERIFIED).

### adb devices states (VERIFIED, S1)
- `device`: connected. Does not guarantee Android is fully booted (poll `adb shell getprop sys.boot_completed`, UNVERIFIED).
- `unauthorized`: RSA key not accepted yet. Fix: unlock phone and accept prompt. If no prompt: `adb kill-server`, toggle USB debugging, or "Revoke USB debugging authorizations" (UNVERIFIED).
- `offline`: not connected or not responding. Fix: replug, `adb kill-server`, `adb reconnect offline` (UNVERIFIED).
- `no device`: nothing attached. A device with missing udev permission shows `no permissions` (UNVERIFIED).
- Machine readable: `adb devices -l` (VERIFIED output has key:value fields). Use `adb -s <serial> ...` always.
- Wait helper: `adb -s SER wait-for-device` (UNVERIFIED, blocks forever; wrap in a timeout).

### Shell command patterns (all UNVERIFIED unless noted; run as adb shell, no root)
Wi-Fi toggle: `adb -s SER shell svc wifi enable` / `disable` (svc exists, S1 mentions svc wifi as a service; exact subcommands UNVERIFIED). Works for shell user on most devices; Android 10+ may still allow it from shell.
Settings (shell user can read all namespaces; writing `global` and `system` generally works from shell, `secure` writes usually work, some keys are protected on newer Android):
```
adb shell settings get global airplane_mode_on
adb shell settings put global airplane_mode_on 0
adb shell settings get secure android_id
adb shell settings get system screen_brightness
adb shell settings put system screen_brightness 120
adb shell settings list global
adb shell settings delete global some_key      # restore a key that did not exist before
```
`settings get` prints the literal `null` when the key is unset. Snapshot that as "absent" and undo with `settings delete`, not `put ... null`.
Reads:
```
adb shell dumpsys wifi                 # large; grep for "Wi-Fi is" / mWifiInfo
adb shell dumpsys connectivity
adb shell dumpsys battery              # level, status, AC/USB powered
adb shell dumpsys diskstats            # or: adb shell df /data
adb shell logcat -d -t 200             # -d dump and exit, -t last N lines
adb shell ping -c 1 -W 2 8.8.8.8       # connectivity check
adb shell cmd wifi status              # Android 10+ (UNVERIFIED)
adb exec-out screencap -p > screen.png # VERIFIED (S1)
adb shell screencap /sdcard/s.png && adb pull /sdcard/s.png   # VERIFIED (S1)
```
Root needed? None of the above on a non-rooted phone, except: `dumpsys` sections that need DUMP permission are fine for shell user; reading other apps' data (`/data/data/...`) and writing protected secure/global keys need root or are blocked (UNVERIFIED). Do not use `adb root` on production builds (not available).

### Exit codes (key gotcha)
- VERIFIED (S2): `adb shell` has flag `-x`: "Disable remote exit codes and stdout/stderr separation". So modern adb with a modern device (shell protocol v2, Android 7+ per memory, UNVERIFIED) returns the remote exit code and separates stderr by default.
- Old device or adb (before shell v2): exit code is lost, adb returns 0, stderr merged into stdout (UNVERIFIED but widely reported).
- Portable detection that works everywhere:
```
adb -s SER shell 'cmd_here; echo __RC=$?'      # parse last line __RC=N from stdout
```
- Also treat as failure when output contains `error:`, `Exception`, `Permission denied`, `Error:` (settings/svc print Java exceptions yet may exit 0). UNVERIFIED.
- adb itself (not the remote cmd) fails with exit 1 and stderr `error: device unauthorized.` / `error: device offline` / `error: device 'X' not found` (UNVERIFIED text).
- Use `exec-out` for binary or when you want no pty and no CRLF mangling. VERIFIED raw binary purpose (S1). `adb shell` without a tty may translate nothing on modern adb, but old adb turned \n into \r\n (UNVERIFIED).

### Node child_process (UNVERIFIED, pattern is standard)
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function adb(serial: string, args: string[], timeoutMs = 15000) {
  try {
    const { stdout, stderr } = await run('adb', ['-s', serial, ...args],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (e: any) {              // non-zero exit or timeout
    return { code: typeof e.code === 'number' ? e.code : -1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e), timedOut: e.killed === true };
  }
}
// binary: use execFile(..., { encoding: 'buffer' }) with args ['exec-out','screencap','-p']; never decode as utf8.
```
Use execFile with an args array, not exec with a string (no shell injection). For `adb shell` the remote side re-parses the joined string, so quote it yourself: pass ONE string arg after `shell`.

## 2. Docker containers as fake servers

### Run a command: CLI (VERIFIED facts from S9)
```
docker exec [-u user] [-w dir] [-e K=V] CONTAINER cmd args
```
- No timeout option exists in `docker exec` (VERIFIED, S9). Implement it in Node (kill the client process, and note this does NOT kill the process inside the container, UNVERIFIED but known behavior; use `timeout 10 cmd` inside the container as well).
- Needs an executable; for pipes or `&&` use `sh -c '...'` (VERIFIED, S9).
- The CLI returns the command's exit code; docker's own errors return 1 (VERIFIED example for paused container, S9; 126/127 conventions for not-executable or not-found are UNVERIFIED).
```ts
// same execFile wrapper as above, with file 'docker' and args ['exec', c, 'sh', '-c', cmd]; timeout via execFile option.
```

### Run a command: dockerode (npm: dockerode)
VERIFIED from S8 and S7: `container.exec({Cmd, Env, AttachStdout:true, AttachStderr:true})`, `exec.start(cb)`, `container.modem.demuxStream(stream, out, err)`, `exec.inspect()` returns data.
```ts
import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
export async function dexec(name: string, cmd: string[], timeoutMs = 10000) {
  const c = docker.getContainer(name);
  const exec = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });   // promise form: UNVERIFIED but README says dual callback/promise
  const stream = await exec.start({});                                                // Tty false => multiplexed, need demux (VERIFIED, S7)
  const o: Buffer[] = [], e: Buffer[] = [];
  const so = new PassThrough().on('data', d => o.push(d));
  const se = new PassThrough().on('data', d => e.push(d));
  c.modem.demuxStream(stream, so, se);
  const done = new Promise<void>(r => stream.on('end', () => r()));
  const t = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeoutMs));
  const res = await Promise.race([done.then(() => 'ok' as const), t]);
  if (res === 'timeout') { (stream as any).destroy(); return { code: -1, timedOut: true, stdout: Buffer.concat(o).toString(), stderr: Buffer.concat(e).toString() }; }
  const info = await exec.inspect();                                                  // info.ExitCode (UNVERIFIED field name, from Docker API ExecInspect)
  return { code: info.ExitCode, timedOut: false, stdout: Buffer.concat(o).toString(), stderr: Buffer.concat(e).toString() };
}
```
Gotcha (UNVERIFIED): ExitCode can be null if inspected before the process ends; poll `inspect()` until `Running === false`. Do not set Tty:true if you want separate stderr.

### Container with service + health endpoint, killable and restartable (UNVERIFIED)
Simplest: restart loop as PID 1 plus Docker restart policy. Killing the service process makes the loop respawn it.
```
# Dockerfile
FROM python:3.12-slim
COPY app.py run.sh /srv/
RUN chmod +x /srv/run.sh
CMD ["/srv/run.sh"]
HEALTHCHECK --interval=5s --timeout=2s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/health')" || exit 1
# run.sh
#!/bin/sh
while true; do python /srv/app.py; echo "app exited $?, restarting" >&2; sleep 1; done
# app.py: http.server answering 200 "ok" on /health
```
Run: `docker run -d --name web1 --restart unless-stopped -p 8080:8080 img`
Kill service only: `docker exec web1 pkill -f app.py` (needs `procps` in image; slim images lack pkill, use `kill $(pidof python)` or install procps). Whole container: `docker restart web1`. supervisord alternative: `apt-get install supervisor`, `[program:app] command=python /srv/app.py autorestart=true`, then `supervisorctl restart app` (UNVERIFIED).
Health state: `docker inspect -f '{{.State.Health.Status}}' web1`.

### Snapshots: files and filesystem
- `docker cp web1:/etc/app.conf ./snap/app.conf` and `docker cp ./snap/app.conf web1:/etc/app.conf` (VERIFIED syntax, S11). Works on stopped containers too. Does not create missing parent dirs, copies in as root:root by default (VERIFIED, S11). Restoring a file may need `docker exec web1 chown/chmod` afterwards. Cannot copy /proc, /sys, /dev, tmpfs, mounts; use `docker exec ... tar` instead (VERIFIED, S11).
- Stream tar: `docker cp web1:/etc - > etc.tar` and `docker cp - web1:/ < etc.tar` (VERIFIED, S11; dest of `-` source must be a directory).
- `docker diff web1`: lines `A` added, `C` changed, `D` deleted, relative to the image at container creation (VERIFIED, S10). Good for "what did the change touch"; it does not give content, and `C /dev` style noise appears.
- `docker commit web1 snap:before` saves the container filesystem as an image (UNVERIFIED in docs, standard; dockerode `container.commit(options)` exists, VERIFIED S7). Rollback: stop, `docker run` a new container from `snap:before`. Commit does not capture volumes or running processes.
- dockerode archive: `container.getArchive({path})` returns a tar stream, `container.putArchive(tarBufferOrStream, {path})` extracts into dir `path` (method names VERIFIED, S7; argument shapes UNVERIFIED). Use `tar-stream` npm to build or read the tar.

## 3. SSH from Node with ssh2

Facts: Node >= 16 required (VERIFIED, S5, so Node 22 fine). `readyTimeout` default 20000 covers handshake and auth only; `keepaliveInterval` default 0 (VERIFIED, S6). exec has NO timeout option (VERIFIED, S6); build your own.
```ts
import { Client } from 'ssh2';           // @types/ssh2 for types (UNVERIFIED version pairing)
import { readFileSync } from 'node:fs';

export function connect(host: string, username: string, keyPath: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c)).on('error', reject).connect({
      host, port: 22, username, privateKey: readFileSync(keyPath),   // VERIFIED shape (S5)
      readyTimeout: 20000, keepaliveInterval: 10000,
      // passphrase: '...'  (UNVERIFIED name, believed correct); hostVerifier: (key) => ... to pin host key (UNVERIFIED)
    });
  });
}

export function sh(c: Client, cmd: string, timeoutMs = 15000) {
  return new Promise<{ code: number | null; signal?: string; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    c.exec(cmd, (err, stream) => {                                    // VERIFIED (S5)
      if (err) return reject(err);
      let stdout = '', stderr = '', timedOut = false, code: number | null = null, sig: string | undefined;
      const timer = setTimeout(() => { timedOut = true; stream.close(); }, timeoutMs);   // close() ends channel; remote process may survive, wrap with `timeout N cmd` remotely (UNVERIFIED)
      stream.on('data', (d: Buffer) => (stdout += d))
        .stderr.on('data', (d: Buffer) => (stderr += d));             // VERIFIED (S5)
      stream.on('exit', (c2: number | null, s?: string) => { code = c2; sig = s; });   // see note
      stream.on('close', (c2?: number | null, s?: string) => {       // README reads (code, signal) here (VERIFIED, S5)
        clearTimeout(timer);
        resolve({ code: c2 ?? code, signal: s ?? sig, stdout, stderr, timedOut });
      });
    });
  });
}
```
Note: the README (S5) reads code in `close`, but a fetched view of client.js (S6) says exit info is emitted on `exit`. Listening to both, as above, is the safe route. code is null when killed by a signal. Many servers do not send exit-signal. Non-zero exit does not raise an error; check `code`.

SFTP snapshots (VERIFIED method names, S5; promisify wrapper UNVERIFIED):
```ts
import { promisify } from 'node:util';
const sftp = await new Promise<any>((res, rej) => c.sftp((e, s) => (e ? rej(e) : res(s))));
const readFile = promisify(sftp.readFile.bind(sftp));     // (path) => Buffer
const writeFile = promisify(sftp.writeFile.bind(sftp));   // (path, Buffer)
const before = await readFile('/etc/app.conf');           // snapshot bytes
const st = await promisify(sftp.stat.bind(sftp))('/etc/app.conf');   // st.mode, st.uid, st.gid (UNVERIFIED); restore mode with sftp.chmod
// fastGet(remote, local, cb) and fastPut(local, remote, cb) for big files (VERIFIED, S5)
```
Missing remote file gives an error with code 2 (SFTP no such file, UNVERIFIED); record "absent" and undo by `unlink`. Writing in place over SFTP as non-root fails on root-owned files; fall back to `sudo tee` via exec (UNVERIFIED). Prefer write to temp then `mv` for atomic restore (UNVERIFIED).

## 4. Snapshot and undo table (all patterns UNVERIFIED as end to end flows)

| Change | Snapshot before | Apply | Undo |
|---|---|---|---|
| File edit (Docker) | `docker cp c:/path ./snap/path`, also record `stat -c '%a %u %g'` and whether file existed | edit via exec or cp in | `docker cp ./snap/path c:/path` then chown/chmod; if absent before, `rm -f` |
| File edit (SSH) | sftp `readFile` bytes + `stat` mode/uid/gid, or `sha256sum` for verify | sftp `writeFile` or exec | `writeFile` old bytes, chmod; verify sha256; if absent before, `unlink` |
| Service restart (Docker) | `docker inspect` State (Status, Health, StartedAt), `ps` output, optional `docker commit c snap:t` | `docker restart c` or `pkill` the service | A restart cannot be undone; "undo" means reach prior state: ensure same state running, health OK. For file side effects use `docker diff` and restore from commit |
| Service restart (SSH, systemd) | `systemctl is-active X`, `is-enabled X`, `show -p MainPID X` | `systemctl restart X` | If it was active, `systemctl start X` and poll `is-active`; if it was inactive, `systemctl stop X`; restore enabled via `enable/disable` |
| Android setting change | `settings get <ns> <key>` per key; treat `null` as absent. For Wi-Fi, `settings get global wifi_on` and `dumpsys wifi` excerpt | `settings put` or `svc wifi disable` | `settings put <ns> <key> <old>`, or `settings delete <ns> <key>` if it was `null`; `svc wifi enable/disable` per old state. Re-read and compare |

Store per step: target id, command, timestamp, snapshot payload (bytes or text), exit code, and a verify command. Undo should run the verify command and report mismatch.
