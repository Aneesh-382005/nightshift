// "Folder deleted" test. Run: npm run test:folder
// Does NOT claim the gate. Part A: the monitor raises an alert when a folder is deleted (web-2 /srv/app, laptop sandbox
// projects/notes), to a local fake webhook. Part B: the restore runbook pieces without the gate: dir snapshot, restore
// command, health check, inverse and its verification, on both targets.
// Not covered here: the grant path for kind "dir" snapshots (needs a gate). Do not run while other web-2/laptop executors are up.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { connect } from './spacetime.js';
import { takeAll, inverseFrom, verifyRestored } from './snapshot.js';
import { DockerTarget } from './targets.js';
import { capture, sleep } from './util.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PORT = 18788;
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const alerts: { device: string; alert: string; source: string }[] = [];
const hook = http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)).on('end', () => { try { alerts.push(JSON.parse(b)); } catch { /* ignore */ } res.end('ok'); });
}).listen(PORT, '127.0.0.1');
const forDev = (d: string) => alerts.filter(a => a.device === d);
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(250); } return f(); }
const sh = (script: string, ...args: string[]) => capture(script, args, 60000);

await sh(`${ROOT}/demo/laptop-setup.sh`);
await sh(`${ROOT}/demo/reset.sh`, 'web-2', 'laptop');

console.log('[A] monitor notices a deleted folder');
const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, NIGHTSHIFT_DEVICES: 'web-2,laptop', NIGHTSHIFT_ALERT_URL: `http://127.0.0.1:${PORT}/alert` },
});
const obs = await connect('observer');
await new Promise<void>((res, rej) => obs.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('sub'))).subscribeToAllTables());
try {
  const vit = (d: string) => { let b: any; for (const e of obs.db.event.iter()) if (e.kind === 'vitals' && e.device === d && (!b || e.id > b.id)) b = e; return b && JSON.parse(b.detail); };
  check('laptop vitals appear', await until(() => !!vit('laptop'), 25000), JSON.stringify(vit('laptop')));
  check('laptop device is registered as kind laptop', obs.db.device.id.find('laptop')?.kind === 'laptop');
  check('no alerts while healthy', alerts.length === 0);

  await sh(`${ROOT}/demo/break.sh`, 'laptop', 'folder');
  check('laptop alert: folder missing', await until(() => forDev('laptop').length >= 1, 15000), forDev('laptop')[0]?.alert);
  check('laptop alert names projects/notes, source monitor', /projects\/notes/.test(forDev('laptop')[0]?.alert ?? '') && forDev('laptop')[0]?.source === 'monitor');
  await sh(`${ROOT}/demo/break.sh`, 'web-2', 'folder');
  check('web-2 alert: app dir missing', await until(() => forDev('web-2').length >= 1, 15000), forDev('web-2')[0]?.alert);
  check('web-2 alert text from probe', /app dir missing/.test(forDev('web-2')[0]?.alert ?? ''));
} finally {
  child.kill('SIGINT'); await sleep(500); child.kill('SIGKILL'); obs.disconnect(); hook.close();
}

console.log('\n[B] restore runbook pieces (no gate)');
const cases = [
  { t: new DockerTarget('web-2'), path: '/srv/app', restore: 'cp -a /srv/app.snapshot /srv/app',
    health: 'test -d /srv/app && cd /srv && sha256sum -c --quiet /srv/app.manifest && health', brk: ['web-2', 'folder'] },
  { t: new DockerTarget('laptop', 'laptop (SANDBOX)', 'laptop-sandbox', 'laptop'), path: '/playground/projects/notes', restore: 'cp -a -n /snapshot/files/. /playground/',
    health: 'cd /playground && sha256sum -c --quiet /snapshot/MANIFEST && for d in $(cat /snapshot/DIRS); do [ -d "$d" ] || exit 1; done', brk: ['laptop', 'folder'] },
];
for (const c of cases) {
  const id = c.t.id;
  await sh(`${ROOT}/demo/reset.sh`, id);
  await sh(`${ROOT}/demo/break.sh`, ...c.brk);
  check(`${id}: health fails while the folder is gone`, (await c.t.run(c.health, 10)).code !== 0);
  const snaps = await takeAll(c.t, [{ kind: 'dir', path: c.path }]);
  check(`${id}: dir snapshot says absent`, snaps[0].kind === 'dir' && !snaps[0].exists);
  const inv = inverseFrom(snaps);
  check(`${id}: inverse moves aside, never deletes`, /^mv /.test(inv) && !/rm /.test(inv), inv);
  const r = await c.t.run(c.restore, 20);
  check(`${id}: restore exit 0`, r.code === 0, r.output.slice(0, 80));
  check(`${id}: health passes (path exists, checksums match)`, (await c.t.run(c.health, 10)).code === 0);
  const after = await takeAll(c.t, [{ kind: 'dir', path: c.path }]);
  check(`${id}: dir exists after restore`, after[0].kind === 'dir' && after[0].exists && after[0].hash.length === 64);
  check(`${id}: inverse runs`, (await c.t.run(inv, 20)).code === 0);
  check(`${id}: state verified equal to the before snapshot`, (await verifyRestored(c.t, snaps)) === null);
  await sh(`${ROOT}/demo/reset.sh`, id);
}
check('sandbox policy: no network, read-only root', (await capture('docker', ['exec', 'laptop-sandbox', 'sh', '-c', 'touch /etc/x 2>&1 | grep -c Read-only; cat /proc/net/dev | grep -vc "lo:\\|Inter\\|face"'], 10000)).stdout.trim().split('\n').join(',') === '1,0');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
