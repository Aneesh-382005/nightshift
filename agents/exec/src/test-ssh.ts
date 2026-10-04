// ssh target test. Run: npm run test:ssh
// Builds/starts ONLY the new container ssh-box (127.0.0.1:2222). No executor, no DB, no gate, no live device is touched.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { probeDocker } from './monitor.js';
import { inverseFrom, takeAll, verifyRestored, type SnapStep } from './snapshot.js';
import { SshTarget } from './targets.js';
import { capture, sleep } from './util.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const KEY = path.join(ROOT, 'demo', 'ssh', 'keys', 'id_ed25519');
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const sh = (f: string, ...a: string[]) => capture(f, a, 240000);

await sh(`${ROOT}/demo/ssh/setup.sh`);
const wasUp = (await sh('docker', 'inspect', '-f', '{{.State.Running}}', 'ssh-box')).stdout.trim() === 'true';
if (!wasUp) {
  const up = await sh('docker', 'compose', '-f', `${ROOT}/demo/ssh/docker-compose.yml`, 'up', '-d', '--build');
  check('compose up ssh-box', up.code === 0, up.stderr.slice(-200));
  await sleep(3000);
}
await sh(`${ROOT}/demo/ssh/reset.sh`);

const known = path.join(os.tmpdir(), `ssh-box-test-${process.pid}.known_hosts`);
const t = new SshTarget('ssh-box', { host: '127.0.0.1', port: 2222, user: 'nsuser', key: KEY, knownHosts: known });
const healthy = async () => (await t.run('health', 10)).code === 0;

console.log('[A] connection and confinement');
check('available over key auth', (await t.available()) === null);
check('kind is ssh', t.kind === 'ssh');
const who = await t.run('id -un; id -u', 10);
check('runs as the unprivileged user nsuser', who.output.startsWith('nsuser') && !/^0$/m.test(who.output), who.output.replace(/\n/g, ' '));
check('exit codes propagate', (await t.run('exit 7', 10)).code === 7);
check('no sudo in the box', (await t.run('command -v sudo', 10)).code !== 0);
check('cannot write outside its own files', (await t.run('touch /etc/passwd.x', 10)).code !== 0);
const pw = await capture('ssh', ['-o', 'BatchMode=yes', '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password,keyboard-interactive',
  '-o', 'StrictHostKeyChecking=no', '-o', `UserKnownHostsFile=${known}`, '-p', '2222', 'nsuser@127.0.0.1', 'true'], 15000);
check('password auth is refused', pw.code === 255 && /Permission denied/.test(pw.stderr), pw.stderr.trim().split('\n').pop());
const root = await capture('ssh', ['-i', KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', `UserKnownHostsFile=${known}`, '-p', '2222', 'root@127.0.0.1', 'true'], 15000);
check('root login is refused', root.code === 255);
const other = path.join(os.tmpdir(), `ssh-box-wrongkey-${process.pid}`);
await capture('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', other], 10000);
const wrong = await new SshTarget('ssh-box', { host: '127.0.0.1', port: 2222, user: 'nsuser', key: other, knownHosts: known }).available();
check('a different key is refused', wrong !== null);
fs.rmSync(other, { force: true }); fs.rmSync(`${other}.pub`, { force: true });

console.log('\n[B] timeout kills the remote process');
const t0 = Date.now();
const to = await t.run('sleep 30', 2);
check('timeout returns non-zero fast', to.code !== 0 && Date.now() - t0 < 12000, `exit ${to.code} after ${Date.now() - t0}ms`);
await sleep(500);
const left = await t.run(`for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null; echo; done | grep -c '[s]leep 30'`, 10);
check('no sleep left on the box', left.output.trim().split('\n')[0] === '0', left.output.trim());

console.log('\n[C] monitor probe over ssh');
const p = await probeDocker(t);
check('probe sees health 200 with vitals', p.ok && (p.vitals as any).health === 200 && typeof (p.vitals as any).diskPct === 'number', JSON.stringify(p.vitals));

console.log('\n[D] runbooks as for linux-server (restart-web, restore-config, restore-folder, rotate-logs)');
const FOLDER_HEALTH = 'test -d /srv/app && (cd /srv && sha256sum -c --quiet app.manifest) && health';
const rbs: { name: string; fault: string; fix: string; snaps: SnapStep[]; inverse?: string; health: string }[] = [
  { name: 'restart-web', fault: 'service', fix: 'svc restart web', snaps: [{ kind: 'service', name: 'web' }], health: 'health' },
  { name: 'restore-config', fault: 'config', fix: 'cp /srv/app.conf.good /etc/app.conf', snaps: [{ kind: 'file', path: '/etc/app.conf' }], health: 'health' },
  { name: 'restore-folder', fault: 'folder', fix: 'cp -a /srv/app.snapshot /srv/app', snaps: [{ kind: 'dir', path: '/srv/app' }], health: FOLDER_HEALTH },
  { name: 'rotate-logs', fault: 'disk', fix: 'rotate-logs', snaps: [], inverse: 'rotate-logs undo', health: 'health' },
];
for (const rb of rbs) {
  await sh(`${ROOT}/demo/ssh/reset.sh`);
  await sh(`${ROOT}/demo/ssh/break.sh`, rb.fault);
  check(`${rb.name}: unhealthy after the fault`, !(await healthy()));
  const snaps = await takeAll(t, rb.snaps);
  const inverse = rb.inverse ?? inverseFrom(snaps);
  const r = await t.run(rb.fix, 30);
  check(`${rb.name}: fix exit 0`, r.code === 0, r.output.slice(0, 80));
  check(`${rb.name}: health passes`, (await t.run(rb.health, 10)).code === 0);
  check(`${rb.name}: inverse exists, deletes nothing`, inverse.length > 0 && !/rm -rf/.test(inverse));
  const iv = await t.run(inverse, 30);
  check(`${rb.name}: inverse exit 0`, iv.code === 0, iv.output.slice(0, 80));
  if (snaps.length) check(`${rb.name}: state verified equal to before`, (await verifyRestored(t, snaps)) === null);
  if (rb.name === 'rotate-logs') check('rotate-logs: undo brings the fault back (nothing deleted)', !(await healthy()));
}
await sh(`${ROOT}/demo/ssh/reset.sh`);
check('box healthy at the end', await healthy());

fs.rmSync(known, { force: true });
if (!wasUp) await sh('docker', 'compose', '-f', `${ROOT}/demo/ssh/docker-compose.yml`, 'down');
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
