// Spawns agents/freewili/bridge.py and speaks the JSON-lines protocol from docs/CONTRACT.md.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ButtonName = 'gray' | 'yellow' | 'green' | 'blue' | 'red';
export type LedMode = 'solid' | 'pulse' | 'blink';
export type Backend = 'sim' | 'legacy' | 'onewili';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEWILI_DIR = path.resolve(here, '../../freewili');

export class Bridge extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  ready = false;
  failed = false;

  constructor(readonly backend: Backend, private extraArgs: string[] = []) { super(); }

  /** Resolves when the bridge says ready, rejects on a connect error or exit. Never waits for the
   *  child to die: a hung onewili device can leave the process stuck in the kernel. */
  start(timeoutMs = 15000): Promise<void> {
    const py = path.join(FREEWILI_DIR, '.venv/bin/python');
    const proc = spawn(py, [path.join(FREEWILI_DIR, 'bridge.py'), '--backend', this.backend, ...this.extraArgs], { cwd: FREEWILI_DIR });
    this.proc = proc;
    proc.stdin.on('error', () => { /* bridge gone */ });
    proc.stderr.on('data', d => process.stderr.write(d));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.failed = true; reject(new Error('bridge start timeout')); }, timeoutMs);
      createInterface({ input: proc.stdout }).on('line', line => {
        let m: any;
        try { m = JSON.parse(line); } catch { return; }
        if (m.event === 'ready') { this.ready = true; clearTimeout(timer); resolve(); }
        else if (m.event === 'button') this.emit('button', m.name as ButtonName);
        else if (m.event === 'shake') this.emit('shake');
        else if (m.event === 'error') {
          console.error(`[bridge] error: ${m.message}`);
          if (!this.ready) { clearTimeout(timer); this.failed = true; reject(new Error(m.message)); }
        }
      });
      proc.on('error', e => { clearTimeout(timer); this.failed = true; reject(e); });
      proc.on('exit', code => {
        this.ready = false;
        if (!this.failed) { this.failed = true; clearTimeout(timer); reject(new Error(`bridge exited (${code})`)); }
        this.emit('exit', code);
      });
    });
  }

  private send(obj: object) {
    if (this.proc && this.ready && !this.proc.stdin.destroyed) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }
  text(text: string) { this.send({ op: 'text', text }); }
  led(r: number, g: number, b: number, mode: LedMode = 'solid', leds: number[] | 'all' = 'all') { this.send({ op: 'led', r, g, b, mode, leds }); }
  tone(hz: number, ms = 200, amp = 0.3) { this.send({ op: 'tone', hz, ms, amp }); }
  clear() { this.send({ op: 'clear' }); }
  /** sim backend only */
  press(name: ButtonName) { this.send({ op: 'press', name }); }
  kill() { try { this.proc?.kill('SIGKILL'); } catch { /* ignore */ } }
}
