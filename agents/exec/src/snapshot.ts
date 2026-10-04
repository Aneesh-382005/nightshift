import type { Target } from './targets.js';
import { shq, sleep } from './util.js';

export type SnapStep =
  | { kind: 'file'; path: string }
  | { kind: 'service'; name: string }
  | { kind: 'android_setting'; ns: string; key: string };

export type Snap =
  | { kind: 'file'; path: string; exists: boolean; mode: string; b64: string }
  | { kind: 'service'; name: string; active: boolean }
  | { kind: 'android_setting'; ns: string; key: string; value: string | null };   // null means absent

const MAX_FILE = 64 * 1024;

async function must(t: Target, cmd: string, timeoutS = 15) {
  const r = await t.run(cmd, timeoutS);
  if (r.code !== 0) throw new Error(`snapshot command failed (${r.code}): ${r.output.slice(0, 200)}`);
  return r.output;
}

export async function takeSnapshot(t: Target, step: SnapStep): Promise<Snap> {
  if (step.kind === 'file') {
    const p = shq(step.path);
    const out = await must(t, `[ -e ${p} ] || { echo ABSENT; exit 0; }; echo MODE=$(stat -c %a ${p}); echo SIZE=$(wc -c < ${p}); echo DATA; base64 ${p}`);
    if (out.startsWith('ABSENT')) return { kind: 'file', path: step.path, exists: false, mode: '', b64: '' };
    const mode = /^MODE=(\d+)/m.exec(out)?.[1];
    const size = Number(/^SIZE=(\d+)/m.exec(out)?.[1]);
    if (!mode || !Number.isFinite(size)) throw new Error(`cannot parse snapshot of ${step.path}`);
    if (size > MAX_FILE) throw new Error(`${step.path} is ${size} bytes, over the ${MAX_FILE} byte snapshot limit`);
    const b64 = out.split(/^DATA\s*$/m)[1]?.replace(/\s+/g, '') ?? '';
    return { kind: 'file', path: step.path, exists: true, mode, b64 };
  }
  if (step.kind === 'service') {
    const n = shq(step.name);
    const r = await t.run(`if command -v svc >/dev/null 2>&1; then svc status ${n}; else systemctl is-active --quiet ${n}; fi`, 15);
    return { kind: 'service', name: step.name, active: r.code === 0 };
  }
  const v = (await must(t, `settings get ${shq(step.ns)} ${shq(step.key)}`)).trim();
  return { kind: 'android_setting', ns: step.ns, key: step.key, value: v === 'null' || v === '' ? null : v };
}

export async function takeAll(t: Target, steps: SnapStep[]): Promise<Snap[]> {
  const out: Snap[] = [];
  for (const s of steps) out.push(await takeSnapshot(t, s));
  return out;
}

/** Build one inverse command from snapshots (used when the plan gives no inverse). Applied in reverse order. */
export function inverseFrom(snaps: Snap[]): string {
  const parts: string[] = [];
  for (const s of [...snaps].reverse()) {
    if (s.kind === 'file') {
      parts.push(s.exists
        ? `printf %s ${shq(s.b64)} | base64 -d > ${shq(s.path)} && chmod ${s.mode} ${shq(s.path)}`
        : `rm -f ${shq(s.path)}`);
    } else if (s.kind === 'service') {
      const n = shq(s.name), act = s.active ? 'start' : 'stop';
      parts.push(`if command -v svc >/dev/null 2>&1; then svc ${act} ${n}; else systemctl ${act} ${n}; fi`);
    } else if (s.key === 'wifi_on') {
      parts.push(`svc wifi ${s.value === '1' ? 'enable' : 'disable'}`);
    } else {
      parts.push(s.value === null ? `settings delete ${shq(s.ns)} ${shq(s.key)}` : `settings put ${shq(s.ns)} ${shq(s.key)} ${shq(s.value)}`);
    }
  }
  return parts.join(' && ');
}

const same = (a: Snap, b: Snap) => JSON.stringify(a) === JSON.stringify(b);

/** Re-read every snapshot and compare with the before state. Retries because settings and services settle slowly. */
export async function verifyRestored(t: Target, before: Snap[]): Promise<string | null> {
  let last = '';
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(1000);
    last = '';
    for (const b of before) {
      const now = await takeSnapshot(t, b.kind === 'file' ? { kind: 'file', path: b.path }
        : b.kind === 'service' ? { kind: 'service', name: b.name } : { kind: 'android_setting', ns: b.ns, key: b.key });
      if (!same(b, now)) last += `${b.kind} ${'path' in b ? b.path : 'name' in b ? b.name : b.key} differs; `;
    }
    if (!last) return null;
  }
  return last;
}
