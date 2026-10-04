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
  readonly kind = 'docker';
  readonly flavor = 'linux' as const;
  constructor(readonly id: string, readonly name = `${id} (container stand-in)`) {}

  async available() {
    const r = await capture('docker', ['inspect', '-f', '{{.State.Running}}', this.id], 8000);
    return r.code === 0 && r.stdout.trim() === 'true' ? null : `container ${this.id} not running`;
  }

  async run(command: string, timeoutS: number): Promise<RunResult> {
    // `timeout` inside the container kills the real process; the Node timer only kills the docker client.
    const r = await capture('docker', ['exec', this.id, 'timeout', '-s', 'KILL', String(timeoutS), 'sh', '-c', command], (timeoutS + 5) * 1000);
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
