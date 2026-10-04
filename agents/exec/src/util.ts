import { execFile } from 'node:child_process';

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** POSIX single-quote a string for use inside a remote `sh -c`. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface Captured { code: number; stdout: string; stderr: string; timedOut: boolean }

/** execFile with a hard Node-side timeout. Never goes through a host shell. */
export function capture(file: string, args: string[], timeoutMs: number): Promise<Captured> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr, timedOut: false });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        resolve({
          code: typeof e.code === 'number' ? e.code : -1,
          stdout: stdout ?? '', stderr: (stderr ?? '') || String(e.message),
          timedOut: e.killed === true,
        });
      });
  });
}

/** Keep head and tail of long output. */
export function clip(s: string, max = 3500): string {
  return s.length <= max ? s : `${s.slice(0, max / 2)}\n...[clipped]...\n${s.slice(-max / 2)}`;
}
