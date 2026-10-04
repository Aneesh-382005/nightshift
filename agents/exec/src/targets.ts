import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capture, clip, shq } from './util.js';

export interface RunResult { code: number; output: string; timedOut: boolean }

export interface Target {
  readonly id: string;
  readonly name: string;
  readonly kind: string;                 // device.kind in SpacetimeDB
  readonly flavor: 'linux' | 'android';  // decides how snapshots are taken
  /** null when reachable, else a reason string. */
  available(): Promise<string | null>;
  run(command: string, timeoutS: number): Promise<RunResult>;
}

const merge = (stdout: string, stderr: string) => clip(stderr ? `${stdout}${stdout && !stdout.endsWith('\n') ? '\n' : ''}${stderr}` : stdout);

/** docker exec into a container whose name is the device id. */
export class DockerTarget implements Target {
  readonly flavor = 'linux' as const;
  constructor(readonly id: string, readonly name = `${id} (container stand-in)`, readonly container = id, readonly kind = 'docker') {}

  async available() {
    const r = await capture('docker', ['inspect', '-f', '{{.State.Running}}', this.container], 8000);
    return r.code === 0 && r.stdout.trim() === 'true' ? null : `container ${this.container} not running`;
  }

  async run(command: string, timeoutS: number): Promise<RunResult> {
    // `timeout` inside the container kills the real process; the Node timer only kills the docker client.
    const r = await capture('docker', ['exec', this.container, 'timeout', '-s', 'KILL', String(timeoutS), 'sh', '-c', command], (timeoutS + 5) * 1000);
    const timedOut = r.timedOut || r.code === 137 || r.code === 124;
    return { code: r.code, output: merge(r.stdout, r.stderr) + (timedOut ? `\n[timeout after ${timeoutS}s]` : ''), timedOut };
  }
}

/** adb shell on one serial. Exit codes are parsed from an __RC= marker so they survive old adb. */
export class AdbTarget implements Target {
  readonly kind = 'phone';
  readonly flavor = 'android' as const;
  constructor(readonly id: string, readonly serial: string, readonly name = `${id} (Android phone)`) {}

  async available() {
    const r = await capture('adb', ['-s', this.serial, 'get-state'], 8000);
    return r.code === 0 && r.stdout.trim() === 'device' ? null : `adb ${this.serial}: ${r.stdout.trim() || r.stderr.trim() || 'not connected'}`;
  }

  async run(command: string, timeoutS: number): Promise<RunResult> {
    const script = `timeout -s KILL ${timeoutS} sh -c ${shq(command)}; echo __RC=$?`;
    const r = await capture('adb', ['-s', this.serial, 'shell', script], (timeoutS + 5) * 1000);
    const m = /^__RC=(\d+)\s*$/m.exec(r.stdout);
    const body = r.stdout.replace(/^__RC=\d+\s*$/m, '').trimEnd();
    let code = m ? Number(m[1]) : (r.code === 0 ? -1 : r.code);   // no marker means adb itself failed
    const timedOut = r.timedOut || code === 137 || code === 124;
    const out = merge(body, r.stderr);
    // settings, svc, cmd, pm and am print Java exceptions and still exit 0.
    if (code === 0 && /^(settings|svc|cmd|pm|am)\b/.test(command.trim()) &&
        /(^|\n)\s*(Exception|java\.\w+\.|Error:|error:|Permission denied|SecurityException)/.test(out)) code = 1;
    return { code, output: out + (timedOut ? `\n[timeout after ${timeoutS}s]` : ''), timedOut };
  }
}

/**
 * The executor runs ON this machine (a VPS, say) as a limited user. Commands run via `sh -c` with cwd = root,
 * so runbooks use paths relative to the root. No sudo: callers should also run the process with NoNewPrivileges.
 * Service control goes through the narrow `svc` wrapper found on PATH (~/.local/bin), not through raw systemctl.
 */
export class HostTarget implements Target {
  readonly flavor = 'linux' as const;
  readonly kind = 'host';
  readonly root: string;
  constructor(readonly id: string, root: string, readonly name = `${id} (host, root ${root})`) {
    this.root = root.replace(/^~(?=$|\/)/, os.homedir());
  }

  async available() { return fs.existsSync(this.root) ? null : `root ${this.root} does not exist`; }

  async run(command: string, timeoutS: number): Promise<RunResult> {
    const env = { ...process.env, NS_ROOT: this.root, PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}` };
    const r = await capture('timeout', ['-s', 'KILL', String(timeoutS), 'sh', '-c', command], (timeoutS + 5) * 1000, { cwd: this.root, env });
    const timedOut = r.timedOut || r.code === 137 || r.code === 124;
    return { code: r.code, output: merge(r.stdout, r.stderr) + (timedOut ? `\n[timeout after ${timeoutS}s]` : ''), timedOut };
  }
}

export interface SshOpts { host?: string; port?: number; user: string; key: string; knownHosts?: string }

/**
 * A machine reached over SSH (key only, BatchMode). Same contract as the other targets: `sh -c` on the far side with a
 * remote `timeout` so a hung command is really killed, plus a Node-side timer that kills the ssh client.
 * Host keys: accept-new, kept in a per-device known_hosts file (rebuilding the box changes its key: delete that file).
 */
export class SshTarget implements Target {
  readonly flavor = 'linux' as const;
  readonly kind = 'ssh';
  private readonly host: string; private readonly port: number;
  constructor(readonly id: string, private o: SshOpts, readonly name = `${id} (ssh ${o.user}@${o.host ?? '127.0.0.1'}:${o.port ?? 22})`) {
    this.host = o.host ?? '127.0.0.1'; this.port = o.port ?? 22;
  }

  private args(remote: string): string[] {
    const known = this.o.knownHosts ?? path.resolve(import.meta.dirname, '..', '.state', `${this.id}.known_hosts`);
    fs.mkdirSync(path.dirname(known), { recursive: true });
    return ['-i', this.o.key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${known}`, '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
      '-p', String(this.port), `${this.o.user}@${this.host}`, '--', remote];
  }

  async available() {
    const r = await capture('ssh', this.args('true'), 10000);
    return r.code === 0 ? null : `ssh ${this.o.user}@${this.host}:${this.port}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`;
  }

  async run(command: string, timeoutS: number): Promise<RunResult> {
    const r = await capture('ssh', this.args(`timeout -s KILL ${timeoutS} sh -c ${shq(command)}`), (timeoutS + 8) * 1000);
    const timedOut = r.timedOut || r.code === 137 || r.code === 124;
    // ssh itself fails with 255 (connection, auth); a remote command can only return 255 by choosing to.
    const note = r.code === 255 ? '\n[ssh connection failed]' : timedOut ? `\n[timeout after ${timeoutS}s]` : '';
    return { code: r.code, output: merge(r.stdout, r.stderr) + note, timedOut };
  }
}
