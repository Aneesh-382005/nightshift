// Host (VPS) target test, run locally in a THROWAWAY root. Run: npm run test:host
// Uses a throwaway systemd --user unit (ns-demo-test, port 18090, removed at the end), the real demo/vps scripts,
// a fake alert webhook on :18789 and device id vps-test. Does NOT claim the gate. The grant path for these runbooks is
// not covered here (needs a gate): the runbook commands, snapshots, inverses and health checks are.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { connect } from './spacetime.js';
import { inverseFrom, takeAll, verifyRestored, type SnapStep } from './snapshot.js';
import { HostTarget } from './targets.js';
import { capture, sleep } from './util.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const VPS = path.join(ROOT, 'demo', 'vps');
const NSROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-vps-test-'));
const PORT = '18090', UNIT = 'ns-demo-test', HOOK = 18789;
const UNIT_FILE = path.join(os.homedir(), '.config', 'systemd', 'user', `${UNIT}.service`);
const env = { ...process.env, NS_ROOT: NSROOT, NS_PORT: PORT, NS_UNIT: UNIT, PATH: `${VPS}/bin:${process.env.PATH}` };
Object.assign(process.env, { NS_PORT: PORT, NS_UNIT: UNIT, NS_ROOT: NSROOT, PATH: env.PATH });
const sh = (script: string, ...a: string[]) => capture(script, a, 60000, { env });
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(250); } return f(); }

await sh(`${VPS}/seed.sh`);
fs.writeFileSync(UNIT_FILE, `[Unit]\nDescription=ns demo test\n[Service]\nEnvironment=NS_ROOT=${NSROOT} NS_PORT=${PORT}\nExecStart=/usr/bin/python3 ${VPS}/demoapp.py\nRestart=always\nRestartSec=1\n`);
await capture('systemctl', ['--user', 'daemon-reload'], 10000);
await sh('systemctl', '--user', 'restart', UNIT);

const alerts: { device: string; alert: string; source: string }[] = [];
const hook = http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)).on('end', () => { try { alerts.push(JSON.parse(b)); } catch { /* ignore */ } res.end('ok'); });
}).listen(HOOK, '127.0.0.1');
const t = new HostTarget('vps-test', NSROOT);
const healthy = async () => (await t.run('health', 10)).code === 0;
check('demo service healthy after seed', await until(() => true, 0) && (await sleep(1500), await healthy()));

const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...env, NS_DEVICE_ID: 'vps-test', NIGHTSHIFT_ALERT_URL: `http://127.0.0.1:${HOOK}/alert` },
});
const obs = await connect('observer');
await new Promise<void>((res, rej) => obs.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('sub'))).subscribeToAllTables());
const vit = () => { let b: any; for (const e of obs.db.event.iter()) if (e.kind === 'vitals' && e.device === 'vps-test' && (!b || e.id > b.id)) b = e; return b && JSON.parse(b.detail); };

try {
  console.log('[A] registration, vitals, monitor alerts for each fault');
  check('device registered as kind host', await until(() => obs.db.device.id.find('vps-test')?.kind === 'host', 20000));
  check('vitals appear', await until(() => !!vit(), 25000), JSON.stringify(vit()));
  check('vitals carry health, diskPct, tmpMB, service', vit()?.health === 200 && typeof vit().diskPct === 'number' && typeof vit().tmpMB === 'number' && vit().service === 'running');

  const faults: [string, RegExp][] = [['service', /service down/], ['config', /500 bad config/], ['disk', /503 tmp dir full/], ['folder', /500 app dir missing/]];
  for (const [fault, re] of faults) {
    const before = alerts.length;
    await sh(`${VPS}/break.sh`, fault);
    check(`${fault}: alert within 20s`, await until(() => alerts.length > before, 20000), alerts[before]?.alert);
    check(`${fault}: alert text from probe`, re.test(alerts[before]?.alert ?? '') && alerts[before]?.device === 'vps-test' && alerts[before]?.source === 'monitor');
    await sleep(7000);
    check(`${fault}: no repeat while failing`, alerts.length === before + 1, `${alerts.length - before} alerts`);
    await sh(`${VPS}/reset.sh`);
    check(`${fault}: reset healthy`, await healthy());
    await sleep(7000);   // let the monitor see a healthy probe so the next outage alerts again
  }
} finally {
  child.kill('SIGINT'); await sleep(500); child.kill('SIGKILL'); obs.disconnect(); hook.close();
}

console.log('\n[B] runbooks as the gate would send them (cwd = root, relative paths)');
const FOLDER_HEALTH = 'test -d srv/app && (cd srv && sha256sum -c --quiet app.manifest) && health';
const runbooks: { name: string; fault: string; fix: string; snaps: SnapStep[]; inverse?: string; health: string }[] = [
  { name: 'restart-web', fault: 'service', fix: 'svc restart web', snaps: [{ kind: 'service', name: 'web' }], health: 'health' },
  { name: 'restore-config', fault: 'config', fix: 'cp srv/app.conf.good etc/app.conf', snaps: [{ kind: 'file', path: 'etc/app.conf' }], health: 'health' },
  { name: 'rotate-tmp', fault: 'disk', fix: 'rotate-tmp', snaps: [], inverse: 'rotate-tmp undo', health: 'health' },
  { name: 'restore-folder', fault: 'folder', fix: 'cp -a srv/app.snapshot srv/app', snaps: [{ kind: 'dir', path: 'srv/app' }], health: FOLDER_HEALTH },
];
for (const rb of runbooks) {
  await sh(`${VPS}/reset.sh`);
  await sh(`${VPS}/break.sh`, rb.fault);
  check(`${rb.name}: unhealthy after the fault`, !(await healthy()));
  const snaps = await takeAll(t, rb.snaps);
  const inverse = rb.inverse ?? inverseFrom(snaps);
  const r = await t.run(rb.fix, 30);
  check(`${rb.name}: fix exit 0`, r.code === 0, r.output.slice(0, 80));
  check(`${rb.name}: health passes`, (await t.run(rb.health, 10)).code === 0);
  check(`${rb.name}: has an inverse (${inverse.slice(0, 50)}...)`, inverse.length > 0 && !/rm -rf/.test(inverse));
  const iv = await t.run(inverse, 30);
  check(`${rb.name}: inverse exit 0`, iv.code === 0, iv.output.slice(0, 80));
  if (snaps.length) check(`${rb.name}: state verified equal to before`, (await verifyRestored(t, snaps)) === null);
  if (rb.name === 'rotate-tmp') check('rotate-tmp: undo brings the fault back (nothing was deleted)', !(await healthy()));
}
await sh(`${VPS}/reset.sh`);

console.log('\n[C] svc wrapper is narrow, sandbox facts');
check('svc refuses other units', (await t.run('svc stop sshd', 5)).code === 2);
check('svc refuses no name', (await t.run('svc restart', 5)).code === 2);
check('executor unit sets NoNewPrivileges (installer output)', /NoNewPrivileges=true/.test(fs.readFileSync(`${VPS}/install.sh`, 'utf8')));

await capture('systemctl', ['--user', 'stop', UNIT], 10000);
fs.rmSync(UNIT_FILE, { force: true });
await capture('systemctl', ['--user', 'daemon-reload'], 10000);
fs.rmSync(NSROOT, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
